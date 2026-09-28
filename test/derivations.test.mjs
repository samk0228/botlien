// Phase 3's last pieces: payback from measured months, named stall places,
// and the stops in closed periods.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { fleetContract, closePeriods, paybackFor, monthsBetween, spotKey, KV_BILLING_DAY } from "../src/contract.mjs";
import { saveInputs, loadInputs } from "../src/inputs.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { buildBrief } from "../src/brief.mjs";
import { createVault } from "../src/vault.mjs";
import { createAlertsJob, RULE } from "../src/alerts.mjs";

const require = createRequire(import.meta.url);
const { liveTables } = require("../prototype/src/live-adapter.cjs");
const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);

// ---- payback ----

const lease = (o = {}) => ({ start_date: "2026-01-04", payback_months: 6, equip_cost_cents: null, ...o });
const month = (start, workCents) => ({ start, end: start, workCents, invoiceCents: 100_000, frozen: true });

test("whole months between two dates", () => {
  assert.equal(monthsBetween("2026-01-15", "2026-03-14"), 1);
  assert.equal(monthsBetween("2026-01-15", "2026-03-15"), 2);
  assert.equal(monthsBetween("2026-03-01", "2026-01-01"), 0);
});

test("payback is paid once measured months alone cross the price", () => {
  const p = paybackFor({ lease: lease(), category: "delivery", months: [month("2026-01-04", 1_000_000), month("2026-02-04", 900_000)], asOfKey: "2026-09-01" });
  assert.equal(p.priceCents, 1_800_000);
  assert.equal(p.priceSource, "benchmark");
  assert.equal(p.status, "paid");
});

test("with every month measured, a robot past its promised month unpaid has missed", () => {
  const months = ["2026-01-04", "2026-02-04", "2026-03-04", "2026-04-04", "2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"].map((s) => month(s, 100_000));
  const p = paybackFor({ lease: lease(), category: "delivery", months, asOfKey: "2026-09-01" });
  assert.equal(p.monthsSinceStart, 7);
  assert.equal(p.monthsUnmeasured, 0);
  assert.equal(p.status, "missed");
  assert.equal(p.paceMonths, 7 + Math.ceil((1_800_000 - 800_000) / 100_000));
});

test("before the promised month the pace decides on track or behind", () => {
  const fast = paybackFor({ lease: lease({ payback_months: 12 }), category: "delivery", months: [month("2026-01-04", 400_000), month("2026-02-04", 400_000)], asOfKey: "2026-03-01" });
  assert.equal(fast.status, "on track");
  const slow = paybackFor({ lease: lease({ payback_months: 12 }), category: "delivery", months: [month("2026-01-04", 50_000), month("2026-02-04", 50_000)], asOfKey: "2026-03-01" });
  assert.equal(slow.status, "behind");
});

test("months before the data began mean no verdict, not a guess", () => {
  const p = paybackFor({ lease: lease({ start_date: "2025-01-04" }), category: "delivery", months: [month("2026-08-04", 100_000)], asOfKey: "2026-09-01" });
  assert.equal(p.status, "partly measured");
  assert.ok(p.monthsUnmeasured > 12);
});

test("the owner's own price wins, and no lease or no price says so", () => {
  assert.equal(paybackFor({ lease: lease({ equip_cost_cents: 5_000_000 }), category: "delivery", months: [], asOfKey: "2026-02-01" }).priceSource, "owner");
  assert.equal(paybackFor({ lease: null, category: "delivery", months: [], asOfKey: "2026-02-01" }).status, "no lease");
  assert.equal(paybackFor({ lease: lease(), category: "juggling", months: [], asOfKey: "2026-02-01" }).status, "no price");
});

// ---- a two-period account: stalls at one spot in July and August ----

