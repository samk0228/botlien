import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openStore } from "../src/store.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { fleetContract, KV_BILLING_DAY } from "../src/contract.mjs";
import { saveInputs, InputError } from "../src/inputs.mjs";
import { armFor, robotCostPerHour, costPerWorkingHour, idleCostPerYear, stopCost, UR_ARMS, INSTALL_BANDS } from "../src/robot-cost.mjs";
import { robotCostFor, businessPreview, worksFor, defaultWorkFor, derivedRateCents, BENCHMARKS, EQUIP_COST_CENTS } from "../src/rates.mjs";

const require = createRequire(import.meta.url);
const adapter = require("../prototype/src/live-adapter.cjs");
const at = (iso) => Date.parse(iso);
const MIN = 60_000;
const dollars = (cents) => Math.round(cents) / 100;

// Every figure below is from the Overnight Line Benchmark v1.1, Section 3 and 4.

test("the benchmark's worked example: CNC Loader 2, a UR10e in a complex cell", () => {
  const c = robotCostPerHour({ armPriceCents: UR_ARMS.ur10e.priceCents, installMultiple: INSTALL_BANDS.complex.multiple, watts: UR_ARMS.ur10e.watts });
  assert.equal(dollars(c.deployedCents), 123_990);
  assert.equal(c.lifeHours, 28_000, "7 years of 4,000 hours runs out before 35,000 hours");
  assert.equal(dollars(c.ownership), 3.72);
  assert.equal(dollars(c.maintenance), 0.62);
  assert.equal(dollars(c.energy), 0.03);
  assert.equal(dollars(c.perHour), 4.37);
  // Working 8% of the time: about $55 per hour of real work, about $16,096 idle a year.
  assert.equal(Math.round(costPerWorkingHour(c.perHour, 0.08) / 100), 55);
  assert.equal(Math.round(idleCostPerYear(c.perHour, 0.08) / 100), 16_096);
});

test("every robot in the benchmark's 'works the least' table prices the same", () => {
  const rows = [
    ["UR10e", "complex", 4.37],
    ["UR3e", "complex", 2.9],
    ["UR5e", "complex", 3.38],
    ["UR10e", "welding", 5.26],
  ];
  for (const [model, band, want] of rows) {
    const arm = UR_ARMS[armFor(model)];
    const c = robotCostPerHour({ armPriceCents: arm.priceCents, installMultiple: INSTALL_BANDS[band].multiple, watts: arm.watts });
    assert.equal(dollars(c.perHour), want, `${model} ${band}`);
  }
});

test("the CNC line's four robots add up to the benchmark's $15.02 an hour", () => {
  const line = ["UR10e", "UR10e", "UR5e", "UR3e"].map((m) => robotCostFor("machine_tending", m).perHour);
  assert.ok(Math.abs(line.reduce((a, b) => a + b, 0) / 100 - 15.02) < 0.02);
});

test("a stop is priced per robot left idle, and is small", () => {
  const c = robotCostFor("machine_tending", "UR10e").perHour;
  // The median incident: about 5 robot-minutes idle, about $0.25 to $0.40.
  const cents = stopCost([{ perHourCents: c, minutes: 3 }, { perHourCents: c, minutes: 2 }]);
  assert.ok(cents > 20 && cents < 40, `${cents}`);
});

test("vendors' names for an arm all resolve, and anything else does not", () => {
  assert.equal(armFor("UR10e"), "ur10e");
  assert.equal(armFor("UR10"), "ur10e");
  assert.equal(armFor("ur 5e CB3"), "ur5e");
  assert.equal(armFor("UR20"), "ur20");
  assert.equal(armFor("UR30"), "ur30");
  assert.equal(armFor("S50"), null);
  assert.equal(armFor(null), null);
  assert.equal(armFor("UR7"), null);
});

test("manufacturing is a business type with CNC tending and welding, priced by the arm", () => {
  assert.deepEqual(worksFor("manufacturing"), ["machine_tending", "welding"]);
  assert.equal(defaultWorkFor("manufacturing"), "machine_tending");
  const p = businessPreview("manufacturing");
  assert.equal(p.costBasis, "robot");
  assert.equal(p.rateCents, 437);
  assert.match(p.derivation, /^\$4\.37 per scheduled hour = what a UR10e costs to own and run, working or waiting/);
  assert.equal(businessPreview("restaurant").costBasis, "labor");
  assert.equal(derivedRateCents("welding"), 526);
  // A month of a fully scheduled arm is its invoice, so full use reads 1.00x.
  assert.equal(BENCHMARKS.machine_tending.invoiceCentsMonth, Math.round((robotCostFor("machine_tending").perHour * 4000) / 12));
  assert.equal(EQUIP_COST_CENTS.machine_tending, Math.round(robotCostFor("machine_tending").deployedCents));
  assert.equal(EQUIP_COST_CENTS.welding, Math.round(robotCostFor("welding").deployedCents));
});

