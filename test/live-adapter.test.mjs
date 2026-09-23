import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { openStore } from "../src/store.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { fleetContract, KV_BILLING_DAY } from "../src/contract.mjs";
import { renderAppHTML, scriptJSON, APP_HTML_PATH } from "../src/app.mjs";
import { requiresSession } from "../src/gate.mjs";

const require = createRequire(import.meta.url);
const { liveTables } = require("../prototype/src/live-adapter.cjs");

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);

function contract() {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  const pier = s.upsertSite("Pier 4", 1);
  const marina = s.upsertSite("Marina", 1);
  const mk = (ext, name, brand, model, category, site) => {
    const id = s.upsertRobot({ connector: "import", externalId: ext, displayName: name, brand, model, category }, 1);
    s.setRobotSite(id, site);
    return id;
  };
  const a = mk("p2", "Picker 2 (Zone B)", "Locus", "LocusBot", "picking", pier);
  const b = mk("s1", "Scrubber (Marina)", "Gausium", "S75", "cleaning", marina);
  const t0 = at("2026-08-05T15:00:00Z");
  // A July day for the picker, so there is one closed month with data and
  // four empty ones before it.
  const july = at("2026-07-10T15:00:00Z");
  for (let i = 0; i < 12; i++) {
    const t = july + i * 10 * MIN;
    s.insertSnapshot({ robotId: a, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: "active", missionId: `j${i}`, moving: true, stuck: false, pose: { x: 1, y: 1 } });
  }
  for (const id of [a, b]) {
    for (let i = 0; i < 40; i++) {
      const t = t0 + i * 10 * MIN;
      const stuck = id === a && i >= 20 && i < 23;
      s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: "active", missionId: `m${id}-${i}`, moving: !stuck, stuck, pose: { x: 13, y: 5 } });
    }
    rebuildRollupsForRobot(s, id);
  }
  s.upsertRobotEconomics(a, { taskType: "order_pick", taskBasis: "mission", rateCents: 42, invoiceCentsMonth: 150_000, wageCentsHour: 2400, operatingHoursDay: 12 }, 1);
  s.upsertRobotContract(a, { startDate: "2025-07-01", termMonths: 36, paybackMonths: 14, uptimePct: 95 }, 1);
  s.insertTicket({ ref: "T-1041", brand: "Locus", robotId: a, title: "Repeat stalls", openedAt: at("2026-08-15T23:10:00Z") });
  return fleetContract(s, at("2026-09-01T00:00:00Z"));
}

test("every per-robot table is index-aligned with ROBOTS", () => {
  const T = liveTables(contract());
  const n = T.ROBOTS.length;
  assert.equal(n, 2);
  for (const k of ["SETUP", "CONFIRM", "DAILY", "KEEPING", "CONTRACT", "DOWNTIME", "SAFETY"]) {
    assert.equal(T[k].length, n, `${k} has one entry per robot`);
  }
  assert.deepEqual(T.ROBOTS.map((r) => r.name), T.CONFIRM.map((r) => r.name));
});

test("robots carry the demo's shapes: brand-first model, site index, duty strings", () => {
  const T = liveTables(contract());
  assert.equal(T.ROBOTS[0].model, "Locus LocusBot");
  assert.equal(T.ROBOTS[0].model.split(" ")[0], "Locus", "brandOf() reads the first word");
  assert.equal(T.ROBOTS[1].site, 1);
  assert.match(T.ROBOTS[0].duty, /^duty \d+%$/);
  assert.deepEqual(T.SITES, [{ name: "Pier 4" }, { name: "Marina" }]);
  assert.deepEqual(T.SITE_ROBOT_COUNTS, [1, 1]);
  assert.equal(T.CONFIRM[0].work, "Order picking");
  assert.equal(T.CONFIRM[1].work, "Floor cleaning");
  assert.equal(T.SETUP[0].hours, "12.0 h");
});

test("periods read like the demo's and bound the same days", () => {
  const T = liveTables(contract());
  assert.equal(T.PERIODS[0].label, "Aug 4 – Sep 3, 2026");
  assert.equal(T.PERIODS[0].status, "open");
  assert.equal(T.PERIODS[1].closed, "Closed Aug 4");
  assert.deepEqual(T.PERIOD_BOUNDS[0], ["2026-08-04", "2026-09-03"]);
  assert.equal(T.PERIODS[0].siteCov.length, 2);
});

test("months with no data are left out, so none reads as 0.00x", () => {
  const T = liveTables(contract());
  assert.equal(T.PERIODS.length, 2, "August (open) and July; the four empty months before are dropped");
  assert.equal(T.PERIOD_BOUNDS.length, T.PERIODS.length);
  assert.equal(T.PERIODS[1].siteCov[1], null, "Marina had no robot running in July");
});

test("a stall with no named place is grouped by where the robot stood", () => {
  const T = liveTables(contract());
  assert.equal(T.DOWNTIME[0].length, 1);
  assert.equal(T.DOWNTIME[0][0].cause, "stuck · near 14, 6 m");
  assert.equal(T.DOWNTIME[1].length, 0);
});

test("only what the owner entered is seeded: contract, invoice, hours", () => {
  const T = liveTables(contract());
  assert.deepEqual(T.CONTRACT[0], { start: "2025-07-01", term: 36, payback: 14, uptime: 95 });
  assert.equal(T.CONTRACT[1], undefined, "no lease typed, so the page's own default applies");
  assert.deepEqual(T.INVOICE, { 0: 1500 });
  assert.deepEqual(T.HOURS, { 0: 12 });
  assert.equal(T.TICKETS[0].i, 0);
  assert.equal(T.TICKETS[0].opened, "2026-08-15T16:10");
});

test("the page is injected before its own script, and ?demo=1 is served untouched", () => {
  const html = "<html><head><script>head()</script></head><body><div id=root></div>\n<script>page()</script></body></html>";
  const out = renderAppHTML({ contract: { robots: [] }, account: { email: "sam@example.com" }, html });
  assert.ok(out.indexOf("window.BOTLIEN_LIVE=") < out.indexOf("page()"));
  assert.ok(out.indexOf("window.BOTLIEN_LIVE=") > out.indexOf("<body"));
  assert.match(out, /"email":"sam@example.com"/);
  assert.equal(renderAppHTML({ contract: null, html }), html);
});

test("contract text can never close the script element", () => {
  assert.equal(scriptJSON({ name: "</script><script>x()" }).includes("</script>"), false);
});

test("the built page carries the adapter and the LIVE switch", () => {
  const page = readFileSync(APP_HTML_PATH, "utf8");
  assert.ok(page.includes("function liveTables("));
  assert.ok(page.includes("const ROBOTS = LIVE ? LIVE.ROBOTS : "));
  assert.equal(/__[A-Z_]+__/.test(page), false, "no build placeholder left behind");
});

test("the dashboard sits behind a session", () => {
  assert.equal(requiresSession("/app"), true);
});
