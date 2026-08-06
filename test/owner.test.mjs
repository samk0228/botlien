import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { ownerModel, renderOwnerHTML, renderSetupHTML, parseSetupForm, money, ratio, pct } from "../src/owner.mjs";

const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const HOUR = 3_600_000;
const DAY = 86_400_000;

// 30 days of buckets so the default 30-day window has something to price
function seededStore({ withEconomics = false } = {}) {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "owner.db"));
  const r1 = s.upsertRobot({ connector: "sim", externalId: "r1", displayName: "Servi 1", brand: "Bear", model: "Servi", category: "delivery" }, NOW - 40 * DAY);
  const r2 = s.upsertRobot({ connector: "sim", externalId: "r2", displayName: "<script>alert(1)</script>", brand: "Gausium", category: "cleaning" }, NOW - 40 * DAY);
  s.insertSnapshot({ robotId: r1, at: NOW - 60_000, receivedAt: NOW - 60_000, connector: "sim", source: "sim", connectionState: "online", missionState: "active" });

  const base = { bucketMs: HOUR, sampleCount: 60, onlineMs: HOUR, errorCount: 0, stuckEpisodes: 0 };
  for (let d = 0; d < 30; d++) {
    // r1: 40 runs a day, 6 duty hours a day
    s.upsertRollup({ ...base, robotId: r1, bucketStartAt: NOW - (29 - d) * DAY, activeMs: 6 * HOUR, missionCount: 40 });
    // r2: one long cleaning mission, 4 duty hours a day
    s.upsertRollup({ ...base, robotId: r2, bucketStartAt: NOW - (29 - d) * DAY, activeMs: 4 * HOUR, missionCount: 1 });
  }
  if (withEconomics) {
    s.upsertRobotEconomics(r1, {
      taskType: "tray_delivery", taskBasis: "mission", rateCents: 200,
      invoiceCentsMonth: 50_000, wageCentsHour: 2_000, operatingHoursDay: 10,
    }, NOW);
  }
  return { s, r1, r2 };
}

test("ownerModel prices every robot and blends the fleet", () => {
  const { s } = seededStore();
  const m = ownerModel(s, NOW);

  assert.equal(m.robots.length, 2);
  assert.equal(m.windowDays, 30);
  assert.equal(m.demo, true);

  const r1 = m.robots.find((r) => r.key === "sim:r1");
  assert.equal(r1.fin.tasks, 1_200); // 40 runs x 30 days
  assert.equal(r1.fin.taskLabel, "runs started");
  assert.equal(r1.fin.workServicedCents, 87_600); // 1200 runs x $0.73 derived rate

  // cleaning robot is valued by the hour, not by its single daily mission
  const r2 = m.robots.find((r) => r.key === "sim:r2");
  assert.equal(r2.fin.basis, "active_hour");
  assert.equal(r2.fin.tasks, 120); // 4h x 30 days, not 30 missions

  assert.ok(m.totals.coverage > 0);
  assert.equal(m.totals.robotCount, 2);
});

test("ownerModel marks benchmark defaults until the owner sets real numbers", () => {
  const { s } = seededStore();
  assert.equal(ownerModel(s, NOW).defaultCount, 2);

  const { s: s2 } = seededStore({ withEconomics: true });
  const m2 = ownerModel(s2, NOW);
  assert.equal(m2.defaultCount, 1);
  const r1 = m2.robots.find((r) => r.key === "sim:r1");
  assert.equal(r1.configured, true);
  assert.equal(r1.fin.rateCents, 200); // owner's rate, not the 125 benchmark

  // the fixture holds 29 days of buckets, so a $500/month invoice prorates to
  // 29/30 of a month. The window never bills for days with no telemetry.
  assert.equal(Math.round(m2.observedDays), 29);
  assert.equal(r1.fin.invoiceProratedCents, Math.round(50_000 * (29 / 30)));
});

test("the window clamps to the telemetry on record instead of billing empty days", () => {
  const { s } = seededStore();

  // asking for a year cannot stretch the invoice across months never observed
  const m = ownerModel(s, NOW, { owner: { window_days: 365 } });
  assert.equal(m.clamped, true);
  assert.ok(m.observedDays < 30, `observed ${m.observedDays} days, not 365`);
  assert.match(m.windowLabel, /telemetry on record/);

  // and coverage stays in a sane band rather than collapsing toward zero
  assert.ok(m.totals.coverage > 0.1, `coverage ${m.totals.coverage} should not collapse`);
});

test("a robot whose category has no benchmark is excluded, not zeroed", () => {
  const { s } = seededStore();
  const odd = s.upsertRobot({ connector: "sim", externalId: "r9", displayName: "Humanoid", category: "humanoid" }, NOW - DAY);
  s.upsertRollup({ robotId: odd, bucketStartAt: NOW - HOUR, bucketMs: HOUR, sampleCount: 1, onlineMs: HOUR, activeMs: HOUR, missionCount: 5, errorCount: 0, stuckEpisodes: 0 });

  const m = ownerModel(s, NOW);
  assert.equal(m.unpricedCount, 1);
  assert.equal(m.robots.find((r) => r.key === "sim:r9").fin, null);
  assert.equal(m.totals.robotCount, 2); // the unpriced robot does not drag totals to zero
});

test("robots group by site even with one site, so multi-site drops in later", () => {
  const { s, r1 } = seededStore();
  const m1 = ownerModel(s, NOW);
  assert.equal(m1.sites.length, 1);
  assert.equal(m1.sites[0].name, "Main site");

  const patio = s.insertFleet({ name: "Patio" }, NOW);
  s.setRobotFleet(r1, patio);
  const m2 = ownerModel(s, NOW);
  assert.equal(m2.sites.length, 2);
  assert.deepEqual(m2.sites.map((x) => x.name), ["Main site", "Patio"]);
  assert.ok(m2.sites.find((x) => x.name === "Patio").totals.coverage > 0);
});

