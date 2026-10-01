import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { createVault } from "../src/vault.mjs";
import { saveInputs, InputError } from "../src/inputs.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { fleetContract } from "../src/contract.mjs";
import { saveSlackSettings } from "../src/slack.mjs";
import { validateLineMap, draftLineMap, resolveLineMap, timeline, findJams, stopImpacts, idleCost, summarizeLines, LineMapError, JAM_MIN_MS } from "../src/line.mjs";
import { createLineJob, stopsIn, jamText } from "../src/line-job.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const STEP = 15_000;
const T0 = Date.parse("2026-09-28T21:00:00Z"); // 2:00 pm Pacific, in the past
const vault = createVault({ keyB64: Buffer.alloc(32, 5).toString("base64") });

/** A CNC cell: Loader 1 feeds Mill A, which feeds Deburr; a conveyor sits
 *  between Deburr and Inspection. All four push their state. */
function cell() {
  const s = openStore(":memory:");
  setBusinessType(s, "manufacturing");
  s.setKV("owner.tz", TZ);
  const site = s.upsertSite("CNC cell 1", T0 - 86_400_000);
  const mk = (ext, name, model) => {
    const id = s.upsertRobot({ connector: "push", externalId: ext, displayName: name, brand: "Universal Robots", model, category: "machine_tending" }, T0 - 86_400_000);
    s.setRobotSite(id, site);
    return id;
  };
  const loader = mk("loader-1", "Loader 1", "UR10e"), deburr = mk("deburr", "Deburr", "UR5e"), inspect = mk("inspection", "Inspection", "UR3e");
  const push = (id, t, state, o = {}) => s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "push", source: "live", connectionState: "online", missionState: state, moving: state === "active", stuck: false, ...o });
  const map = { lines: [{ name: "CNC cell 1", stations: [{ kind: "robot", robotId: loader }, { kind: "machine", name: "Mill A" }, { kind: "robot", robotId: deburr }, { kind: "buffer", name: "conveyor", holds: 10 }, { kind: "robot", robotId: inspect }, { kind: "machine", name: "Laser marker" }] }] };
  s.setKV(KV_CONFIRMED, "1");
  return { s, loader, deburr, inspect, push, map };
}

test("a line map is checked against the account's robots and tidied", () => {
  const { s, loader, deburr, inspect, map } = cell();
  const ids = new Set(s.listRobots().map((r) => r.id));
  const ok = validateLineMap({ lines: [{ name: " CNC cell 1 ", stations: [{ kind: "robot", robotId: String(loader), twin: " loaders " }, { kind: "machine", name: "Mill A " }, { kind: "buffer", name: "conveyor", holds: "10" }, { kind: "robot", robotId: deburr }] }] }, ids);
  assert.deepEqual(ok, { lines: [{ name: "CNC cell 1", stations: [{ kind: "robot", robotId: loader, twin: "loaders" }, { kind: "machine", name: "Mill A" }, { kind: "buffer", name: "conveyor", holds: 10 }, { kind: "robot", robotId: deburr }] }] });
  assert.equal(validateLineMap(null, ids), null);
  const bad = (m, re) => assert.throws(() => validateLineMap(m, ids), re);
  bad({ lines: [{ name: "A", stations: [{ kind: "robot", robotId: 999 }] }] }, /robot 999 is not on this account/);
  bad({ lines: [{ name: "A", stations: [{ kind: "robot", robotId: loader }, { kind: "robot", robotId: loader }] }] }, /on the line twice/);
  bad({ lines: [{ name: "A", stations: [{ kind: "robot", robotId: loader }] }, { name: "B", stations: [{ kind: "robot", robotId: loader }] }] }, /on the line twice/);
  bad({ lines: [{ name: "A", stations: [{ kind: "machine", name: "" }, { kind: "robot", robotId: loader }] }] }, /needs a name/);
  bad({ lines: [{ name: "A", stations: [{ kind: "conveyor", name: "x" }] }] }, /robot, machine or buffer/);
  bad({ lines: [{ name: "A", stations: [{ kind: "machine", name: "Mill" }] }] }, /has no robot/);
  bad({ lines: [{ name: "A", stations: [{ kind: "robot", robotId: loader }] }, { name: "a", stations: [{ kind: "robot", robotId: deburr }] }] }, /Two lines are called/);
  bad({ lines: "x" }, /A line map is/);
  bad({ lines: [{ name: "A", stations: [{ kind: "buffer", name: "c", holds: 1.5 }, { kind: "robot", robotId: inspect }] }] }, /whole number/);
  assert.ok(new LineMapError("x") instanceof Error);
  assert.equal(map.lines[0].stations.length, 6);
});

