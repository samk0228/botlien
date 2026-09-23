// Gausium (gs-robot) connector. Same interface as sim and bear:
// { name, init, tick, stop }.
//
// Unlike Bear, which pushes over a gRPC stream, Gausium's status is a plain
// REST read per robot, so this connector polls. All lifecycle — token refresh,
// poll cadence, backoff — happens inside tick with no self-timers, which is
// what lets the whole thing be tested against a fake fetch on a fixed clock.
//
// Heartbeat semantics match bear.mjs: ok = authed and the last sweep read at
// least one robot; degraded = transient failures; down = auth rejected or too
// many consecutive failed sweeps.
import { normalizeGausiumStatus } from "../normalize.mjs";

const MIN = 60_000;
const MAX_FAILURES_BEFORE_DOWN = 5;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 5 * MIN;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export function createGausiumConnector(cfg, secrets, deps = {}) {
  const { log = () => {}, fetchImpl = fetch } = deps;
  const base = cfg.base ?? "https://openapi.gs-robot.com";
  const refreshMarginMs = (cfg.token_refresh_margin_min ?? 5) * MIN;
  const pollMs = (cfg.poll_sec ?? 60) * 1000;

  let token = null;
  let tokenExpMs = null;
  let authFailed = false;
  let robots = [];
  let failures = 0;
  let nextPollMs = 0;

  async function authenticate(nowMs) {
    const res = await fetchImpl(`${base}/gas/api/v1alpha1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:gaussian:params:oauth:grant-type:open-access-token",
        client_id: secrets.client_id,
        client_secret: secrets.client_secret,
        open_access_key: secrets.open_access_key,
      }),
    });
    if (!res.ok) {
      authFailed = true;
      throw new Error(`Gausium auth rejected: HTTP ${res.status}`);
    }
    const body = await res.json();
    token = body.access_token ?? null;
    if (!token) {
      authFailed = true;
      throw new Error("Gausium auth response had no access_token");
    }
    authFailed = false;
    // The vendor returns expires_in as an absolute epoch-ms, not a duration.
    // Treating it as seconds would re-auth on every single tick.
    const raw = Number(body.expires_in);
    tokenExpMs = raw > 1e12 ? raw : nowMs + (Number.isFinite(raw) && raw > 0 ? raw * 1000 : 3600) * 1000;
  }

  async function ensureToken(nowMs) {
    if (token && nowMs < tokenExpMs - refreshMarginMs) return;
    await authenticate(nowMs);
  }

  async function apiGet(path, params = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async function listRobots() {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await apiGet("/v1alpha1/robots", { page, pageSize: PAGE_SIZE, relation: "contract" });
      const batch = body.robots ?? [];
      all.push(...batch);
      const total = Number(body.total ?? 0);
      if (batch.length < PAGE_SIZE || (total && all.length >= total)) break;
    }
    return all;
  }

  return {
    name: "gausium",

    /** Check a set of keys before they are saved: authenticate and list the
     *  robots on the account. Unlike init(), which logs and carries on so a
     *  running process survives a vendor outage, this throws, because the
     *  owner is standing at the form waiting to hear whether the keys work. */
    async probe(nowMs = Date.now()) {
      await authenticate(nowMs);
      robots = await listRobots();
      return {
        robotCount: robots.length,
        robots: robots.slice(0, 50).map((r) => ({ externalId: r.serialNumber, displayName: r.displayName ?? r.serialNumber, model: r.modelTypeCode ?? null })),
      };
    },

    async init() {
      try {
        await ensureToken(Date.now());
        robots = await listRobots();
      } catch (err) {
        log(`gausium init failed (will retry from tick): ${String(err).slice(0, 150)}`, "warning");
      }
      return robots.map((r) => ({
        externalId: r.serialNumber,
        displayName: r.displayName ?? r.serialNumber,
        brand: "Gausium",
        model: r.modelTypeCode ?? r.modelFamilyCode ?? null,
        // Every Gausium machine in the catalogue is a cleaner. Hard-coding this
        // is what makes the coverage statement price the work per square metre
        // instead of per delivery run.
        category: "cleaning",
      }));
    },

    async tick(nowMs) {
      if (nowMs < nextPollMs) {
        return { events: [], heartbeat: healthy(failures, robots.length) };
      }

      try {
        await ensureToken(nowMs);
      } catch (err) {
        nextPollMs = nowMs + backoff(++failures);
        return { events: [], heartbeat: { state: "down", detail: String(err).slice(0, 200) } };
      }

      // Re-list on the first successful poll, and whenever the fleet emptied —
      // a robot added to the account mid-run should appear without a restart.
      if (robots.length === 0) {
        try {
          robots = await listRobots();
        } catch (err) {
          log(`gausium robot list failed: ${String(err).slice(0, 150)}`, "warning");
        }
      }

      const events = [];
      let readFailures = 0;
      for (const r of robots) {
        try {
          const status = await apiGet(`/v1alpha1/robots/${encodeURIComponent(r.serialNumber)}/status`);
          // serialNumber is not echoed inside every model's status body, so it
          // is injected from the listing rather than trusted from the response.
          const normalized = normalizeGausiumStatus({ serialNumber: r.serialNumber, ...status }, { at: nowMs });
          events.push({ externalId: normalized.externalId, at: normalized.at, raw: status, status: normalized });
        } catch (err) {
          readFailures += 1;
          log(`gausium status ${r.serialNumber}: ${String(err).slice(0, 120)}`, "warning");
        }
      }

      nextPollMs = nowMs + pollMs;

      // A sweep counts as failed only if every robot failed. One unreachable
      // robot out of ten is a robot problem, not a pipe problem, and the
      // offline_duration rule is gated on the pipe being healthy.
      if (robots.length > 0 && readFailures === robots.length) {
        nextPollMs = nowMs + backoff(++failures);
      } else {
        failures = 0;
      }
      return { events, heartbeat: healthy(failures, robots.length) };
    },

    async stop() {
      token = null;
    },
  };

  function healthy(f, robotCount) {
    if (authFailed) return { state: "down", detail: "auth rejected" };
    if (f === 0) {
      return robotCount === 0
        ? { state: "degraded", detail: "authed but no robots on contract" }
        : { state: "ok", detail: null };
    }
    return f >= MAX_FAILURES_BEFORE_DOWN
      ? { state: "down", detail: `${f} consecutive failed sweeps` }
      : { state: "degraded", detail: `${f} failed sweep(s)` };
  }
}

function backoff(failures) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 6));
}
