import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_MS,
  TASK_LABEL,
  taskCount,
  activeMs,
  proratedInvoiceCents,
  capacityMs,
  robotFinancials,
  fleetFinancials,
  byTaskType,
  formulaLine,
} from "../src/finance.mjs";

const T0 = Date.parse("2026-08-04T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

// rollup DB rows are snake_case, as they come back from the store
const roll = (o) => ({ bucket_start_at: T0, bucket_ms: HOUR, active_ms: 0, mission_count: 0, ...o });

const deliveryEcon = {
  taskType: "tray_delivery",
  taskBasis: "mission",
  rateCents: 125,
  invoiceCentsMonth: 99_900,
  wageCentsHour: 2_000,
  operatingHoursDay: 12,
};

const cleaningEcon = {
  taskType: "cleaning_hour",
  taskBasis: "active_hour",
  rateCents: 3_800,
  invoiceCentsMonth: 80_000,
  operatingHoursDay: 8,
};

test("mission basis counts runs, active_hour basis counts fractional hours", () => {
  const rollups = [
    roll({ mission_count: 10, active_ms: 30 * 60_000 }),
    roll({ bucket_start_at: T0 + HOUR, mission_count: 5, active_ms: 45 * 60_000 }),
  ];
  assert.equal(taskCount(rollups, "mission"), 15);
  assert.equal(taskCount(rollups, "active_hour"), 1.25); // 75 minutes
  assert.equal(activeMs(rollups), 75 * 60_000);
});

test("empty rollups count zero without throwing", () => {
  assert.equal(taskCount([], "mission"), 0);
  assert.equal(taskCount(null, "active_hour"), 0);
  assert.equal(activeMs([]), 0);
});

test("invoice prorates against a stated 30-day month", () => {
  assert.equal(proratedInvoiceCents(99_900, MONTH_MS), 99_900);
  assert.equal(proratedInvoiceCents(99_900, 15 * DAY), 49_950);
  assert.equal(proratedInvoiceCents(30_000, DAY), 1_000);
});

test("a missing invoice prorates to null, never to zero", () => {
  // zero would divide into infinite coverage and read as spectacular success
  assert.equal(proratedInvoiceCents(null, MONTH_MS), null);
  assert.equal(proratedInvoiceCents(undefined, MONTH_MS), null);
});

test("capacity follows declared operating hours, not wall clock", () => {
  assert.equal(capacityMs(12, DAY), 12 * HOUR);
  assert.equal(capacityMs(24, DAY), DAY);
  assert.equal(capacityMs(0, DAY), null);
  assert.equal(capacityMs(12, 0), null);
});

test("a full delivery reading computes all four owner numbers", () => {
  // 30 days of 40 runs a day, 6 duty hours a day
  const rollups = [];
  for (let d = 0; d < 30; d++) {
    rollups.push(roll({ bucket_start_at: T0 + d * DAY, mission_count: 40, active_ms: 6 * HOUR }));
  }
  const f = robotFinancials(rollups, deliveryEcon, { fromMs: T0, toMs: T0 + 30 * DAY });

  assert.equal(f.tasks, 1_200);
  assert.equal(f.taskLabel, "runs started");
  assert.equal(f.workServicedCents, 150_000); // 1200 x $1.25 = $1500
  assert.equal(f.invoiceProratedCents, 99_900);
  assert.ok(Math.abs(f.coverage - 1.5015) < 0.001);
  assert.ok(Math.abs(f.costPerTaskCents - 83.25) < 0.01); // $0.83 per run
  assert.equal(f.activeMs, 180 * HOUR);
  assert.equal(f.capacityMs, 360 * HOUR); // 12h/day x 30 days
  assert.equal(Math.round(f.utilizationPct), 50);
  assert.equal(f.isDefault, false);
});

test("cleaning is valued by the hour, so one long cycle is not one cheap task", () => {
  // a single mission that ran 6 hours a day for 30 days
  const rollups = [];
  for (let d = 0; d < 30; d++) {
    rollups.push(roll({ bucket_start_at: T0 + d * DAY, mission_count: 1, active_ms: 6 * HOUR }));
  }
  const f = robotFinancials(rollups, cleaningEcon, { fromMs: T0, toMs: T0 + 30 * DAY });
  assert.equal(f.tasks, 180); // 180 hours, not 30 missions
  assert.equal(f.workServicedCents, 684_000); // 180 x $38
  assert.ok(f.coverage > 8);
});

test("no economics returns null, so the UI shows unconfigured not a zeroed dashboard", () => {
  assert.equal(robotFinancials([roll({ mission_count: 99 })], null, { fromMs: T0, toMs: T0 + DAY }), null);
});

test("no invoice leaves coverage unanswered but still reports work done", () => {
  const econ = { ...deliveryEcon, invoiceCentsMonth: null };
  const f = robotFinancials([roll({ mission_count: 100 })], econ, { fromMs: T0, toMs: T0 + DAY });
  assert.equal(f.workServicedCents, 12_500);
  assert.equal(f.invoiceProratedCents, null);
  assert.equal(f.coverage, null);
  assert.equal(f.costPerTaskCents, null);
});

test("a robot that did nothing has undefined cost per task, not zero", () => {
  const f = robotFinancials([], deliveryEcon, { fromMs: T0, toMs: T0 + DAY });
  assert.equal(f.tasks, 0);
  assert.equal(f.workServicedCents, 0);
  assert.equal(f.coverage, 0);
  assert.equal(f.costPerTaskCents, null); // would be Infinity if divided
});

test("benchmark defaults are marked so the UI can flag them", () => {
  const f = robotFinancials([], { ...deliveryEcon, isDefault: true }, { fromMs: T0, toMs: T0 + DAY });
  assert.equal(f.isDefault, true);
});

test("fleet coverage sums both sides before dividing", () => {
  // a tiny well-covered robot must not outvote a large poorly-covered one
  const small = { workServicedCents: 1_000, invoiceProratedCents: 100, activeMs: HOUR, capacityMs: 2 * HOUR, isDefault: false };
  const big = { workServicedCents: 10_000, invoiceProratedCents: 100_000, activeMs: HOUR, capacityMs: 8 * HOUR, isDefault: false };
  const fleet = fleetFinancials([small, big]);

  assert.equal(fleet.workServicedCents, 11_000);
  assert.equal(fleet.invoiceProratedCents, 100_100);
  assert.ok(fleet.coverage < 0.12); // true blended coverage, not the ~5.05x an average of ratios would give
  assert.equal(fleet.robotCount, 2);
});

test("fleet of nothing is empty, not NaN", () => {
  const fleet = fleetFinancials([]);
  assert.equal(fleet.robotCount, 0);
  assert.equal(fleet.coverage, null);
  assert.equal(fleet.utilizationPct, null);
  assert.equal(fleet.workServicedCents, 0);
});

test("unconfigured robots drop out of fleet totals instead of zeroing them", () => {
  const one = { workServicedCents: 5_000, invoiceProratedCents: 2_000, activeMs: HOUR, capacityMs: 4 * HOUR, isDefault: false };
  const fleet = fleetFinancials([one, null, null]);
  assert.equal(fleet.robotCount, 1);
  assert.equal(fleet.coverage, 2.5);
});

test("fleet flags when any robot is still on benchmark numbers", () => {
  const a = { workServicedCents: 1, invoiceProratedCents: 1, activeMs: 0, capacityMs: 1, isDefault: false };
  const b = { workServicedCents: 1, invoiceProratedCents: 1, activeMs: 0, capacityMs: 1, isDefault: true };
  assert.equal(fleetFinancials([a]).anyDefault, false);
  assert.equal(fleetFinancials([a, b]).anyDefault, true);
});

test("the formula line spells out arithmetic the owner can check by hand", () => {
  const f = robotFinancials(
    [roll({ mission_count: 1_200, active_ms: 180 * HOUR })],
    deliveryEcon,
    { fromMs: T0, toMs: T0 + 30 * DAY }
  );
  const line = formulaLine(f);
  assert.match(line, /1200 runs started/);
  assert.match(line, /\$1\.25/);
  assert.match(line, /\$1500\.00 of work serviced/);
  assert.match(line, /coverage 1\.50x/);
  // it must never imply revenue or savings
  assert.doesNotMatch(line, /revenue|profit|saved|savings/i);
});

test("the formula line handles an unconfigured robot", () => {
  assert.equal(formulaLine(null), "not configured");
});

test("task labels never claim completion", () => {
  assert.equal(TASK_LABEL.mission, "runs started");
  for (const label of Object.values(TASK_LABEL)) {
    assert.doesNotMatch(label, /completed|delivered|finished/i);
  }
});

test("utilization above 100% is reported, not clamped, because the declared hours are wrong", () => {
  // 20 duty hours against a declared 12-hour day
  const rollups = [roll({ active_ms: 20 * HOUR, mission_count: 10 })];
  const f = robotFinancials(rollups, deliveryEcon, { fromMs: T0, toMs: T0 + DAY });
  assert.equal(f.capacityMs, 12 * HOUR);
  assert.ok(f.utilizationPct > 100, `expected over-capacity, got ${f.utilizationPct}`);
  assert.equal(f.overCapacity, true);

  const normal = robotFinancials([roll({ active_ms: 6 * HOUR })], deliveryEcon, { fromMs: T0, toMs: T0 + DAY });
  assert.equal(normal.overCapacity, false);
  assert.equal(Math.round(normal.utilizationPct), 50);
});

test("cost per task is grouped by kind of work, never summed across units", () => {
  const runs = { taskType: "tray_delivery", taskLabel: "runs started", basis: "mission", rateCents: 125,
                 tasks: 1000, workServicedCents: 125_000, invoiceProratedCents: 100_000, isDefault: false };
  const hours = { taskType: "cleaning_hour", taskLabel: "active hours", basis: "active_hour", rateCents: 3800,
                  tasks: 100, workServicedCents: 380_000, invoiceProratedCents: 80_000, isDefault: false };

  const groups = byTaskType([runs, hours]);
  assert.equal(groups.length, 2);

  const d = groups.find((g) => g.taskType === "tray_delivery");
  const c = groups.find((g) => g.taskType === "cleaning_hour");
  assert.equal(d.costPerTaskCents, 100); // $100,000 / 1000 runs = $1.00 per run
  assert.equal(c.costPerTaskCents, 800); // $80,000 / 100 hours = $8.00 per hour
  // a single blended figure would have been 180000/1100 = $1.64 of nothing
  assert.notEqual(d.costPerTaskCents, c.costPerTaskCents);
});

test("byTaskType merges robots doing the same work and skips unconfigured ones", () => {
  const a = { taskType: "tray_delivery", taskLabel: "runs started", basis: "mission", rateCents: 125,
              tasks: 500, workServicedCents: 62_500, invoiceProratedCents: 50_000, isDefault: false };
  const b = { ...a, tasks: 300, workServicedCents: 37_500, invoiceProratedCents: 50_000 };
  const groups = byTaskType([a, b, null]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tasks, 800);
  assert.equal(groups[0].robotCount, 2);
  assert.equal(groups[0].workServicedCents, 100_000);
});
