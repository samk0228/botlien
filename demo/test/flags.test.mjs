import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES, ruleParams, clearAfterMs } from "../src/rules.mjs";
import { computeFlagChanges, applyFlagChanges } from "../src/flags.mjs";
import { openStore } from "../src/store.mjs";

const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const rule = (id) => RULES.find((r) => r.id === id);
const robot = { id: 1, robot_key: "sim:r1", first_seen_at: NOW - 30 * DAY, category: "delivery" };
const snap = (o) => ({ at: NOW, connection_state: "online", mission_state: "idle", stuck: 0, errors: null, battery_pct: 80, ...o });

test("offline_duration: warn, crit, and heartbeat gating", () => {
  const p = rule("offline_duration").defaults;
  const base = { robot, latest: snap({ at: NOW - 45 * MIN, connection_state: "offline" }), lastOnlineAt: NOW - 45 * MIN, window24h: [], rollups: [], nowMs: NOW, heartbeatState: "ok" };
  assert.equal(rule("offline_duration").eval(base, p).severity, "warn");
  assert.equal(rule("offline_duration").eval({ ...base, lastOnlineAt: NOW - 300 * MIN }, p).severity, "crit");
  // pipe down → no verdict on the robot
  assert.equal(rule("offline_duration").eval({ ...base, heartbeatState: "down" }, p), null);
  // online right now → null
  assert.equal(rule("offline_duration").eval({ ...base, latest: snap({ connection_state: "online" }) }, p), null);
});

test("error_severity: critical code → crit; recurring → warn", () => {
  const p = rule("error_severity").defaults;
  const critCtx = { robot, latest: snap({ errors: JSON.stringify([{ code: "bear:E210", severity: "CRITICAL" }]) }), window24h: [], nowMs: NOW };
  assert.equal(rule("error_severity").eval(critCtx, p).severity, "crit");
  const window = Array.from({ length: 6 }, (_, i) =>
    snap({ at: NOW - i * HOUR, errors: JSON.stringify([{ code: "sim:E100", severity: "WARNING" }]) })
  );
  const recurCtx = { robot, latest: snap({}), window24h: window, nowMs: NOW };
  assert.equal(rule("error_severity").eval(recurCtx, p).severity, "warn");
  assert.equal(rule("error_severity").eval({ robot, latest: snap({}), window24h: [], nowMs: NOW }, p), null);
});

test("stuck_state: continuous → crit; episodic → warn", () => {
  const p = rule("stuck_state").defaults;
  const stuckWindow = Array.from({ length: 15 }, (_, i) => snap({ at: NOW - (15 - i) * MIN, stuck: 1 }));
  const contCtx = { robot, latest: stuckWindow[stuckWindow.length - 1], window24h: stuckWindow, nowMs: NOW };
  assert.equal(rule("stuck_state").eval(contCtx, p).severity, "crit");

  const episodic = [];
  for (let i = 0; i < 7; i++) {
    episodic.push(snap({ at: NOW - (20 - 2 * i) * HOUR, stuck: 1 }));
    episodic.push(snap({ at: NOW - (20 - 2 * i) * HOUR + MIN, stuck: 0 }));
  }
  const epCtx = { robot, latest: snap({ stuck: 0 }), window24h: episodic, nowMs: NOW };
  assert.equal(rule("stuck_state").eval(epCtx, p).severity, "warn");
});

test("utilization_drop: drop vs baseline, floor guard", () => {
  const p = rule("utilization_drop").defaults;
  const rollups = [];
  // 7 baseline days: ~8h active/day in hourly buckets
  for (let d = 8; d >= 2; d--) {
    for (let h = 0; h < 24; h++) {
      rollups.push({ bucket_start_at: NOW - d * DAY + h * HOUR, bucket_ms: HOUR, active_ms: h < 8 ? HOUR : 0, battery_max_pct: 95 });
    }
  }
  // last 24h: nearly nothing
  for (let h = 0; h < 24; h++) {
    rollups.push({ bucket_start_at: NOW - DAY + h * HOUR, bucket_ms: HOUR, active_ms: 0, battery_max_pct: 95 });
  }
  const res = rule("utilization_drop").eval({ robot, rollups, nowMs: NOW }, p);
  assert.equal(res.severity, "crit");
  assert.ok(res.evidence.drop_pct >= 95, `drop ${res.evidence.drop_pct}`);

  // floor guard: an always-idle robot never flags
  const idle = rollups.map((r) => ({ ...r, active_ms: 0 }));
  assert.equal(rule("utilization_drop").eval({ robot, rollups: idle, nowMs: NOW }, p), null);
});