test("the owner's own price and schedule replace the defaults, and end 'estimated'", () => {
  const def = robotCostFor("machine_tending", "UR10e");
  assert.equal(def.estimated, true);
  const own = robotCostFor("machine_tending", "UR10e", { armPrice: 45_000, install: 1.0, hoursYear: 6_000 });
  assert.equal(own.armPriceCents, 4_500_000);
  assert.equal(own.installMultiple, 1.0);
  assert.equal(own.hoursPerYear, 6_000);
  assert.equal(own.lifeHours, 35_000, "at 6,000 hours a year the 35,000 hour limit comes first");
  assert.equal(own.estimated, false);
  assert.ok(own.perHour < def.perHour);
  // Price alone is not enough to stop estimating: the schedule is judgment too.
  assert.equal(robotCostFor("machine_tending", "UR10e", { armPrice: 45_000 }).estimated, true);
  // Naming a different arm moves the price and the power.
  assert.equal(robotCostFor("machine_tending", "UR10e", { arm: "UR3e" }).armLabel, "UR3e");
  assert.equal(robotCostFor("picking", "UR10e"), null, "work priced per unit has no cost model");
});

function armStore() {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "1");
  s.setKV("owner.tz", "America/Chicago");
  const id = s.upsertRobot({ connector: "ur", externalId: "loader-1", displayName: "Loader 1", brand: "Universal Robots", model: "UR10e", category: "machine_tending" }, at("2026-09-01T12:00:00Z"));
  // Two hours of work a day for five days, sampled every 10 minutes.
  for (let d = 0; d < 5; d++) {
    const t0 = at(`2026-09-0${d + 2}T14:00:00Z`);
    for (let i = 0; i < 12; i++) {
      const t = t0 + i * 10 * MIN;
      s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "ur", source: "ur", connectionState: "online", missionState: "active", missionId: `d${d}`, moving: true, stuck: false, pose: { x: 0, y: 0 } });
    }
  }
  rebuildRollupsForRobot(s, id);
  return { s, id };
}

test("the contract carries an arm's cost per hour, working share and idle cost", () => {
  const { s } = armStore();
  const c = fleetContract(s, at("2026-09-07T12:00:00Z"));
  const r = c.robots[0];
  assert.equal(r.work, "CNC machine tending");
  assert.equal(r.rateCents, 437);
  assert.equal(r.cost.armLabel, "UR10e");
  assert.equal(r.cost.perHourCents, 437);
  assert.equal(r.cost.ownershipCents + r.cost.maintenanceCents + r.cost.energyCents, 437);
  assert.equal(r.cost.deployedCents, 12_399_000);
  assert.equal(r.cost.estimated, true);
  assert.ok(r.cost.workingPct > 0 && r.cost.workingPct < 100);
  assert.ok(r.cost.perWorkingHourCents > r.cost.perHourCents, "an hour of real work costs more than a scheduled hour");
  assert.ok(r.cost.idleCostYearCents > 0);
  // Coverage is the working share: C per working hour over C per scheduled hour.
  assert.ok(Math.abs(r.coverage - r.dutyPct / 100) < 0.05, `${r.coverage} vs ${r.dutyPct}`);
  // And it reaches the page as its own table, row for row.
  assert.deepEqual(adapter.liveTables(c).COST, [r.cost]);
});

test("owner cost inputs save, validate, and reprice the arm even with stored economics", () => {
  const { s, id } = armStore();
  const T = at("2026-09-07T12:00:00Z");
  // Setting hours first creates a stored economics row, which must not freeze the old rate.
  saveInputs(s, { robots: { robotHours: { [id]: 16 } } }, T);
  saveInputs(s, { robots: { robotCost: { [id]: { armPrice: 40_000, install: 1.0, hoursYear: 4_000 } } } }, T + 1);
  const r = fleetContract(s, T + 2).robots[0];
  assert.equal(r.cost.armPriceCents, 4_000_000);
  assert.equal(r.cost.estimated, false);
  assert.ok(r.rateCents < 437, "a cheaper arm in a simpler cell costs less per hour");
  assert.equal(r.rateCents, r.cost.perHourCents);
  // A month of scheduled hours at C (C unrounded, so within half a cent an hour).
  assert.ok(Math.abs(r.invoiceCentsMonth - (r.cost.perHourCents * 4000) / 12) <= 4000 / 12 / 2);
  // A typed invoice wins over the cost model's.
  saveInputs(s, { robots: { robotInvoice: { [id]: 900 } } }, T + 3);
  assert.equal(fleetContract(s, T + 4).robots[0].invoiceCentsMonth, 90_000);

  for (const bad of [{ armPrice: -1 }, { install: 9 }, { hoursYear: 20_000 }, { color: "red" }, [], "UR10e"]) {
    assert.throws(() => saveInputs(s, { robots: { robotCost: { [id]: bad } } }, T + 5), InputError, JSON.stringify(bad));
  }
});

test("a non-arm robot has no cost block", () => {
  const s = openStore(":memory:");
  s.upsertRobot({ connector: "import", externalId: "p1", displayName: "Picker", category: "picking" }, 1);
  assert.equal(fleetContract(s, at("2026-09-07T12:00:00Z")).robots[0].cost, null);
});
