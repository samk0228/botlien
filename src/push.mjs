// Pushing robot status in: POST /api/v1/events with an account's API key.
// For integrators, fleet software and any make we have no connector for.
// Events land through the engine's own ingest, the path a live vendor sync
// takes, so a pushed robot reads on the dashboard exactly like a connected one.
//
// One event, in the same field names the file import takes:
//   { "robot_id": "AMR-7", "at": "2026-09-23T14:05:00Z",
//     "connection_state": "online", "battery_pct": 81, "charging": false,
//     "e_stop": false, "mission_state": "active", "mission_id": "m-551",
//     "stuck": false, "moving": true, "errors": [{ "code": "E-217", "severity": "ERROR" }],
//     "pose": { "x": 12.5, "y": 4.0 },
//     "name": "Picker 7", "brand": "Locus", "model": "LocusBot", "category": "picking" }
// Only robot_id and at are required. name/brand/model/category are read the
// first time a robot is seen.
import { createHash, randomBytes } from "node:crypto";
import { createEngine } from "./engine.mjs";
import { toEpochMs } from "./normalize.mjs";
import { computeRollups } from "./rollup.mjs";
import { BENCHMARKS } from "./rates.mjs";

export const PUSH_CONNECTOR = "push";
export const MAX_EVENTS = 1000;
export const MAX_KEYS = 5;
const KEY_PREFIX = "blk_";

export function newApiKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 10), keyHash: hashApiKey(key) };
}

export function hashApiKey(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

/** The bearer token from an Authorization header, if it looks like ours. */
export function bearerKey(header) {
  const m = /^Bearer\s+(blk_[A-Za-z0-9_-]{20,})$/.exec(String(header ?? "").trim());
  return m ? m[1] : null;
}

const bool = (v) => (v === undefined || v === null || v === "" ? null : v === true || v === 1 || /^(true|1|yes|y)$/i.test(String(v)));
const num = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, max = 120) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, max));

/** One pushed event as the engine's { externalId, at, status } plus the
 *  robot's details, or { problems } when it cannot be used. */
export function normalizePushEvent(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return { problems: ["event is not an object"] };
  const externalId = str(e.robot_id ?? e.external_id ?? e.serial, 80);
  const at = toEpochMs(e.at ?? e.timestamp ?? e.time);
  const conn = str(e.connection_state)?.toLowerCase() ?? (bool(e.online) === null ? null : bool(e.online) ? "online" : "offline");
  let errors = null;
  if (Array.isArray(e.errors)) errors = e.errors.slice(0, 20).map((x) => (typeof x === "object" && x ? { code: str(x.code, 60), severity: str(x.severity, 20) } : { code: str(x, 60), severity: null }));
  const pose = e.pose && typeof e.pose === "object" && num(e.pose.x) !== null && num(e.pose.y) !== null ? { x: num(e.pose.x), y: num(e.pose.y) } : null;
  const status = {
    externalId,
    at,
    connectionState: conn,
    batteryPct: num(e.battery_pct ?? e.battery),
    charging: bool(e.charging),
    eStop: bool(e.e_stop),
    missionState: str(e.mission_state ?? e.state, 40),
    missionId: str(e.mission_id, 120),
    stuck: bool(e.stuck),
    moving: bool(e.moving),
    errors: errors ? JSON.stringify(errors) : null,
    pose,
  };
  const problems = [];
  if (!externalId) problems.push("missing robot_id");
  if (!at) problems.push("missing or unreadable at");
  else if (at > Date.now() + 10 * 60_000) problems.push("at is in the future");
  if (status.batteryPct !== null && (status.batteryPct < 0 || status.batteryPct > 100)) problems.push("battery_pct must be 0 to 100");
  if (conn && !["online", "offline"].includes(conn)) problems.push("connection_state must be online or offline");
  if (problems.length) return { problems };
  const category = str(e.category, 40);
  return {
    event: { externalId, at, status },
    robot: { displayName: str(e.name, 80), brand: str(e.brand, 40), model: str(e.model, 80), category: category && BENCHMARKS[category] ? category : null },
  };
}

/** Land a batch for one account. Returns what was accepted and, per index,
 *  why anything was not. */
export function pushEvents(store, body, nowMs, config = {}) {
  const list = Array.isArray(body) ? body : body?.events;
  if (!Array.isArray(list)) return { error: "Send { \"events\": [ ... ] }." };
  if (list.length > MAX_EVENTS) return { error: `At most ${MAX_EVENTS} events per request.` };
  const good = [];
  const rejected = [];
  list.forEach((e, index) => {
    const n = normalizePushEvent(e);
    if (n.problems) rejected.push({ index, problems: n.problems });
    else good.push(n);
  });
  const touched = new Map(); // robot id -> [minAt, maxAt]
  store.transaction(() => {
    for (const { event, robot } of good) {
      const id = store.upsertRobot({ connector: PUSH_CONNECTOR, externalId: event.externalId, ...robot, category: robot.category ?? "delivery" }, nowMs);
      const span = touched.get(id) ?? [event.at, event.at];
      touched.set(id, [Math.min(span[0], event.at), Math.max(span[1], event.at)]);
    }
    const engine = createEngine({ store, connectors: [], config });
    engine.ingest(PUSH_CONNECTOR, good.map((g) => ({ ...g.event, raw: null })), nowMs);
    // Refresh only the hourly buckets these events fall in, aligned to the
    // bucket so a bucket is never overwritten from part of its samples.
    const bucketMs = config.engine?.rollup_bucket_ms ?? 3_600_000;
    for (const [id, [from, to]] of touched) {
      const a = Math.floor(from / bucketMs) * bucketMs;
      const b = Math.floor(to / bucketMs) * bucketMs + bucketMs - 1;
      for (const r of computeRollups(store.snapshotsBetween(id, a, b), bucketMs)) store.upsertRollup({ robotId: id, ...r });
    }
  });
  return { accepted: good.length, rejected, robots: touched.size };
}
