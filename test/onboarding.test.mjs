import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { importTelemetryFromText } from "../src/importer.mjs";
import {
  onboardingStep,
  ownerModel,
  confirmModel,
  renderConfirmHTML,
  renderImportHTML,
  parseConfirmForm,
  applyConfirm,
  recordImport,
  lastImport,
  setBusinessType,
  businessType,
  renderBusinessHTML,
} from "../src/owner.mjs";
import { BUSINESS_TYPES, worksFor, defaultWorkFor, taskLabelFor, businessPreview } from "../src/rates.mjs";

const NOW = Date.parse("2026-08-06T00:00:00Z");
const DAY = 86_400_000;
function tempStore(business = "restaurant") {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "onb.db"));
  if (business) setBusinessType(s, business);
  return s;
}

// a small two-robot export: one busy delivery robot, one long-cycle cleaner
function exportCsv({ days = 3 } = {}) {
  const rows = ["robot_id,timestamp,connection_state,battery_pct,mission_state,mission_id"];
  const start = Date.parse("2026-07-01T08:00:00Z");
  for (let d = 0; d < days; d++) {
    for (let m = 0; m < 600; m += 5) {
      const t = new Date(start + d * DAY + m * 60_000).toISOString();
      const active = (m / 5) % 4 < 2;
      rows.push(`servi-1,${t},online,90,${active ? "active" : "idle"},${active ? "m" + d + m : ""}`);
      rows.push(`scrub-1,${t},online,80,active,cycle-${d}`);
    }
  }
  return rows.join("\n");
}

test("import writes rollups, so a dropped file produces a real statement", () => {
  const s = tempStore();
  const res = importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });

  assert.equal(res.robots.length, 2);
  assert.ok(res.imported > 400, `imported ${res.imported}`);
  // the whole point: snapshots alone leave the statement empty
  assert.ok(res.buckets > 0, "rollups were written");
  assert.ok(s.rollupsBetweenAll(0, Number.MAX_SAFE_INTEGER).length > 0);

  const m = ownerModel(s, NOW);
  assert.notEqual(m.totals.coverage, null, "coverage is answerable after an import");
  assert.ok(m.totals.workServicedCents > 0, "work serviced is non-zero");
});

test("the window anchors to the telemetry, not to now", () => {
  // export is from July; 'now' is August. Intersecting [now-30d, now] with the
  // data would collapse to nothing and render a statement of zeros over data
  // sitting right there.
  const s = tempStore();
  importTelemetryFromText(s, exportCsv({ days: 3 }), "export.csv", { nowMs: NOW });

  const m = ownerModel(s, NOW);
  assert.ok(m.observedDays > 1, `observed ${m.observedDays} days of July telemetry`);
  assert.ok(m.fromMs < Date.parse("2026-07-04T00:00:00Z"));
  assert.ok(m.totals.workServicedCents > 0);
  assert.match(m.windowLabel, /telemetry on record/);
});

test("skipped rows are reported with a reason", () => {
  const s = tempStore();
  const csv = [
    "robot_id,timestamp,mission_state",
    "r1,2026-07-01T08:00:00Z,active",
    "r1,,active", // no timestamp
    ",2026-07-01T08:05:00Z,active", // no robot id
  ].join("\n");
  const res = importTelemetryFromText(s, csv, "x.csv", { nowMs: NOW });

  assert.equal(res.imported, 1);
  assert.equal(res.skipped, 2);
  assert.equal(res.skipReasons.noTimestamp, 1);
  assert.equal(res.skipReasons.noRobotId, 1);
});