test("the owner's map saves through inputs, is checked there too, and the contract carries it or a draft", () => {
  const { s, loader, deburr, inspect, map } = cell();
  const drafted = fleetContract(s, T0);
  assert.equal(drafted.lineMap.drafted, true);
  assert.deepEqual(drafted.lineMap.lines.map((l) => [l.name, l.stations.map((st) => st.name)]), [["CNC cell 1", ["Loader 1", "Deburr", "Inspection"]]]);
  assert.equal(drafted.provenance.lineMap, "drafted");
  assert.throws(() => saveInputs(s, { account: { lineMap: { lines: [{ name: "A", stations: [{ kind: "robot", robotId: 999 }] }] } } }, T0), InputError);
  saveInputs(s, { account: { lineMap: map } }, T0);
  const c = fleetContract(s, T0);
  assert.equal(c.lineMap.drafted, false);
  assert.equal(c.provenance.lineMap, "owner");
  assert.deepEqual(c.lineMap.lines[0].stations.map((st) => st.kind === "robot" ? `${st.name} (${st.model})` : `${st.kind}:${st.name}`), ["Loader 1 (UR10e)", "machine:Mill A", "Deburr (UR5e)", "buffer:conveyor", "Inspection (UR3e)", "machine:Laser marker"]);
  assert.deepEqual(c.inputs.account.lineMap, map, "restored into the page as saved");
  saveInputs(s, { account: { lineMap: null } }, T0);
  assert.equal(fleetContract(s, T0).lineMap.drafted, true, "null puts the draft back");
  void loader; void deburr; void inspect;
});

test("the draft is one line per site in the order robots were seen", () => {
  const robots = [{ id: 1, site_id: 7 }, { id: 2, site_id: 8 }, { id: 3, site_id: 7 }];
  assert.deepEqual(draftLineMap(robots, [{ id: 7, name: "Pier 4" }, { id: 8, name: "Marina" }]), { drafted: true, lines: [{ name: "Pier 4", stations: [{ kind: "robot", robotId: 1 }, { kind: "robot", robotId: 3 }] }, { name: "Marina", stations: [{ kind: "robot", robotId: 2 }] }] });
  assert.equal(draftLineMap([{ id: 1, site_id: null }], []).lines[0].name, "Main line");
  assert.equal(resolveLineMap(null, []), null);
});

test("a timeline reads each robot's state at every step, and forgets a sample older than the gap", () => {
  const rows = { 1: [{ at: T0, connection_state: "online", mission_state: "active" }, { at: T0 + 30_000, connection_state: "online", mission_state: "waiting" }, { at: T0 + 10 * MIN, connection_state: "online", mission_state: "active" }] };
  const tl = timeline(rows, T0, T0 + 10 * MIN);
  assert.equal(tl.times.length, 41);
  assert.deepEqual(tl.states[1].slice(0, 4), ["working", "working", "waiting", "waiting"]);
  assert.equal(tl.states[1][22], "waiting", "five minutes after the sample, still within the gap");
  assert.equal(tl.states[1][23], null, "past five minutes without a sample, nothing is known");
  assert.equal(tl.states[1][40], "working");
  assert.equal(timeline({ 2: [] }, T0, T0 + MIN).states[2].every((x) => x === null), true);
});

/** States per robot as runs: [["waiting", 8], ["working", 4]] = 8 steps then 4. */
const runs = (...parts) => parts.flatMap(([st, n]) => Array(n).fill(st));
const tlOf = (states, start = T0) => ({ times: Array.from({ length: Object.values(states)[0].length }, (_, k) => start + k * STEP), states, stepMs: STEP });

