// The tick loop. Owns time: everything downstream gets nowMs injected, so the
// same engine runs live (wall clock), in the demo (scaled virtual clock), and
// in the future backtest replay (historical clock) without code changes.
//
// Per runOnce(nowMs):
//   1. each connector ticks (with a watchdog timeout) → raw events + snapshots
//   2. connector heartbeat is persisted — separate from robot status, always
//   3. on eval cadence: rollups recompute, rules evaluate, flags apply
import { computeRollups } from "./rollup.mjs";
import { RULES, ruleParams, clearAfterMs } from "./rules.mjs";
import { computeFlagChanges, applyFlagChanges } from "./flags.mjs";
import { validateStatus } from "./normalize.mjs";

const DAY = 86_400_000;

export function createEngine({ store, connectors, config, log = () => {} }) {
  const engineCfg = config.engine ?? {};
  const evalMs = engineCfg.eval_ms ?? 60_000;
  const bucketMs = engineCfg.rollup_bucket_ms ?? 3_600_000;
  const tickTimeoutMs = engineCfg.tick_timeout_ms ?? 20_000;
  const recomputeWindowMs = 2 * DAY; // older buckets are final; only recent ones move

  let lastEvalMs = null;
  let invalidCount = 0;

  async function init(nowMs) {
    for (const c of connectors) {
      const meta = await c.init();
      for (const m of meta ?? []) {
        store.upsertRobot(
          { connector: c.name, externalId: m.externalId, displayName: m.displayName, brand: m.brand, model: m.model, category: m.category },
          nowMs
        );
      }
    }
  }

  async function tickConnector(c, nowMs) {
    try {
      return await withTimeout(c.tick(nowMs), tickTimeoutMs, `tick timeout after ${tickTimeoutMs}ms`);
    } catch (err) {
      return { events: [], heartbeat: { state: "down", detail: String(err).slice(0, 200) } };
    }
  }

  /** Land one connector's events. Extracted from runOnce so history backfill
   * (see backfill.mjs) lands through EXACTLY this path rather than a parallel
   * copy of it: a seeding routine that drifts from the live ingest is a demo
   * that shows something the product does not do.
   *
   * storeRaw=false skips the raw_events archive. Backfill generates six figures
   * of synthetic rows whose JSON payload dwarfs everything else in the file,
   * and replaying a simulator is not an audit trail worth keeping. */
  function ingest(connectorName, events, receivedAtMs, { storeRaw = true } = {}) {
    const source = connectorName === "sim" ? "sim" : "live";
    for (const ev of events ?? []) {
      const robotKey = `${connectorName}:${ev.externalId}`;
      const rawEventId = storeRaw
        ? store.insertRawEvent({
            connector: connectorName,
            robotKey,
            kind: "status",
            source,
            at: ev.at,
            receivedAt: receivedAtMs,
            seq: ev.status?.seq ?? null,
            payload: ev.raw ? JSON.stringify(ev.raw) : null,
          })
        : null;
      const problems = validateStatus(ev.status);
      if (problems.length > 0) {
        invalidCount += 1;
        if (invalidCount <= 3 || invalidCount % 100 === 0) {
          log(`invalid status from ${robotKey} dropped: ${problems.join("; ")} (total ${invalidCount})`, "warning");
        }
        continue;
      }
      const robotId = store.upsertRobot({ connector: connectorName, externalId: ev.externalId }, receivedAtMs);
      const s = ev.status;
      const snapshotId = store.insertSnapshot({
        robotId,
        rawEventId,
        at: s.at,
        receivedAt: receivedAtMs,
        connector: connectorName,
        source,
        connectionState: s.connectionState,
        batteryPct: s.batteryPct,
        charging: s.charging,
        eStop: s.eStop,
        missionState: s.missionState,
        missionId: s.missionId,
        stuck: s.stuck,
        moving: s.moving,
        errors: s.errors,
        pose: s.pose,
      });

      // Vendor-specific extras. Absent for Bear and for CSV imports, which is
      // why they live beside the snapshot rather than inside it.
      if (s.condition) {
        store.insertCondition({ snapshotId, robotId, at: s.at, ...s.condition });
      }
      if (s.wear?.length) {
        store.insertComponentWear(robotId, s.at, s.wear);
      }
    }
  }

  async function runOnce(nowMs) {
    for (const c of connectors) {
      const { events, heartbeat } = await tickConnector(c, nowMs);
      store.insertHeartbeat({ connector: c.name, at: nowMs, state: heartbeat?.state ?? "down", detail: heartbeat?.detail ?? null });
      ingest(c.name, events, nowMs);
    }

    if (lastEvalMs === null || nowMs - lastEvalMs >= evalMs) {
      lastEvalMs = nowMs;
      evaluate(nowMs);
    }
  }

  function evaluate(nowMs) {
    const robots = store.listRobots();
    const results = [];

    // The recompute window MUST start on a bucket boundary. upsertRollup
    // overwrites a bucket wholesale, so a window starting mid-bucket recomputes
    // that bucket from only the snapshots after the cut and clobbers the
    // complete row with a partial one. Left unaligned, the trailing edge sweeps
    // forward an eval at a time and grinds every historical bucket down to a
    // single sample, which is exactly what happened to 93% of the rows in the
    // demo database before this line existed.
    const from = Math.floor((nowMs - recomputeWindowMs) / bucketMs) * bucketMs;

    for (const robot of robots) {
      // Refresh the buckets that can still change.
      const recent = store.snapshotsBetween(robot.id, from, nowMs);
      for (const b of computeRollups(recent, bucketMs)) store.upsertRollup({ robotId: robot.id, ...b });

      const ctx = {
        robot,
        latest: store.latestSnapshot(robot.id),
        lastOnlineAt: store.latestOnlineAt(robot.id),
        window24h: store.snapshotsBetween(robot.id, nowMs - DAY, nowMs),
        rollups: store.rollupsBetween(robot.id, nowMs - 8 * DAY, nowMs),
        wear: store.latestComponentWear(robot.id),
        conditions24h: store.conditionsBetween(robot.id, nowMs - DAY, nowMs),
        heartbeatState: store.latestHeartbeat(robot.connector)?.state ?? "ok",
        nowMs,
      };
      for (const rule of RULES) {
        if (rule.scope !== "robot") continue;
        const res = rule.eval(ctx, ruleParams(rule, config, robot.category));
        if (res) {
          results.push({
            scope: `robot:${robot.robot_key}`,
            ruleId: rule.id,
            dimension: rule.dimension,
            severity: res.severity,
            robotId: robot.id,
            evidence: res.evidence,
          });
        }
      }
    }

    for (const c of connectors) {
      const ctx = { connector: c.name, heartbeats: store.heartbeatsBetween(c.name, nowMs - DAY, nowMs), nowMs };
      for (const rule of RULES) {
        if (rule.scope !== "connector") continue;
        const res = rule.eval(ctx, ruleParams(rule, config, null));
        if (res) {
          results.push({
            scope: `connector:${c.name}`,
            ruleId: rule.id,
            dimension: rule.dimension,
            severity: res.severity,
            connector: c.name,
            evidence: res.evidence,
          });
        }
      }
    }

    const changes = computeFlagChanges({
      activeFlags: store.activeFlags(),
      results,
      nowMs,
      clearAfterMsFor: (ruleId) => clearAfterMs(RULES.find((r) => r.id === ruleId), config),
    });
    applyFlagChanges(store, changes, { nowMs, log });
  }

  async function stop() {
    for (const c of connectors) await c.stop();
  }

  return { init, runOnce, ingest, evaluate, stop };
}

/** Virtual clock: now() maps real elapsed time onto scaled sim time. */
export function createClock({ scale = 1, startMs, realNow = Date.now } = {}) {
  const anchorReal = realNow();
  const anchorSim = startMs ?? anchorReal;
  return { now: () => anchorSim + (realNow() - anchorReal) * scale, scale };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}
