import { test } from "node:test";
import assert from "node:assert/strict";
import { byBrand, brandSentence, MIN_TASKS_PER_BRAND } from "../src/brands.mjs";

const HOUR = 3_600_000;
const bot = (name, brand, { tasks = 900, invoice = 52_000, taskType = "pick", rate = 120 } = {}) => ({
  name,
  brand,
  fin: {
    taskType,
    taskLabel: "picks started",
    unit: "pick",
    basis: "mission",
    tasks,
    workServicedCents: tasks * rate,
    invoiceProratedCents: invoice,
    activeMs: tasks * 60_000,
  },
});

test("a single-brand fleet gets no panel rather than a table of one", () => {
  const r = byBrand([bot("A", "Pudu"), bot("B", "Pudu")]);
  assert.equal(r.groups.length, 0);
});

test("two brands in the same kind of work are compared and sorted cheapest first", () => {
  const r = byBrand([bot("A", "Pudu"), bot("B", "Pudu"), bot("C", "Gausium", { tasks: 500 })]);
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.equal(g.best.brand, "Pudu");
  assert.equal(g.worst.brand, "Gausium");
  assert.deepEqual(g.brands.map((b) => b.brand), ["Pudu", "Gausium"]);
  assert.equal(g.best.robotCount, 2);
});

test("brands are never compared across kinds of work", () => {
  // Bear does delivery, Gausium cleans. Different units, no comparison exists.
  const r = byBrand([
    bot("Servi", "Bear", { taskType: "tray_delivery" }),
    bot("Scrubber", "Gausium", { taskType: "floor_cleaning" }),
  ]);
  assert.equal(r.groups.length, 0);
});

test("cost per task matches invoice divided by work, so a row can be checked by hand", () => {
  const g = byBrand([bot("A", "Pudu", { tasks: 1_000, invoice: 50_000 }), bot("B", "Gausium", { tasks: 500, invoice: 50_000 })]).groups[0];
  assert.equal(g.best.costPerTaskCents, 50);
  assert.equal(g.worst.costPerTaskCents, 100);
  assert.equal(g.gapCents, 50);
  assert.equal(Math.round(g.gapPct * 100), 100);
});

test("the gap is valued at the volume actually observed", () => {
  const g = byBrand([bot("A", "Pudu", { tasks: 1_000, invoice: 50_000 }), bot("B", "Gausium", { tasks: 500, invoice: 50_000 })]).groups[0];
  assert.equal(g.gapValueCents, 50 * 500);
});

test("a brand carrying almost no work is marked and cannot read as a finding", () => {
  const g = byBrand([
    bot("A", "Pudu", { tasks: 900 }),
    bot("B", "Gausium", { tasks: MIN_TASKS_PER_BRAND - 5, invoice: 900 }),
  ]).groups[0];
  const thin = g.brands.find((b) => b.brand === "Gausium");
  assert.equal(thin.thin, true);
  assert.equal(g.comparable, false);
  assert.equal(brandSentence(g), null);
});

test("robots with no brand are excluded and counted, never lumped into one bucket", () => {
  const r = byBrand([bot("A", "Pudu"), bot("B", "Gausium", { tasks: 500 }), bot("C", null)]);
  assert.equal(r.unbranded, 1);
  assert.equal(r.groups[0].brands.reduce((n, b) => n + b.robotCount, 0), 2);
});

test("unpriced robots never reach the table", () => {
  const r = byBrand([bot("A", "Pudu"), bot("B", "Gausium", { tasks: 500 }), { name: "C", brand: "Bear", fin: null }]);
  assert.deepEqual(r.groups[0].brands.map((b) => b.brand).sort(), ["Gausium", "Pudu"]);
});

test("a brand with no invoice is dropped rather than shown as free", () => {
  const r = byBrand([bot("A", "Pudu"), bot("B", "Gausium", { invoice: 0 })]);
  assert.equal(r.groups.length, 0);
});

test("the sentence names both brands and the gap", () => {
  const g = byBrand([bot("A", "Pudu", { tasks: 1_000, invoice: 50_000 }), bot("B", "Gausium", { tasks: 500, invoice: 50_000 })]).groups[0];
  const s = brandSentence(g);
  assert.match(s, /Pudu/);
  assert.match(s, /Gausium/);
  assert.match(s, /100% more/);
});

test("a brand resting on one machine is flagged, not hidden", () => {
  const g = byBrand([bot("A", "Pudu", { tasks: 1_900 }), bot("B", "Bear"), bot("C", "Bear")]).groups[0];
  assert.deepEqual(g.singleMachineBrands, ["Pudu"]);
  // still compared: one machine is that operator's real experience of the brand
  assert.equal(g.comparable, true);
  assert.equal(g.brands.find((b) => b.brand === "Pudu").thin, false);
});

test("plenty of work on one machine is not thin, tiny work on many is", () => {
  const g = byBrand([
    bot("A", "Pudu", { tasks: 1_900 }),
    bot("B", "Bear", { tasks: 5, invoice: 400 }),
    bot("C", "Bear", { tasks: 5, invoice: 400 }),
  ]).groups[0];
  assert.equal(g.brands.find((b) => b.brand === "Pudu").thin, false);
  assert.equal(g.brands.find((b) => b.brand === "Bear").thin, true);
});
