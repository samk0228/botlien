import { test } from "node:test";
import assert from "node:assert/strict";
import { createArm } from "../gateway/ur/arm.mjs";
import { simulateCell } from "../gateway/ur/fake-ursim.mjs";
import { parseRecording, stateOf, measure, replay, report, compare, formatReport } from "../src/benchmark.mjs";

// Well in the past: the push path refuses events dated past the real clock.
const T0 = Date.parse("2026-09-28T08:00:00Z");
const MIN = 60_000;

/** Thirty virtual minutes of a CNC loader as the gateway would record it:
 *  samples at 2 Hz through the real arm logic, heartbeats every second. */
function recording({ minutes = 30, cycleSeconds = 40, moveSeconds = 10, stopEvery = 5, stopSeconds = 60, id = "linelab-loader1", name = "Loader 1", model = "UR10e" } = {}) {
  const cell = simulateCell({ cycleSeconds, moveSeconds, stopEvery, stopSeconds });
  const arm = createArm({ id, name, model, category: "machine_tending", cycleRegister: 24 }, { heartbeatMs: 15_000, holdMs: 2_000 });
  const events = [];
  const start = Date.now();
  for (let t = 0; t <= minutes * MIN; t += 500) {
    const s = cell(start + t);
    events.push(...arm.feed({ ...s, at: T0 + t }));
    if (t % 1000 === 0) events.push(...arm.tick(T0 + t));
  }
  return events;
}

test("a recording is read in time order and bad lines are skipped, not fatal", () => {
  const text = ['{"robot_id":"a","at":"2026-10-01T08:00:10Z"}', "", "not json", '{"robot_id":"a","at":"2026-10-01T08:00:00Z"}', "[1]"].join("\n");
  const { events, bad } = parseRecording(text);
  assert.deepEqual(events.map((e) => e.at), ["2026-10-01T08:00:00Z", "2026-10-01T08:00:10Z"]);
  assert.deepEqual(bad, [3, 5]);
});

test("a sample is working, waiting, stopped, idle, off or offline, in the benchmark's words", () => {
  assert.equal(stateOf({ connection_state: "online", mission_state: "active" }), "working");
  assert.equal(stateOf({ connection_state: "online", mission_state: "waiting" }), "waiting");
  assert.equal(stateOf({ connection_state: "online", mission_state: "waiting", stuck: 1 }), "stopped");
  assert.equal(stateOf({ connection_state: "online", mission_state: "active", errors: JSON.stringify([{ code: "UR-SAFETY-9", severity: "ERROR" }]) }), "stopped");
  assert.equal(stateOf({ connection_state: "online", mission_state: "active", errors: JSON.stringify([{ code: "x", severity: "WARNING" }]) }), "working");
  assert.equal(stateOf({ connection_state: "online", mission_state: "off" }), "off");
  assert.equal(stateOf({ connection_state: "online", mission_state: "idle" }), "idle");
  assert.equal(stateOf({ connection_state: "offline", mission_state: "unknown" }), "offline");
});

test("measure integrates each sample until the next, caps a gap, and counts stops and cycles", () => {
  const rows = [
    { at: T0, connection_state: "online", mission_state: "active", mission_id: "cycle:op10:7" },
    { at: T0 + MIN, connection_state: "online", mission_state: "waiting", mission_id: "cycle:op10:7" },
    { at: T0 + 3 * MIN, connection_state: "online", mission_state: "waiting", stuck: 1 },
    { at: T0 + 4 * MIN, connection_state: "online", mission_state: "active", mission_id: "cycle:op10:8" },
    { at: T0 + 20 * MIN, connection_state: "online", mission_state: "active", mission_id: "cycle:op10:10" }, // a 16 min gap: only 5 count
    { at: T0 + 21 * MIN, connection_state: "offline" },
  ];
  const m = measure(rows);
  // 1 + 5 (the gap, capped) + 1 minutes working; the offline sample is last and holds nothing.
  assert.deepEqual([m.ms.working, m.ms.waiting, m.ms.stopped, m.ms.offline], [7 * MIN, 2 * MIN, MIN, 0]);
  assert.equal(m.covered, 10 * MIN);
  assert.equal(m.span, 21 * MIN);
  assert.deepEqual([m.cycles, m.stops], [3, 1], "the counter rose from 7 to 10: three cycles");
  assert.equal(measure([{ at: T0, connection_state: "online", mission_state: "active", mission_id: "m-1" }, { at: T0 + MIN, connection_state: "online", mission_state: "active", mission_id: "m-2" }]).cycles, 2, "vendor mission ids are counted distinct");
  assert.equal(Math.round(m.share.working * 100), 70);
});