test("onboarding step is derived from data, so an owner resumes where they left off", () => {
  const path = join(mkdtempSync(join(tmpdir(), "botlien-")), "resume.db");
  const s = openStore(path);
  // the one question a telemetry export cannot answer comes first
  assert.equal(onboardingStep(s), "business");
  setBusinessType(s, "restaurant");
  assert.equal(onboardingStep(s), "import");

  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  assert.equal(onboardingStep(s), "confirm");

  applyConfirm(s, parseConfirmForm(new URLSearchParams(), s.listRobots()), NOW);
  assert.equal(onboardingStep(s), "setup");

  const robotId = s.listRobots()[0].id;
  s.upsertRobotEconomics(robotId, { taskType: "tray_delivery", taskBasis: "mission", rateCents: 73 }, NOW);
  assert.equal(onboardingStep(s), "done");

  // Survives a restart: the step is inferred from data on disk, not from a
  // wizard cursor held in memory, so an owner who closes the tab mid-flow and
  // comes back tomorrow lands exactly where they left off.
  s.close();
  assert.equal(onboardingStep(openStore(path)), "done");
});

test("an owner who abandons after importing returns to confirm, not to the start", () => {
  const path = join(mkdtempSync(join(tmpdir(), "botlien-")), "abandon.db");
  const s = openStore(path);
  setBusinessType(s, "restaurant");
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  s.close();

  assert.equal(onboardingStep(openStore(path)), "confirm");
});

test("confirming the fleet renames, recategorizes, and excludes", () => {
  const s = tempStore();
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  const robots = s.listRobots();
  const servi = robots.find((r) => r.robot_key.includes("servi-1"));
  const scrub = robots.find((r) => r.robot_key.includes("scrub-1"));

  const params = new URLSearchParams();
  params.set(`name_${servi.id}`, "Front runner");
  params.set(`category_${servi.id}`, "delivery");
  params.set(`excluded_${servi.id}`, "0");
  params.set(`name_${scrub.id}`, "Back of house scrubber");
  params.set(`category_${scrub.id}`, "cleaning");
  params.set(`excluded_${scrub.id}`, "0");

  applyConfirm(s, parseConfirmForm(params, robots), NOW);

  const after = s.listRobots();
  assert.equal(after.find((r) => r.id === servi.id).display_name, "Front runner");
  assert.equal(after.find((r) => r.id === scrub.id).category, "cleaning");
});

test("recategorizing to cleaning flips the robot to hourly pricing", () => {
  // this is why the confirm step exists: an import cannot tell a scrubber from
  // a food runner, and per-run pricing on a scrubber is wrong by an order of
  // magnitude
  const s = tempStore();
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  const scrub = s.listRobots().find((r) => r.robot_key.includes("scrub-1"));

  const before = ownerModel(s, NOW).robots.find((r) => r.id === scrub.id);
  assert.equal(before.fin.basis, "mission");

  s.setRobotCategory(scrub.id, "cleaning");
  const after = ownerModel(s, NOW).robots.find((r) => r.id === scrub.id);
  assert.equal(after.fin.basis, "active_hour");
  assert.ok(after.fin.workServicedCents > before.fin.workServicedCents * 5, "hourly pricing is a different order of magnitude");
});

test("an excluded robot leaves the statement rather than being priced at zero", () => {
  const s = tempStore();
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  const robots = s.listRobots();
  assert.equal(ownerModel(s, NOW).robots.length, 2);

  s.excludeRobot(robots[0].id, NOW);
  const m = ownerModel(s, NOW);
  assert.equal(m.robots.length, 1);
  assert.equal(m.excludedCount, 1);
  assert.ok(!m.robots.some((r) => r.id === robots[0].id));

  s.includeRobot(robots[0].id);
  assert.equal(ownerModel(s, NOW).robots.length, 2);
});

test("the import summary states what was read", () => {
  const s = tempStore();
  const res = importTelemetryFromText(s, exportCsv(), "bear-export.csv", { nowMs: NOW });
  recordImport(s, {
    filename: "bear-export.csv",
    rows: res.rows,
    imported: res.imported,
    skipped: res.skipped,
    skipReasons: res.skipReasons,
    robots: res.robots.length,
    rangeLabel: "Jul 1 to Jul 3, 2026",
    at: NOW,
  });

  const back = lastImport(s);
  assert.equal(back.filename, "bear-export.csv");
  assert.equal(back.robots, 2);

  const html = renderConfirmHTML(confirmModel(s, NOW));
  assert.match(html, /Read [\d,]+ rows across 2 robots/);
  assert.match(html, /Jul 1 to Jul 3, 2026/);
  assert.match(html, /Is this your fleet\?/);
});

