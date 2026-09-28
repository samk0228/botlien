import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINUTES_PER_CLEAR,
  MIN_CLEARS,
  robotInterventions,
  fleetInterventions,
  interventionSentence,
} from "../src/interventions.mjs";

const HOUR = 3_600_000;
const roll = (o = {}) => ({ bucket_start_at: 0, bucket_ms: HOUR, stuck_episodes: 0, ...o });
const base = {
  robot: { id: 1, name: "Picker 1" },
  rollups: [roll({ stuck_episodes: 6 }), roll({ stuck_episodes: 4 })],
  wageCentsHour: 2_200,
  stuckSamples: 30,
  totalSamples: 300,
  observedMs: 100 * HOUR,
};

test("clears are counted from rollups and priced at the wage", () => {
  const r = robotInterventions(base);
  assert.equal(r.clears, 10);
  assert.equal(r.clearHours, (10 * MINUTES_PER_CLEAR) / 60);
  assert.equal(r.clearCents, Math.round(r.clearHours * 2_200));
});

test("stall duration is carried as context and never billed as labour", () => {
  const r = robotInterventions(base);
  // 30 of 300 samples stuck over 100 observed hours = 10 hours stalled
  assert.equal(r.stalledHours, 10);
  // total is clear hours (+ manual), NOT stalled hours: charging the same hours
  // twice, once as lost output and once as human time, is the failure mode
  assert.equal(r.totalHours, r.clearHours);
  assert.ok(r.totalHours < r.stalledHours);
});

test("no manual-control feed reads as unknown, not as zero", () => {
  const r = robotInterventions(base);
  assert.equal(r.manualHours, null);
  assert.equal(r.manualCents, null);
  assert.equal(r.hasManualFeed, false);
});

test("a manual-control feed reporting none is a real zero", () => {
  const r = robotInterventions({ ...base, conditionSamples: 300, activeSamples: 300, activeManualSamples: 0, activeMs: 40 * HOUR });
  assert.equal(r.manualHours, 0);
  assert.equal(r.hasManualFeed, true);
});

test("manual hours are a share of WORKING time, so they cannot exceed the hours worked", () => {
  const r = robotInterventions({
    ...base,
    conditionSamples: 300,
    activeSamples: 100,
    activeManualSamples: 45,
    activeMs: 40 * HOUR,
  });
  assert.equal(r.manualHours, 18); // 45% of the 40 hours it actually ran
  assert.ok(r.manualHours < 40);
  assert.equal(r.manualCents, Math.round(18 * 2_200));
  assert.equal(r.totalHours, r.clearHours + 18);
});

test("a flag reported on every heartbeat cannot bill more hours than the machine ran", () => {
  // The regression this guards: converting a 45% manual share against the wall
  // clock priced 226 hours of hand-driving onto a robot that worked 34.
  const r = robotInterventions({
    ...base,
    observedMs: 504 * HOUR, // three weeks of calendar
    conditionSamples: 30_000,
    activeSamples: 2_000,
    activeManualSamples: 900,
    activeMs: 34 * HOUR,
  });
  assert.ok(r.manualHours <= 34, `${r.manualHours} must not exceed the hours worked`);
  assert.equal(Math.round(r.manualHours), 15);
});

test("no wage leaves the hours intact and the money null", () => {
  const r = robotInterventions({ ...base, wageCentsHour: null });
  assert.equal(r.clears, 10);
  assert.ok(r.clearHours > 0);
  assert.equal(r.clearCents, null);
  assert.equal(r.totalCents, null);
});

test("a divide by zero in the sample share returns 0, never NaN", () => {
  const r = robotInterventions({ ...base, stuckSamples: 0, totalSamples: 0, observedMs: 0 });
  assert.equal(r.stalledHours, 0);
  assert.ok(Number.isFinite(r.totalHours));
});

test("fleet totals sum the priced robots and count the unpriced ones", () => {
  const a = robotInterventions(base);
  const b = robotInterventions({ ...base, robot: { id: 2, name: "Picker 2" }, wageCentsHour: null });
  const f = fleetInterventions([a, b]);
  assert.equal(f.clears, 20);
  assert.equal(f.robotCount, 2);
  assert.equal(f.unpricedCount, 1);
  assert.equal(f.totalCents, a.totalCents);
  assert.equal(f.hasManualFeed, false);
});

test("a fleet with a handful of stalls is not material and renders nothing", () => {
  const quiet = robotInterventions({ ...base, rollups: [roll({ stuck_episodes: MIN_CLEARS - 1 })] });
  const f = fleetInterventions([quiet]);
  assert.equal(f.material, false);
  assert.equal(interventionSentence(f), null);
});

test("worst list is ordered by hours and holds only robots past the threshold", () => {
  const big = robotInterventions({ ...base, robot: { id: 1, name: "Big" }, rollups: [roll({ stuck_episodes: 40 })] });
  const small = robotInterventions({ ...base, robot: { id: 2, name: "Small" }, rollups: [roll({ stuck_episodes: 5 })] });
  const tiny = robotInterventions({ ...base, robot: { id: 3, name: "Tiny" }, rollups: [roll({ stuck_episodes: 1 })] });
  const f = fleetInterventions([small, big, tiny]);
  assert.deepEqual(f.worst.map((r) => r.robotName), ["Big", "Small"]);
});

test("the sentence names both halves only when hand-driving was reported", () => {
  const withManual = fleetInterventions([
    robotInterventions({ ...base, conditionSamples: 300, activeSamples: 100, activeManualSamples: 45, activeMs: 40 * HOUR }),
  ]);
  assert.match(interventionSentence(withManual), /driving the robot directly/);
  const without = fleetInterventions([robotInterventions(base)]);
  assert.doesNotMatch(interventionSentence(without), /driving/);
});

test("the rows add up to the total: a hand-driven robot with no stalls still gets a line", () => {
  // The regression: worst was filtered on stall count alone, so the robot whose
  // entire cost was somebody steering it vanished from the list while its money
  // stayed in the headline, and the lines under the figure did not sum to it.
  const stally = robotInterventions({ ...base, robot: { id: 1, name: "Stally" } });
  const steered = robotInterventions({
    ...base,
    robot: { id: 2, name: "Steered" },
    rollups: [roll({ stuck_episodes: 0 })],
    conditionSamples: 300,
    activeSamples: 100,
    activeManualSamples: 45,
    activeMs: 40 * HOUR,
  });
  const f = fleetInterventions([stally, steered]);
  assert.deepEqual(f.worst.map((r) => r.robotName), ["Steered", "Stally"]);
  assert.equal(
    f.worst.reduce((n, r) => n + r.totalCents, 0),
    f.totalCents
  );
});