test("a thirty-minute CNC recording replays through the push path and reads as the benchmark would", () => {
  const events = recording();
  assert.ok(events.length > 60, `events: ${events.length}`);
  const replayed = replay(events);
  assert.equal(replayed.rejected.length, 0);
  assert.equal(replayed.accepted, events.length);
  const rep = report(replayed);
  assert.equal(rep.robots.length, 1);
  const r = rep.robots[0];
  assert.deepEqual([r.name, r.model, r.category, r.server.armLabel], ["Loader 1", "UR10e", "machine_tending", "UR10e"]);

  // Five 40 s cycles with 10 s of motion each, then a 60 s protective stop.
  // The gateway holds "working" 2 s past the last motion, so each cycle
  // counts 12 s working and 28 s waiting: 60, 140 and 60 s out of every 260.
  const work = 60 / 260;
  assert.ok(Math.abs(r.measured.working - work) < 0.03, `working ${r.measured.working}`);
  assert.ok(Math.abs(r.measured.waiting - 140 / 260) < 0.03, `waiting ${r.measured.waiting}`);
  assert.ok(Math.abs(r.measured.stopped - 60 / 260) < 0.03, `stopped ${r.measured.stopped}`);
  assert.equal(r.measured.offline, 0);
  assert.equal(r.measured.stops, 7, "a stop after every fifth cycle: the seventh begins at minute 29");
  assert.ok(r.measured.cycles >= 32 && r.measured.cycles <= 36, `cycles ${r.measured.cycles}`);
  assert.equal(r.measured.spanMinutes, 30);

  // The server agrees with the harness on stops, and prices the UR10e at the benchmark's $4.37.
  assert.equal(r.server.stops, 7);
  assert.ok(r.server.downMinutes >= 5 && r.server.downMinutes <= 7, `server down ${r.server.downMinutes}`);
  assert.equal(r.server.perHourCents, 437);
  assert.equal(r.server.estimated, true);
  // Machine tending is priced per working hour, so the contract's units are
  // hours; the register's cycles land in the rollups as missions.
  const missions = replayed.store.rollupsBetween(r.id, 0, replayed.nowMs).reduce((n, b) => n + b.mission_count, 0);
  assert.ok(Math.abs(missions - r.measured.cycles) <= 1, `the server counts the register's cycles: ${missions} vs ${r.measured.cycles}`);

  // The benchmark's arithmetic on this recording's working share.
  assert.ok(Math.abs(r.bench.perWorkingHourCents / 100 - 4.37 / work) < 1.5, `per working hour ${r.bench.perWorkingHourCents}`);
  assert.ok(Math.abs(r.bench.idleCostYearCents / 100 - 4.37 * 4000 * (1 - work)) < 600, `idle ${r.bench.idleCostYearCents}`);
  assert.equal(rep.line.perHourCents, 437);
  assert.ok(rep.line.outputPerHour > 60 && rep.line.outputPerHour < 75, `output/hr ${rep.line.outputPerHour}`);

  const text = formatReport(rep);
  assert.match(text, /Loader 1\s+UR10e\s+\d+%/);
  assert.match(text, /\$4\.37/);
});

test("compare says which figures match Line Lab's and which do not", () => {
  const rep = report(replay(recording({ minutes: 10 })));
  const w = rep.robots[0].measured.working;
  const good = compare(rep, { robots: { "loader 1": { costPerHour: 4.37, working: w, stops: 2 } }, line: { costPerHour: 4.37 } });
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  assert.deepEqual(good.checks.map((c) => [c.robot, c.field, c.ok]), [["loader 1", "working", true], ["loader 1", "stops", true], ["loader 1", "costPerHour", true], ["line", "costPerHour", true]]);
  const bad = compare(rep, { robots: { "Loader 1": { costPerHour: 9, working: w + 0.1 }, "Loader 2": { costPerHour: 4.37 } } });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.checks.filter((c) => !c.ok).map((c) => `${c.robot}:${c.field}`), ["Loader 1:working", "Loader 1:costPerHour", "Loader 2:present"]);
  assert.match(formatReport(rep, bad), /DIFF Loader 1\s+costPerHour\s+got 4\.37\s+want 9/);
});
