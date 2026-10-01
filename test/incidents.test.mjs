import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { classify, reconcile, escalationDue, incidentView, usualPace, REOPEN_MS, ESCALATE_AFTER_MS } from "../src/incidents.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);
const T0 = at("2026-10-01T21:14:00Z"); // 2:14 pm Pacific

const snap = (o = {}) => ({ at: T0, stuck: 0, e_stop: 0, errors: null, connection_state: "online", ...o });

test("a sample is classified by the worst thing it says, warnings are not stops", () => {
  assert.equal(classify(snap()), null);
  assert.equal(classify(snap({ errors: JSON.stringify([{ code: "UR-SAFETY-2", severity: "WARNING", description: "reduced" }]) })), null);
  assert.deepEqual(classify(snap({ stuck: 1, errors: JSON.stringify([{ code: "UR-SAFETY-3", severity: "WARNING", description: "protective stop" }]) })), { kind: "stop", code: "UR-SAFETY-3", description: "protective stop", severity: "critical" });
  assert.equal(classify(snap({ stuck: 1, e_stop: 1 })).kind, "e-stop");
  assert.deepEqual(classify(snap({ errors: JSON.stringify([{ code: "locus:E-217", severity: "ERROR" }]) })), { kind: "fault", code: "locus:E-217", description: null, severity: "critical" });
  assert.equal(classify(snap({ connection_state: "offline" })).kind, "offline");
  assert.equal(classify(snap({ errors: "not json" })), null);
});

function robotStore() {
  const s = openStore(":memory:");
  const id = s.upsertRobot({ connector: "push", externalId: "cell-2", displayName: "Cell 2 UR10e", brand: "Universal Robots", model: "UR10e", category: "machine_tending" }, T0 - MIN);
  const robot = s.listRobots().find((r) => r.id === id);
  const push = (t, o = {}) => s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: true, stuck: false, ...o });
  return { s, id, robot, push };
}

test("a stop opens an incident, keeps it while the samples say so, and the first good sample closes it", () => {
  const { s, robot, push } = robotStore();
  push(T0 - 30_000);
  assert.deepEqual(reconcile(s, robot, T0), { incident: null, change: null }, "a working robot has nothing to record");

  push(T0, { stuck: true, moving: false, errors: [{ code: "UR-SAFETY-3", severity: "WARNING", description: "protective stop" }] });
  const opened = reconcile(s, robot, T0 + 5_000);
  assert.equal(opened.change, "opened");
  assert.deepEqual([opened.incident.kind, opened.incident.started_at, opened.incident.status, opened.incident.repeats], ["stop", T0, "open", 1]);
  assert.equal(reconcile(s, robot, T0 + 10_000).change, null, "the same sample again changes nothing");

  push(T0 + MIN, { stuck: true, moving: false, eStop: true });
  const worse = reconcile(s, robot, T0 + MIN + 5_000);
  assert.equal(worse.change, "updated");
  assert.equal(worse.incident.kind, "e-stop", "an emergency stop outranks the protective stop it started as");
  assert.equal(worse.incident.last_seen_at, T0 + MIN);

  push(T0 + 12 * MIN);
  const closed = reconcile(s, robot, T0 + 12 * MIN + 5_000);
  assert.equal(closed.change, "closed");
  assert.equal(closed.incident.ended_at, T0 + 12 * MIN);
  assert.equal(s.openIncidents().length, 0);
});

test("a stop that returns within ten minutes is the same incident with one more repeat; later it is a new one", () => {
  const { s, robot, push } = robotStore();
  push(T0, { stuck: true, moving: false });
  reconcile(s, robot, T0);
  push(T0 + 2 * MIN);
  reconcile(s, robot, T0 + 2 * MIN);
  push(T0 + 2 * MIN + REOPEN_MS, { stuck: true, moving: false });
  const again = reconcile(s, robot, T0 + 2 * MIN + REOPEN_MS);
  assert.equal(again.change, "reopened");
  assert.deepEqual([again.incident.repeats, again.incident.status, again.incident.ended_at, again.incident.started_at], [2, "open", null, T0]);
  push(T0 + 3 * MIN + REOPEN_MS);
  reconcile(s, robot, T0 + 3 * MIN + REOPEN_MS);
  push(T0 + 4 * MIN + 2 * REOPEN_MS, { stuck: true, moving: false });
  const fresh = reconcile(s, robot, T0 + 4 * MIN + 2 * REOPEN_MS);
  assert.equal(fresh.change, "opened");
  assert.equal(fresh.incident.repeats, 1);
  assert.equal(s.listIncidents().length, 2);
  // A different kind of stop is never a repeat of the last one.
  push(T0 + 5 * MIN + 2 * REOPEN_MS);
  reconcile(s, robot, T0 + 5 * MIN + 2 * REOPEN_MS);
  push(T0 + 6 * MIN + 2 * REOPEN_MS, { connectionState: "offline" });
  assert.equal(reconcile(s, robot, T0 + 6 * MIN + 2 * REOPEN_MS).change, "opened");
});

