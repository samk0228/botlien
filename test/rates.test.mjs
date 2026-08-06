import { test } from "node:test";
import assert from "node:assert/strict";
import { BENCHMARKS, TASK_BASIS, defaultEconomicsFor, economicsFor, derivedRateCents, rateDerivation } from "../src/rates.mjs";

test("every benchmark is complete and internally consistent", () => {
  for (const [category, b] of Object.entries(BENCHMARKS)) {
    assert.ok(b.taskType, `${category} needs a task type`);
    assert.ok(b.unit, `${category} needs a unit noun`);
    assert.ok(Object.values(TASK_BASIS).includes(b.taskBasis), `${category} basis must be a known basis`);
    assert.ok(b.wageCentsHour > 0, `${category} wage must be positive`);
    assert.ok(b.humanUnitsPerHour > 0, `${category} throughput must be positive`);
    assert.ok(derivedRateCents(category) > 0, `${category} rate must derive to something positive`);
    assert.ok(b.invoiceCentsMonth > 0, `${category} invoice must be positive`);
    assert.ok(b.operatingHoursDay > 0 && b.operatingHoursDay <= 24, `${category} hours must be a real day`);
  }
});

test("the rate is wage divided by human throughput, checkable by hand", () => {
  // $22.00/hr / 30 runs per hour = $0.73 per run
  assert.equal(derivedRateCents("delivery"), 73);
  // one robot-hour of cleaning is valued at one contracted human-hour
  assert.equal(derivedRateCents("cleaning"), 2_500);
  // an owner's own wage overrides the published benchmark
  assert.equal(derivedRateCents("delivery", 3_000), 100);
  assert.equal(derivedRateCents("humanoid"), null);
});

test("the derivation is stated so the rate is auditable, not asserted", () => {
  assert.equal(rateDerivation("delivery"), "$0.73 per run = $22.00/hr ÷ 30 runs per hour");
  assert.match(rateDerivation("cleaning"), /\$25\.00 per active hour/);
  assert.equal(rateDerivation("humanoid"), null);
});

test("time-based work is priced per hour, trip-based work per run", () => {
  assert.equal(BENCHMARKS.delivery.taskBasis, TASK_BASIS.MISSION);
  assert.equal(BENCHMARKS.cleaning.taskBasis, TASK_BASIS.ACTIVE_HOUR);
});

test("unknown category returns null, never a borrowed rate", () => {
  assert.equal(defaultEconomicsFor({ category: "humanoid" }), null);
  assert.equal(defaultEconomicsFor({}), null);
  assert.equal(defaultEconomicsFor(null), null);
});

test("defaults are copies, so a caller cannot mutate the benchmark table", () => {
  const a = defaultEconomicsFor({ category: "delivery" });
  a.rateCents = 999_999;
  assert.equal(derivedRateCents("delivery"), 73);
  assert.equal(defaultEconomicsFor({ category: "delivery" }).rateCents, 73);
});

test("stored economics win over benchmarks and clear the default marking", () => {
  const stored = {
    task_type: "package_fulfilled",
    task_basis: "mission",
    rate_cents: 350,
    invoice_cents_month: 180_000,
    wage_cents_hour: 2_400,
    operating_hours_day: 20,
  };
  const e = economicsFor({ category: "delivery" }, stored);
  assert.equal(e.isDefault, false);
  assert.equal(e.rateCents, 350);
  assert.equal(e.taskType, "package_fulfilled");
  assert.equal(e.operatingHoursDay, 20);
});

test("no stored row falls back to the benchmark and marks it", () => {
  const e = economicsFor({ category: "cleaning" }, null);
  assert.equal(e.isDefault, true);
  assert.equal(e.taskBasis, TASK_BASIS.ACTIVE_HOUR);
  assert.equal(e.rateCents, derivedRateCents("cleaning"));
  assert.ok(e.rateDerivation, "a benchmark rate carries its derivation");
});

test("no stored row and no benchmark is unconfigured, not zero", () => {
  assert.equal(economicsFor({ category: "humanoid" }, null), null);
});
