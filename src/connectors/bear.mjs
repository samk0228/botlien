// Bear Robotics connector. Same interface as sim: { name, init, tick, stop }.
// The gRPC stream pushes on its own; messages buffer here and tick(nowMs)
// drains them, so the engine never sees gRPC types. All lifecycle (auth,
// refresh, reconnect backoff) happens inside tick — no self-timers — which is
// what makes this fully testable against a fake stream with a fixed clock.
//
// Heartbeat semantics: ok = authed + stream alive; degraded = reconnecting;
// down = auth rejected or too many consecutive failures.
import { normalizeBearStatus } from "../normalize.mjs";

const MIN = 60_000;
const MAX_FAILURES_BEFORE_DOWN = 5;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 5 * MIN;

export function createBearConnector(bearCfg, bearSecrets, deps = {}) {
  const { log = () => {}, fetchImpl = fetch, streamFactory = null } = deps;
  const refreshMarginMs = (bearCfg.token_refresh_margin_min ?? 5) * MIN;

  let token = null;
  let tokenExpMs = null;
  let authFailed = false;
  let stream = null;
  let streamAlive = false;
  let failures = 0;
  let nextAttemptMs = 0;
  let robotIds = [];
  let buffer = [];

  const makeStream = streamFactory ?? (() => createGrpcStream(bearCfg, token, robotIds));

  async function authenticate(nowMs) {
    const res = await fetchImpl(bearCfg.auth_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bearSecrets.credentials ?? bearSecrets),
    });
    if (!res.ok) {
      authFailed = true;
      throw new Error(`Bear auth rejected: HTTP ${res.status}`);
    }
    const body = await res.json();
    token = body.token ?? body.jwt ?? body.access_token ?? (typeof body === "string" ? body : null);
    if (!token) {
      authFailed = true;
      throw new Error("Bear auth response had no token field");
    }
    authFailed = false;
    tokenExpMs = jwtExpMs(token) ?? nowMs + 50 * MIN;
  }

  async function ensureToken(nowMs) {
    if (token && nowMs < tokenExpMs - refreshMarginMs) return;
    await authenticate(nowMs);
  }

  function openStream(nowMs) {
    closeStream();
    const s = makeStream();
    stream = s;
    streamAlive = true;
    s.on("data", (msg) => {
      const status = normalizeBearStatus(msg);
      buffer.push({ externalId: status.externalId, at: status.at, raw: msg, status });
    });
    const onDrop = (reason) => {
      if (stream !== s) return; // stale stream, already replaced
      streamAlive = false;
      failures += 1;
      nextAttemptMs = nowMsRef + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 6));
      log(`bear stream dropped (${String(reason).slice(0, 120)}); failure #${failures}`, "warning");
    };
    s.on("error", onDrop);
    s.on("end", () => onDrop("stream ended"));
  }

  function closeStream() {
    if (stream) {
      try {
        stream.cancel?.();
      } catch { /* already dead */ }
    }
    stream = null;
    streamAlive = false;
  }

  // Captured for the drop handler so backoff anchors to engine time, not wall time.
  let nowMsRef = 0;

  return {
    name: "bear",

    async init() {
      // Robot listing is a plain unary REST call; the stream is gRPC-only.
      try {
        await ensureToken(nowMsRef || Date.now());
        const res = await fetchImpl(`${bearCfg.rest_base}/robot-ids/list`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = await res.json();
          robotIds = body.robot_ids ?? body.robotIds ?? (Array.isArray(body) ? body : []);
        }
      } catch (err) {
        log(`bear init failed (will retry from tick): ${String(err).slice(0, 150)}`, "warning");
      }
      return robotIds.map((id) => ({ externalId: id, displayName: id, brand: "Bear", category: "delivery" }));
    },

    async tick(nowMs) {
      nowMsRef = nowMs;
      const events = buffer;
      buffer = [];

      try {
        await ensureToken(nowMs);
      } catch (err) {
        closeStream();
        return { events, heartbeat: { state: "down", detail: String(err).slice(0, 200) } };
      }

      if (!streamAlive && nowMs >= nextAttemptMs) {
        try {
          openStream(nowMs);
        } catch (err) {
          failures += 1;
          nextAttemptMs = nowMs + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 6));
          log(`bear stream open failed: ${String(err).slice(0, 150)}`, "warning");
        }
      }

      if (streamAlive) {
        failures = 0;
        return { events, heartbeat: { state: "ok", detail: null } };
      }
      const state = failures >= MAX_FAILURES_BEFORE_DOWN ? "down" : "degraded";
      return { events, heartbeat: { state, detail: `stream not connected (failures: ${failures})` } };
    },

    async stop() {
      closeStream();
    },
  };
}

function jwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Real gRPC transport. Loaded lazily so the demo path never needs the deps
// installed, and tests never touch it (they inject a fake streamFactory).
// Vendored protos are discovered by scanning for a service that exposes
// SubscribeRobotStatus, so Bear renaming a package doesn't break the loader.
function createGrpcStream(bearCfg, token, robotIds) {
  throw Object.assign(new Error("gRPC transport not wired in this process — use createGrpcStreamFactory()"), { code: "GRPC_NOT_WIRED" });
}

export async function createGrpcStreamFactory(bearCfg, { protoDir }) {
  const [{ default: grpc }, { default: protoLoader }] = await Promise.all([
    import("@grpc/grpc-js").then((m) => ({ default: m })),
    import("@grpc/proto-loader").then((m) => ({ default: m })),
  ]);
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  const protoFiles = readdirSync(protoDir)
    .filter((f) => f.endsWith(".proto"))
    .map((f) => join(protoDir, f));
  if (protoFiles.length === 0) {
    throw new Error(`no .proto files in ${protoDir} — see proto/bear/README.md for how to vendor Bear's protos`);
  }
  const packageDef = protoLoader.loadSync(protoFiles, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    includeDirs: [protoDir],
  });
  const loaded = grpc.loadPackageDefinition(packageDef);

  const ServiceCtor = findServiceWithMethod(loaded, "SubscribeRobotStatus");
  if (!ServiceCtor) {
    throw new Error("no service exposing SubscribeRobotStatus found in vendored protos");
  }

  return ({ token: liveToken, robotIds: ids }) => {
    const client = new ServiceCtor(bearCfg.grpc_host, grpc.credentials.createSsl());
    const metadata = new grpc.Metadata();
    metadata.add("authorization", `Bearer ${liveToken}`);
    const selector = ids?.length ? { robot_ids: { ids } } : {};
    return client.SubscribeRobotStatus({ selector }, metadata);
  };
}

function findServiceWithMethod(node, methodName, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  for (const value of Object.values(node)) {
    if (typeof value === "function" && value.service) {
      const methods = Object.keys(value.service);
      if (methods.some((m) => m.toLowerCase().endsWith(methodName.toLowerCase()))) return value;
    }
    const nested = findServiceWithMethod(value, methodName, depth + 1);
    if (nested) return nested;
  }
  return null;
}