test("the confirm screen offers rename, kind of work, and exclude for each robot", () => {
  const s = tempStore();
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  const html = renderConfirmHTML(confirmModel(s, NOW));

  assert.equal((html.match(/name="name_\d+"/g) ?? []).length, 2);
  assert.equal((html.match(/name="category_\d+"/g) ?? []).length, 2);
  assert.equal((html.match(/name="excluded_\d+"/g) ?? []).length, 2);
  // the reason the screen exists is stated on it
  assert.match(html, /came in as tray or food delivery/i);
});

test("a hostile robot name is escaped on the confirm screen", () => {
  const s = tempStore();
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW });
  s.renameRobot(s.listRobots()[0].id, "<script>alert(1)</script>");

  const html = renderConfirmHTML(confirmModel(s, NOW));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("the import screen names the columns it accepts and never claims outcomes", () => {
  const idle = renderImportHTML();
  assert.match(idle, /Drop your usage export here/);
  assert.match(idle, /external_id/);
  assert.match(idle, /timestamp/);
  // API second, deliberately
  assert.match(idle, /this comes second/);

  const rejected = renderImportHTML({ error: "No usable rows.", sample: "name,qty" });
  assert.match(rejected, /No usable rows/);
  assert.match(rejected, /we saw: name,qty/);
});

test("empty store renders the import screen without crashing", () => {
  const s = tempStore();
  assert.equal(onboardingStep(s), "import");  // business already answered by tempStore
  const m = confirmModel(s, NOW);
  assert.equal(m.robots.length, 0);
  assert.match(renderConfirmHTML(m), /no robots found/);
});

test("every business type offers real kinds of work with derived rates", () => {
  for (const [key, b] of Object.entries(BUSINESS_TYPES)) {
    assert.ok(b.label, `${key} needs a label`);
    assert.ok(b.works.length > 0, `${key} offers no work`);
    assert.ok(b.works.includes(b.defaultWork), `${key} default is not in its own list`);
    for (const w of b.works) {
      assert.ok(taskLabelFor(w) !== "tasks", `${key} offers ${w} with no vocabulary`);
    }
  }
});

test("the business answer changes what work is offered and what it is worth", () => {
  const restaurant = worksFor("restaurant");
  const warehouse = worksFor("warehouse");

  assert.ok(restaurant.includes("delivery"));
  assert.ok(!restaurant.includes("picking"), "a restaurant is not offered order picking");
  assert.ok(warehouse.includes("picking"));
  assert.ok(!warehouse.includes("bussing"), "a warehouse is not offered bussing");

  assert.equal(defaultWorkFor("warehouse"), "picking");
  assert.equal(defaultWorkFor("facilities"), "cleaning");
  // an unknown answer falls back rather than throwing
  assert.ok(worksFor("nonsense").length > 0);
});

test("vocabulary follows the work, so a warehouse reads picks and not runs", () => {
  assert.equal(taskLabelFor("delivery"), "runs started");
  assert.equal(taskLabelFor("picking"), "picks started");
  assert.equal(taskLabelFor("room_delivery"), "deliveries started");
  assert.equal(taskLabelFor("cleaning"), "active hours");
  // never "completed": telemetry reports a mission beginning, not finishing
  for (const w of Object.keys(BUSINESS_TYPES).flatMap((b) => worksFor(b))) {
    assert.doesNotMatch(taskLabelFor(w), /completed|finished|delivered\b/i);
  }
});

test("a warehouse statement prices picks, not tray runs", () => {
  const s = tempStore("warehouse");
  importTelemetryFromText(s, exportCsv(), "wms-export.csv", {
    nowMs: NOW,
    category: defaultWorkFor("warehouse"),
  });

  const m = ownerModel(s, NOW);
  const r = m.robots[0];
  assert.equal(r.fin.taskType, "pick");
  assert.equal(r.fin.taskLabel, "picks started");
  assert.equal(r.fin.unit, "pick");
  // $24.00/hr / 60 picks per hour = $0.40
  assert.equal(r.fin.rateCents, 40);
  assert.match(r.formula, /picks started/);
});