test("renderOwnerHTML shows the four numbers, escapes hostile names, states the arithmetic", () => {
  const { s } = seededStore();
  const html = renderOwnerHTML(ownerModel(s, NOW));

  assert.ok(!html.includes("<script>alert(1)</script>"), "hostile robot name is escaped");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Coverage"));
  assert.ok(html.includes("Work serviced"));
  assert.ok(html.includes("Cost per task"));
  assert.ok(html.includes("Utilization"));
  assert.ok(html.includes("runs started"), "the count is labelled honestly");
  assert.ok(html.includes("DEMO"));
  assert.ok(html.includes("benchmark"), "defaults are disclosed");
});

test("no figure on the owner board claims revenue, profit, or savings", () => {
  const { s } = seededStore({ withEconomics: true });
  const html = renderOwnerHTML(ownerModel(s, NOW));
  // strip the stylesheet and the closing disclaimer: what remains is every
  // number and label the owner actually reads as a claim
  const figures = html
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<div class="honest">[\s\S]*?<\/div>/, "");

  assert.doesNotMatch(figures, /\brevenue\b/i);
  assert.doesNotMatch(figures, /\bprofit\b/i);
  assert.doesNotMatch(figures, /\bsavings?\b/i);
  assert.doesNotMatch(figures, /runs completed|tasks completed|deliveries completed/i);
});

test("the disclaimer states plainly what Botlien does not claim", () => {
  const { s } = seededStore({ withEconomics: true });
  const html = renderOwnerHTML(ownerModel(s, NOW));
  const honest = html.match(/<div class="honest">([\s\S]*?)<\/div>/)[1];

  assert.match(honest, /does not claim revenue, profit, or labor saved/i);
  assert.match(honest, /runs started, not runs completed/i);
  assert.match(honest, /check it by hand/i);
});

test("empty store renders both owner pages without crashing", () => {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "empty-owner.db"));
  const m = ownerModel(s, NOW);
  assert.equal(m.robots.length, 0);
  assert.equal(m.totals.coverage, null);

  const board = renderOwnerHTML(m);
  assert.ok(board.includes("no robots yet"));
  const setup = renderSetupHTML(m);
  assert.ok(setup.includes("no robots yet"));
});

test("setup form prefills from benchmarks and persists a round trip", () => {
  const { s, r1 } = seededStore();
  const html = renderSetupHTML(ownerModel(s, NOW));
  assert.ok(html.includes(`name="rate_${r1}"`));
  assert.ok(html.includes("0.73"), "derived delivery rate is prefilled");
  assert.ok(html.includes("using benchmarks"));

  const params = new URLSearchParams();
  params.set(`task_type_${r1}`, "tray delivery");
  params.set(`task_basis_${r1}`, "mission");
  params.set(`rate_${r1}`, "$2.50");
  params.set(`invoice_${r1}`, "1,200.00");
  params.set(`hours_${r1}`, "10");

  const { updates, errors } = parseSetupForm(params, s.listRobots());
  assert.equal(errors.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].econ.rateCents, 250, "currency symbols and commas are stripped");
  assert.equal(updates[0].econ.invoiceCentsMonth, 120_000);

  s.upsertRobotEconomics(updates[0].robotId, updates[0].econ, NOW);
  const after = ownerModel(s, NOW).robots.find((r) => r.id === r1);
  assert.equal(after.configured, true);
  assert.equal(after.fin.workServicedCents, 300_000); // 1200 runs x $2.50
});

test("bad form values are rejected, never coerced into a confident wrong number", () => {
  const { s, r1 } = seededStore();
  const robots = s.listRobots();

  const negative = new URLSearchParams([[`task_type_${r1}`, "x"], [`task_basis_${r1}`, "mission"], [`rate_${r1}`, "-5"]]);
  assert.equal(parseSetupForm(negative, robots).updates.length, 0);
  assert.equal(parseSetupForm(negative, robots).errors[0].field, "rate");

  const notANumber = new URLSearchParams([[`task_type_${r1}`, "x"], [`task_basis_${r1}`, "mission"], [`rate_${r1}`, "free"]]);
  assert.equal(parseSetupForm(notANumber, robots).updates.length, 0);

  const badBasis = new URLSearchParams([[`task_type_${r1}`, "x"], [`task_basis_${r1}`, "vibes"], [`rate_${r1}`, "1.00"]]);
  assert.equal(parseSetupForm(badBasis, robots).errors[0].field, "basis");

  const impossibleHours = new URLSearchParams([[`task_type_${r1}`, "x"], [`task_basis_${r1}`, "mission"], [`rate_${r1}`, "1.00"], [`hours_${r1}`, "48"]]);
  assert.equal(parseSetupForm(impossibleHours, robots).errors[0].field, "hours");

  // absent robots are simply left alone
  assert.equal(parseSetupForm(new URLSearchParams(), robots).updates.length, 0);
  assert.equal(parseSetupForm(new URLSearchParams(), robots).errors.length, 0);
});

test("formatters degrade to a dash instead of NaN", () => {
  assert.equal(money(null), "–");
  assert.equal(money(150_000), "$1,500.00");
  assert.equal(ratio(null), "–");
  assert.equal(ratio(2.345), "2.35x");
  assert.equal(pct(null), "–");
  assert.equal(pct(49.6), "50%");
});