test("battery_degradation: fading daily max → warn (LGD dimension)", () => {
  const r = rule("battery_degradation");
  assert.equal(r.dimension, "lgd");
  const rollups = [];
  for (let d = 0; d < 6; d++) {
    rollups.push({ bucket_start_at: NOW - (6 - d) * DAY, bucket_ms: HOUR, active_ms: 0, battery_max_pct: 96 - d * 4 });
  }
  const res = r.eval({ robot, rollups, nowMs: NOW }, r.defaults);
  assert.equal(res.severity, "warn");
  assert.ok(res.evidence.fade_pct >= 15);
  // gentle fade → null
  const gentle = rollups.map((x, i) => ({ ...x, battery_max_pct: 96 - i }));
  assert.equal(r.eval({ robot, rollups: gentle, nowMs: NOW }, r.defaults), null);
});

test("connector_down: duration-based escalation", () => {
  const r = rule("connector_down");
  const p = r.defaults;
  const hbs = (mins, state) => mins.map((m) => ({ at: NOW - m * MIN, state, }));
  const short = [...hbs([20, 15, 10], "ok"), ...hbs([6, 3, 1], "down")].sort((a, b) => a.at - b.at);
  assert.equal(r.eval({ connector: "sim", heartbeats: short, nowMs: NOW }, p).severity, "warn");
  const long = [...hbs([90], "ok"), ...hbs([45, 30, 10, 1], "down")].sort((a, b) => a.at - b.at);
  assert.equal(r.eval({ connector: "sim", heartbeats: long, nowMs: NOW }, p).severity, "crit");
  const healthy = hbs([10, 5, 1], "ok").sort((a, b) => a.at - b.at);
  assert.equal(r.eval({ connector: "sim", heartbeats: healthy, nowMs: NOW }, p), null);
});

test("ruleParams merges config and per-category overrides", () => {
  const config = { rules: { stuck_state: { continuous_min: 20, byCategory: { humanoid: { continuous_min: 120 } } } } };
  assert.equal(ruleParams(rule("stuck_state"), config, "delivery").continuous_min, 20);
  assert.equal(ruleParams(rule("stuck_state"), config, "humanoid").continuous_min, 120);
  assert.equal(ruleParams(rule("stuck_state"), {}, "delivery").continuous_min, 10);
  assert.equal(clearAfterMs(rule("stuck_state"), { rules: { stuck_state: { clear_after_min: 45 } } }), 45 * MIN);
});

test("lifecycle: raise → touch → escalate → hysteresis clear, with dedupe", () => {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "flags.db"));
  const logs = [];
  const log = (msg, kind) => logs.push({ msg, kind });
  const clearAfter = () => 10 * MIN;
  const result = { scope: "robot:sim:r1", ruleId: "offline_duration", dimension: "pd", severity: "warn", robotId: 1, evidence: { offline_min: 45 } };

  // raise
  let ch = computeFlagChanges({ activeFlags: s.activeFlags(), results: [result], nowMs: NOW, clearAfterMsFor: clearAfter });
  assert.equal(ch.raise.length, 1);
  applyFlagChanges(s, ch, { nowMs: NOW, log });
  assert.equal(s.activeFlags().length, 1);
  assert.equal(logs[0].kind, "warning");

  // still firing at same severity → touch, no duplicate raise
  ch = computeFlagChanges({ activeFlags: s.activeFlags(), results: [result], nowMs: NOW + 5 * MIN, clearAfterMsFor: clearAfter });
  assert.equal(ch.raise.length, 0);
  assert.equal(ch.touch.length, 1);
  applyFlagChanges(s, ch, { nowMs: NOW + 5 * MIN, log });
  assert.equal(s.activeFlags().length, 1);

  // escalates to crit → needs_user
  ch = computeFlagChanges({ activeFlags: s.activeFlags(), results: [{ ...result, severity: "crit" }], nowMs: NOW + 10 * MIN, clearAfterMsFor: clearAfter });
  assert.equal(ch.escalate.length, 1);
  applyFlagChanges(s, ch, { nowMs: NOW + 10 * MIN, log });
  assert.equal(s.activeFlags()[0].severity, "crit");
  assert.ok(logs.some((l) => l.kind === "needs_user"));

  // condition gone, but inside hysteresis window → stays active
  ch = computeFlagChanges({ activeFlags: s.activeFlags(), results: [], nowMs: NOW + 15 * MIN, clearAfterMsFor: clearAfter });
  assert.equal(ch.clear.length, 0);

  // condition gone past hysteresis → clears; history retained
  ch = computeFlagChanges({ activeFlags: s.activeFlags(), results: [], nowMs: NOW + 25 * MIN, clearAfterMsFor: clearAfter });
  assert.equal(ch.clear.length, 1);
  applyFlagChanges(s, ch, { nowMs: NOW + 25 * MIN, log });
  assert.equal(s.activeFlags().length, 0);
  assert.equal(s.allFlags().length, 1);
  assert.equal(s.allFlags()[0].status, "cleared");
});