test("the confirm screen only offers this business's kinds of work", () => {
  const s = tempStore("facilities");
  importTelemetryFromText(s, exportCsv(), "export.csv", { nowMs: NOW, category: "cleaning" });
  const m = confirmModel(s, NOW);

  assert.deepEqual(m.categories, ["cleaning"]);
  const html = renderConfirmHTML(m);
  assert.ok(!html.includes("Order picking"), "a cleaning company is not offered warehouse work");
  assert.match(html, /Cleaning or facilities services/);
});

test("the business question is asked first and only accepts real answers", () => {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "biz.db"));
  assert.equal(businessType(s), null);
  assert.equal(onboardingStep(s), "business");

  assert.equal(setBusinessType(s, "not-a-business"), false);
  assert.equal(businessType(s), null, "a bad answer is rejected, not stored");

  assert.equal(setBusinessType(s, "hotel"), true);
  assert.equal(businessType(s), "hotel");
  assert.equal(onboardingStep(s), "import");

  const html = renderBusinessHTML("hotel");
  assert.match(html, /What kind of business is this\?/);
  assert.match(html, /Hotel or hospitality/);
  assert.match(html, /Warehouse or e-commerce/);
  assert.match(html, /value="hotel" checked/);
});

test("the import screen names the export this business would have", () => {
  assert.match(renderImportHTML({ business: "warehouse" }), /your WMS or robot fleet console/);
  assert.match(renderImportHTML({ business: "restaurant" }), /Bear Universe or Pudu Cloud/);
  assert.match(renderImportHTML({}), /your robot vendor's console/);
});

test("the business screen shows what the answer buys before it is answered", () => {
  const html = renderBusinessHTML();

  // the button cannot be pressed until something is chosen, and says so
  assert.match(html, /id="go" disabled/);
  assert.match(html, /Choose one to continue/);

  // each card lists the kinds of work it unlocks, without needing JavaScript
  assert.match(html, /Order picking/);
  assert.match(html, /Tray or food delivery/);

  // and nothing is presented as locked in
  assert.match(html, /change any of this later/i);
});

test("choosing a business names the choice on the button and states the rate", () => {
  const html = renderBusinessHTML("warehouse");

  assert.match(html, /Continue as warehouse or e-commerce/);
  assert.doesNotMatch(html, /id="go" disabled/);
  assert.match(html, /order picking, putaway and replenishment, floor cleaning/);
  assert.match(html, /\$0\.40 per pick/);
  assert.match(html, /\$24\.00\/hr ÷ 60 picks per hour/);
});

test("a rejected answer explains itself rather than silently repainting", () => {
  const empty = renderBusinessHTML(null, { error: "Choose the kind of business this is so we know what your robots' work is worth." });
  assert.match(empty, /class="err"/);
  assert.match(empty, /Choose the kind of business/);
});

test("rate derivations pluralize correctly and never divide by one hour", () => {
  // "deliverys" and "÷ 1 active hour per hour" were both real output
  for (const key of Object.keys(BUSINESS_TYPES)) {
    const d = businessPreview(key).derivation;
    assert.doesNotMatch(d, /deliverys|runs s|picks s/, `bad plural in: ${d}`);
    assert.doesNotMatch(d, /÷ 1 active hour/, `circular derivation in: ${d}`);
  }
  assert.match(businessPreview("hotel").derivation, /12 deliveries per hour/);
  assert.match(businessPreview("facilities").derivation, /one contracted human-hour/);
});

test("every business preview is complete and internally consistent", () => {
  for (const key of Object.keys(BUSINESS_TYPES)) {
    const p = businessPreview(key);
    assert.ok(p.works.length > 0, `${key} offers nothing`);
    assert.ok(p.rateCents > 0, `${key} has no starting rate`);
    assert.ok(p.derivation.includes("$"), `${key} derivation shows no money`);
    assert.ok(p.operatingHoursDay > 0 && p.operatingHoursDay <= 24, `${key} has impossible hours`);
    assert.ok(p.exportHint, `${key} does not say what export to look for`);
  }
  assert.equal(businessPreview("nonsense"), null);
});