test("escalation is due ten minutes after the post, then ten after the lead was told, never once claimed", () => {
  const base = { status: "open", claimed_at: null, notified_at: T0, escalated: 0, escalated_at: null };
  assert.equal(escalationDue({ ...base, notified_at: null }, T0 + ESCALATE_AFTER_MS), 0, "an alert that never went out cannot escalate");
  assert.equal(escalationDue(base, T0 + ESCALATE_AFTER_MS - 1), 0);
  assert.equal(escalationDue(base, T0 + ESCALATE_AFTER_MS), 1);
  assert.equal(escalationDue({ ...base, escalated: 1, escalated_at: T0 + ESCALATE_AFTER_MS }, T0 + 2 * ESCALATE_AFTER_MS - 1), 0);
  assert.equal(escalationDue({ ...base, escalated: 1, escalated_at: T0 + ESCALATE_AFTER_MS }, T0 + 2 * ESCALATE_AFTER_MS), 2);
  assert.equal(escalationDue({ ...base, escalated: 2 }, T0 + 3 * ESCALATE_AFTER_MS), 0);
  assert.equal(escalationDue({ ...base, claimed_at: T0 + MIN }, T0 + ESCALATE_AFTER_MS), 0);
  assert.equal(escalationDue({ ...base, status: "closed" }, T0 + ESCALATE_AFTER_MS), 0);
});

test("the alert leads with what happened, then the time down, output and robot cost, and says what the dollars rest on", () => {
  const { robot } = robotStore();
  const inc = { id: 1, robot_id: robot.id, kind: "stop", code: "UR-SAFETY-3", description: "protective stop", status: "open", started_at: T0, last_seen_at: T0 + 12 * MIN, ended_at: null, repeats: 1, claimed_by: null, claimed_at: null, escalated: 0, escalated_at: null, notified_at: T0 + MIN };
  const contractRobot = { id: robot.id, name: "Cell 2 UR10e", unitLabel: "cycles", baselineReady: true, cost: { perHourCents: 437, estimated: true } };
  const v = incidentView(inc, { robot, contractRobot, tz: TZ, nowMs: T0 + 12 * MIN, lead: "U0LEAD01", pace: { perHour: 70, units: 700, hours: 10 } });
  assert.equal(v.headline, "Cell 2 UR10e hit a protective stop at 2:14 pm");
  assert.equal(v.cause, "Protective stop (UR-SAFETY-3)");
  assert.equal(v.downLine, "Down 12 min so far");
  assert.equal(v.outputLine, "About 14 cycles not made (its usual pace is 70 an hour)");
  assert.equal(v.costLine, "$0.87 in robot time (estimated, from list prices)");
  assert.equal(v.repeatsLine, null);
  assert.equal(v.claimLine, "Not claimed yet. <@U0LEAD01> gets it in 1 min", "the lead is named and the clock is honest");
  assert.deepEqual([v.open, v.claimed, v.minutes, v.costCents], [true, false, 12, 87]);

  // Own numbers, no baseline yet, a repeat, and a claim.
  const v2 = incidentView({ ...inc, repeats: 3, claimed_by: "<@U0DANA>", claimed_at: T0 + 6 * MIN }, { robot, contractRobot: { ...contractRobot, cost: { perHourCents: 437, estimated: false } }, tz: TZ, nowMs: T0 + 12 * MIN, pace: null });
  assert.equal(v2.outputLine, null, "no cycles claimed before the baseline");
  assert.equal(v2.costLine, "$0.87 in robot time (from your numbers)");
  assert.equal(v2.repeatsLine, "3rd stop in a row, each within 10 minutes of the last");
  assert.equal(v2.claimLine, "Claimed by <@U0DANA> at 2:20 pm");
  assert.equal(v2.claimed, true);

  // Back, and a service robot with no cost block.
  const back = incidentView({ ...inc, status: "closed", ended_at: T0 + 12 * MIN }, { robot: { ...robot, model: "LocusBot", category: "picking" }, contractRobot: null, tz: TZ, nowMs: T0 + 40 * MIN });
  assert.equal(back.headline, "Cell 2 UR10e is back after 12 min");
  assert.equal(back.downLine, "Was down 12 min, back at 2:26 pm");
  assert.equal(back.costLine, null);
  assert.equal(back.claimLine, null);
  assert.equal(incidentView({ ...inc, description: null, code: null }, { robot: { ...robot, model: "LocusBot", category: "picking" }, tz: TZ, nowMs: T0 + MIN }).headline, "Cell 2 UR10e got stuck at 2:14 pm");
  assert.equal(incidentView({ ...inc, kind: "offline", description: null, code: null }, { robot, tz: TZ, nowMs: T0 + MIN }).cause, "The gateway lost its link to the robot");
  assert.equal(incidentView({ ...inc, escalated: 2, escalated_at: T0 + 21 * MIN }, { robot, tz: TZ, nowMs: T0 + 22 * MIN, manager: "U0BOSS01" }).claimLine, "Nobody has claimed this. <@U0BOSS01> was told at 2:35 pm");
});

test("the usual pace comes from the last two weeks of rollups", () => {
  const { s, id } = robotStore();
  s.upsertRollup({ robotId: id, bucketStartAt: T0 - 3 * 3_600_000, bucketMs: 3_600_000, sampleCount: 120, onlineMs: 3_600_000, activeMs: 1_800_000, missionCount: 35, errorCount: 0, stuckEpisodes: 0, batteryMinPct: null, batteryMaxPct: null });
  s.upsertRollup({ robotId: id, bucketStartAt: T0 - 2 * 3_600_000, bucketMs: 3_600_000, sampleCount: 120, onlineMs: 3_600_000, activeMs: 3_600_000, missionCount: 70, errorCount: 0, stuckEpisodes: 0, batteryMinPct: null, batteryMaxPct: null });
  const pace = usualPace(s, id, T0);
  assert.equal(Math.round(pace.perHour), 70);
  assert.equal(usualPace(s, id, T0 - 4 * 3_600_000), null);
});