test("a machine between two waiting robots is a jam, unless a robot on the line is stopped, or it is over too soon", () => {
  const line = { name: "L", stations: [{ kind: "robot", robotId: 1 }, { kind: "machine", name: "Mill A" }, { kind: "robot", robotId: 2 }, { kind: "buffer", name: "conveyor" }, { kind: "robot", robotId: 3 }, { kind: "machine", name: "Laser" }] };
  // Both sides of Mill A wait for 12 steps (3 min) while Inspection keeps working.
  let tl = tlOf({ 1: runs(["working", 4], ["waiting", 12], ["working", 4]), 2: runs(["working", 4], ["waiting", 12], ["working", 4]), 3: runs(["working", 20]) });
  let jams = findJams(line, tl);
  assert.equal(jams.length, 1);
  assert.deepEqual([jams[0].station, jams[0].confidence, jams[0].open, jams[0].startedAt, jams[0].endedAt], ["Mill A", "both sides", false, T0 + 4 * STEP, T0 + 16 * STEP]);
  assert.deepEqual(jams[0].idle, { 1: 12 * STEP, 2: 12 * STEP });
  // Inspection waiting too during it is counted as idle because of it.
  tl = tlOf({ 1: runs(["working", 4], ["waiting", 12], ["working", 4]), 2: runs(["working", 4], ["waiting", 12], ["working", 4]), 3: runs(["working", 8], ["waiting", 8], ["working", 4]) });
  assert.deepEqual(findJams(line, tl)[0].idle, { 1: 12 * STEP, 2: 12 * STEP, 3: 8 * STEP });
  // A stop anywhere on the line outranks the jam for as long as it lasts.
  tl = tlOf({ 1: runs(["working", 4], ["waiting", 12], ["working", 4]), 2: runs(["working", 4], ["waiting", 12], ["working", 4]), 3: runs(["working", 6], ["stopped", 10], ["working", 4]) });
  assert.equal(findJams(line, tl).length, 0, "two steps of waiting before the stop is under the minimum");
  // Shorter than the minimum is a cycle's wait, not a jam.
  tl = tlOf({ 1: runs(["working", 4], ["waiting", 5], ["working", 11]), 2: runs(["working", 4], ["waiting", 5], ["working", 11]), 3: runs(["working", 20]) });
  assert.equal(findJams(line, tl, { minMs: JAM_MIN_MS }).length, 0);
  // Only the downstream side waiting (Deburr starved) is not enough with two sides known.
  tl = tlOf({ 1: runs(["working", 20]), 2: runs(["waiting", 20]), 3: runs(["working", 20]) });
  assert.equal(findJams(line, tl).length, 0);
  // The laser marker has one neighbour: Inspection waiting on it is a one-sided read.
  tl = tlOf({ 1: runs(["working", 20]), 2: runs(["working", 20]), 3: runs(["working", 2], ["waiting", 18]) });
  jams = findJams(line, tl);
  assert.deepEqual([jams[0].station, jams[0].confidence, jams[0].open], ["Laser", "one side", true]);
  assert.equal(jams[0].endedAt, T0 + 20 * STEP, "an open jam runs to the end of the timeline");
  // Nothing known (nulls) is not waiting.
  tl = tlOf({ 1: runs([null, 20]), 2: runs(["waiting", 20]), 3: runs(["working", 20]) });
  assert.equal(findJams(line, tl).length, 0);
});

test("a stop's impact is the other robots on its line waiting while it lasted", () => {
  const line = { name: "L", stations: [{ kind: "robot", robotId: 1 }, { kind: "machine", name: "Mill A" }, { kind: "robot", robotId: 2 }, { kind: "robot", robotId: 3 }] };
  const tl = tlOf({ 1: runs(["working", 4], ["stopped", 8], ["working", 8]), 2: runs(["working", 6], ["waiting", 10], ["working", 4]), 3: runs(["working", 20]) });
  const stops = stopsIn(tl, [1, 2, 3]);
  assert.deepEqual(stops, [{ robotId: 1, startedAt: T0 + 4 * STEP, endedAt: T0 + 12 * STEP }]);
  const impacts = stopImpacts(line, tl, stops);
  assert.deepEqual(impacts, [{ robotId: 1, startedAt: T0 + 4 * STEP, endedAt: T0 + 12 * STEP, open: false, idle: { 2: 6 * STEP } }]);
  assert.deepEqual(stopsIn(tlOf({ 1: runs(["working", 2], ["stopped", 3]) }), [1])[0].endedAt, null, "still stopped at the end");
  assert.deepEqual(idleCost({ 2: 6 * STEP, 3: 2 * STEP }, { 2: 338, 3: null }), { minutes: 2, cents: 8, priced: false });
  assert.deepEqual(idleCost({ 2: 60 * MIN }, { 2: 338 }), { minutes: 60, cents: 338, priced: true });
});