function account({ leaseStart = "2026-07-04", payback = 1, price = 5_000_000 } = {}) {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  setBusinessType(s, "warehouse");
  const id = s.upsertRobot({ connector: "import", externalId: "p1", displayName: "Picker 1", brand: "Locus", model: "LocusBot", category: "picking" }, 1);
  s.setRobotSite(id, s.upsertSite("Pier 4", 1));
  for (const day of ["2026-07-10T15:00:00Z", "2026-08-05T15:00:00Z", "2026-08-06T15:00:00Z"]) {
    const t0 = at(day);
    for (let i = 0; i < 48; i++) {
      const t = t0 + i * 10 * MIN;
      const stuck = i >= 20 && i < 23;
      s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: "active", missionId: `${day}-${i}`, moving: !stuck, stuck, pose: { x: 13.2, y: 6.9 } });
    }
  }
  rebuildRollupsForRobot(s, id);
  s.upsertRobotEconomics(id, { taskType: "picking", taskBasis: "mission", rateCents: 40, invoiceCentsMonth: 100_000, wageCentsHour: null, operatingHoursDay: 12 }, 1);
  s.upsertRobotContract(id, { startDate: leaseStart, termMonths: 36, paybackMonths: payback, uptimePct: 95, equipCostCents: price }, 1);
  s.setKV(KV_CONFIRMED, "1");
  return { s, id };
}
const AUG_7 = at("2026-08-07T18:00:00Z");

test("the contract carries each robot's payback, frozen months first", () => {
  const { s, id } = account();
  closePeriods(s, AUG_7);
  const p = fleetContract(s, AUG_7).payback.find((x) => x.robotId === id);
  assert.deepEqual(p.months.map((m) => [m.start, m.frozen]), [["2026-07-04", true], ["2026-08-04", false]]);
  assert.equal(p.priceSource, "owner");
  assert.equal(p.status, "missed", "a one-month promise, a month in, far from $50,000");
  const T = liveTables(fleetContract(s, AUG_7));
  assert.equal(T.PAYBACK[0].status, "missed");
  assert.equal(T.PAYBACK[0].months.length, 2);
});

test("a missed payback is emailed once, in the daily email", async () => {
  const { s } = account();
  const control = openControl(":memory:");
  control.upsertAccount("owner@fleet.co", 1);
  const sent = [];
  const vault = createVault({ keyB64: Buffer.alloc(32, 5).toString("base64") });
  const job = createAlertsJob({ control, tenants: { get: () => s }, mailer: { async send(m) { sent.push(m); return { ok: true }; } }, vault, baseUrl: "https://app.botlien.com", send: true });
  const morning = at("2026-08-07T15:00:00Z"); // 8 AM Pacific
  await job.tick(morning);
  await job.tick(morning + 86_400_000);
  const paybackMails = sent.filter((m) => /payback/.test(m.subject) || /PAYBACK PROMISES MISSED/.test(m.text));
  assert.equal(paybackMails.length, 1);
  assert.match(paybackMails[0].text, /Picker 1 passed its 1-month payback without paying back/);
  assert.ok(JSON.parse(s.getKV("alerts.log"))[RULE.payback]);
});

// ---- named places ----

test("a stall spot keeps the dashboard's 2 m grid key", () => {
  assert.equal(spotKey({ x: 13.2, y: 6.9 }), "14,6");
  assert.equal(spotKey(null), null);
});

test("naming a spot names every stall there, on the dashboard and in the brief", () => {
  const { s } = account();
  const before = fleetContract(s, AUG_7);
  assert.equal(before.downtime[0].spot, "14,6");
  assert.equal(before.downtime[0].place, null);
  saveInputs(s, { account: { placeNames: { "pier-4": { "14,6": "aisle 14" } } } }, 2);
  const c = fleetContract(s, AUG_7);
  assert.ok(c.downtime.every((d) => d.place === "aisle 14"));
  assert.equal(liveTables(c).DOWNTIME[0][0].cause, "stuck · aisle 14");
  const brief = buildBrief(c, { inputs: loadInputs(s) });
  assert.equal(brief.parity.fix.place, "aisle 14");
});

// ---- closed periods' stops ----

test("stops in closed periods are listed with their period", () => {
  const { s } = account();
  const c = fleetContract(s, AUG_7);
  assert.equal(c.pastDowntime.length, 1);
  assert.equal(c.pastDowntime[0].period, "2026-07-04");
  assert.equal(c.pastDowntime[0].date, "2026-07-10");
  assert.ok(c.downtime.every((d) => d.date >= "2026-08-04"), "the open period's list is unchanged");
  const T = liveTables(c);
  assert.equal(T.DOWNTIME_PAST[0][0].period, "2026-07-04");
});