test("the line job records a jam, tells Slack once and again when it ends, records a stop's impact, and the contract sums the period", async () => {
  const c = cell();
  saveInputs(c.s, { account: { lineMap: c.map } }, T0 - MIN);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = url.split("/").pop();
    calls.push({ method, payload: JSON.parse(init.body) });
    return { status: 200, json: async () => (method === "auth.test" ? { ok: true, team: "Line Lab", user_id: "UBOT" } : method === "chat.postMessage" ? { ok: true, ts: `9.${calls.length}`, channel: "C0ALERTS" } : { ok: true }) };
  };
  await saveSlackSettings(c.s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: "botlien-alerts-test" }, T0 - MIN, { fetchImpl });
  calls.length = 0;
  const control = openControl(":memory:");
  const { account } = control.upsertAccount("dana@linelab.io", T0 - 86_400_000);
  const logs = [];
  const job = createLineJob({ control, tenants: { get: () => c.s }, vault, fetchImpl, send: true, log: (l) => logs.push(l) });

  // Everyone working, then Loader 1 and Deburr wait on Mill A for four minutes while Inspection keeps going.
  for (const id of [c.loader, c.deburr, c.inspect]) c.push(id, T0, "active");
  c.push(c.loader, T0 + 2 * MIN, "waiting");
  c.push(c.deburr, T0 + 2 * MIN, "waiting");
  for (let t = T0; t <= T0 + 6 * MIN; t += STEP) c.push(c.inspect, t, "active"); // heartbeats
  for (let t = T0 + 2 * MIN; t <= T0 + 6 * MIN; t += STEP) { c.push(c.loader, t, "waiting"); c.push(c.deburr, t, "waiting"); }

  const r1 = await job.tick(T0 + 6 * MIN);
  assert.deepEqual(r1.map((x) => [x.kind, x.station, x.open]), [["jam", "Mill A", true]]);
  const open = c.s.openLineEvents();
  assert.equal(open.length, 1);
  // Open since 2:02 and still going at 2:06: seventeen 15-second steps each, 4.25 min, so 8.5 robot-minutes read as 9.
  assert.deepEqual([open[0].line, open[0].kind, open[0].station, open[0].confidence, open[0].started_at, open[0].ended_at, open[0].idle_minutes, open[0].priced], ["CNC cell 1", "jam", "Mill A", "both sides", T0 + 2 * MIN, null, 9, 1]);
  assert.equal(open[0].cost_cents, Math.round((437 * 4.25 + 338 * 4.25) / 60), "each robot's minutes at its own hourly cost");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.channel, "botlien-alerts-test");
  assert.equal(calls[0].payload.text, "Mill A is likely holding CNC cell 1: Loader 1 and Deburr have been waiting on it since 2:02 pm, 4 min so far, and no robot has stopped. 9 robot-minutes idle, $0.55 in robot time (estimated).");
  assert.equal(c.s.lineEvent(open[0].id).message_ts, "9.1");

  // Two minutes on, still jammed: nothing new is posted until the refresh.
  for (let t = T0 + 6 * MIN + STEP; t <= T0 + 8 * MIN; t += STEP) { c.push(c.loader, t, "waiting"); c.push(c.deburr, t, "waiting"); c.push(c.inspect, t, "active"); }
  await job.tick(T0 + 8 * MIN);
  assert.equal(calls.length, 1);
  assert.equal(c.s.openLineEvents()[0].idle_minutes, 13);

  // The mill is going again: the same message says how long it held the line.
  for (let t = T0 + 8 * MIN + STEP; t <= T0 + 10 * MIN; t += STEP) { c.push(c.loader, t, "active"); c.push(c.deburr, t, "active"); c.push(c.inspect, t, "active"); }
  const r3 = await job.tick(T0 + 10 * MIN);
  assert.deepEqual(r3.map((x) => [x.kind, x.open]), [["jam", false]]);
  assert.equal(c.s.openLineEvents().length, 0);
  const done = c.s.listLineEvents()[0];
  assert.deepEqual([done.status, done.ended_at, done.idle_minutes], ["closed", T0 + 8 * MIN + STEP, 13]);
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1].method, calls[1].payload.ts], ["chat.update", "9.1"]);
  assert.equal(calls[1].payload.text, "Mill A held CNC cell 1 for 6 min, from 2:02 pm: Loader 1 and Deburr waited. 13 robot-minutes idle, $0.81 in robot time (estimated).");
  await job.tick(T0 + 12 * MIN);
  assert.equal(calls.length, 2, "a jam that ended is not posted again while it is still in the window");

  // Later, Loader 1 stops for three minutes and Deburr runs out of parts: a stop impact, recorded but not posted.
  c.push(c.loader, T0 + 20 * MIN, "waiting", { stuck: true, moving: false, errors: [{ code: "UR-SAFETY-3", severity: "WARNING", description: "protective stop" }] });
  for (let t = T0 + 20 * MIN; t <= T0 + 23 * MIN; t += STEP) { c.push(c.loader, t, "waiting", { stuck: true, moving: false }); c.push(c.deburr, t, t >= T0 + 21 * MIN ? "waiting" : "active"); c.push(c.inspect, t, "active"); }
  for (let t = T0 + 23 * MIN + STEP; t <= T0 + 24 * MIN; t += STEP) { c.push(c.loader, t, "active"); c.push(c.deburr, t, "active"); c.push(c.inspect, t, "active"); }
  const r4 = await job.tick(T0 + 24 * MIN);
  assert.deepEqual(r4.map((x) => [x.kind, x.station, x.open]), [["stop", "Loader 1", false]]);
  assert.equal(calls.length, 2, "a stop is already an alert; its impact is not posted on its own");
  const stop = c.s.listLineEvents()[0];
  assert.deepEqual([stop.kind, stop.robot_id, stop.started_at, stop.ended_at, JSON.parse(stop.idle)], ["stop", c.loader, T0 + 20 * MIN, T0 + 23 * MIN + STEP, { [c.deburr]: 9 * STEP }]);

  // The contract carries both, and the period's summary says what limited the line.
  const con = fleetContract(c.s, T0 + 30 * MIN);
  assert.equal(con.lineEvents.length, 2);
  assert.deepEqual(con.lineEvents.map((e) => [e.kind, e.station, e.minutes, e.idleMinutes, e.idle.map((i) => i.name)]), [["stop", "Loader 1", 3, 2, ["Deburr"]], ["jam", "Mill A", 6, 13, ["Loader 1", "Deburr"]]]);
  assert.deepEqual(con.lineSummary, [{ name: "CNC cell 1", robots: 3, machines: 2, jams: 1, stops: 1, idleMinutesByMachines: 13, idleMinutesByRobots: 2, costCentsByMachines: 81, costCentsByRobots: 13, shareByMachines: 13 / 15, limits: { kind: "jam", station: "Mill A", idleMinutes: 13, events: 1 } }]);
  assert.equal(con.provenance.lineEvents, "derived");
  assert.equal(jamText({ station: "Laser", status: "open", started_at: T0, ended_at: null, idle_minutes: 3, cost_cents: 20, priced: true, confidence: "one side" }, { line: "L", names: ["Inspection"], tz: TZ, nowMs: T0 + 3 * MIN, estimated: false }), "Laser is likely holding L: Inspection has been waiting on it since 2:00 pm, 3 min so far, and no robot has stopped. 3 robot-minutes idle, $0.20 in robot time. Only one robot is next to it, so this is read from one side.");
  assert.equal(summarizeLines(null, []).length, 0);
  assert.equal(logs.filter((l) => /failed/.test(l)).length, 0, logs.join("\n"));
});
