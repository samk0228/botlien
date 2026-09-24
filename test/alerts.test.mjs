import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { fleetContract, closePeriods, KV_BILLING_DAY } from "../src/contract.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { createVault } from "../src/vault.mjs";
import { createAlertsJob, KV_ALERTS_SENT, RULE } from "../src/alerts.mjs";
import { KV_ALERTS_STOPPED, verifyStop } from "../src/brief-job.mjs";

const require = createRequire(import.meta.url);
const { liveTables } = require("../prototype/src/live-adapter.cjs");
const TZ = "America/Los_Angeles";
const MIN = 60_000;
const DAY = 86_400_000;
const at = (iso) => Date.parse(iso);
const vault = createVault({ keyB64: Buffer.alloc(32, 9).toString("base64") });

/** A confirmed account with two pickers working every day from `from` to
 *  `to`, a 99.9% promise, and Picker 2 stalling daily. Picker 2 can be left
 *  idle for the last `idleDays` days. */
function account({ from = "2026-07-20", to = "2026-08-06", idleDays = 0 } = {}) {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  setBusinessType(s, "warehouse");
  const site = s.upsertSite("Pier 4", 1);
  const ids = [1, 2].map((n) => {
    const id = s.upsertRobot({ connector: "import", externalId: `p${n}`, displayName: `Picker ${n}`, brand: "Locus", model: "LocusBot", category: "picking" }, 1);
    s.setRobotSite(id, site);
    return id;
  });
  const end = at(`${to}T00:00:00Z`);
  for (let t0 = at(`${from}T15:00:00Z`); t0 <= end + 15 * 3_600_000; t0 += DAY) {
    ids.forEach((id, k) => {
      const idle = k === 1 && t0 > end + 15 * 3_600_000 - idleDays * DAY;
      for (let i = 0; i < 48; i++) {
        const t = t0 + i * 10 * MIN;
        const stuck = k === 1 && !idle && i >= 20 && i < 24;
        s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: idle ? "idle" : "active", missionId: idle ? null : `${id}-${t}`, moving: !stuck && !idle, stuck, pose: { x: 2, y: 2 } });
      }
    });
  }
  ids.forEach((id) => {
    rebuildRollupsForRobot(s, id);
    s.upsertRobotEconomics(id, { taskType: "picking", taskBasis: "mission", rateCents: 40, invoiceCentsMonth: 150_000, wageCentsHour: null, operatingHoursDay: 12 }, 1);
    s.upsertRobotContract(id, { startDate: "2026-07-04", termMonths: 36, paybackMonths: 14, uptimePct: 99.9 }, 1);
  });
  s.setKV(KV_CONFIRMED, "1");
  return { s, ids };
}

function job({ s, send = true, control = openControl(":memory:") } = {}) {
  const { account: acct } = control.upsertAccount("owner@fleet.co", 1);
  const sent = [], logs = [];
  const mailer = { async send(m) { sent.push(m); return { ok: true }; } };
  const j = createAlertsJob({ control, tenants: { get: () => s }, mailer, vault, baseUrl: "https://app.botlien.com", send, log: (l) => logs.push(l) });
  return { j, sent, logs, control, acct };
}

// Aug 6, 6:00 AM Pacific: before the daily check.
const AUG6_6AM = at("2026-08-06T13:00:00Z");

test("switching alerts on does not send statements for periods already closed", async () => {
  const { s } = account();
  closePeriods(s, AUG6_6AM);
  const { j, sent } = job({ s });
  await j.tick(AUG6_6AM);
  assert.equal(sent.length, 0);
  assert.ok(JSON.parse(s.getKV(KV_ALERTS_SENT))["close:2026-07-04"], "July marked as already told");
});

test("a period that closes after that gets one statement, naming the credit owed", async () => {
  const { s } = account();
  const { j, sent } = job({ s });
  await j.tick(AUG6_6AM); // first run, nothing closed yet
  closePeriods(s, AUG6_6AM);
  await j.tick(AUG6_6AM + MIN);
  await j.tick(AUG6_6AM + 2 * MIN);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Jul 4 to Aug 3, 2026 is closed: \$[\d.,]+ in credit owed$/);
  assert.match(sent[0].text, /STATEMENT|THE PERIOD/);
  assert.match(sent[0].text, /CREDIT OWED\n- Picker 2: \$/);
  const stop = new URL(sent[0].headers["List-Unsubscribe"].slice(1, -1));
  assert.equal(stop.searchParams.get("k"), "alerts");
  assert.ok(verifyStop(vault, Object.fromEntries(stop.searchParams)));
  // The page's Alerts table can now say when it went out.
  const T = liveTables(fleetContract(s, AUG6_6AM));
  assert.match(T.ALERT_LOG[RULE.statement], /^Sent Aug 6 · Jul 4 to Aug 3, 2026 closed$/);
  assert.ok(T.ALERT_LOG[RULE.credit]);
});

test("the daily check tells about a low part once, and again only after it is replaced", async () => {
  const { s, ids } = account();
  s.insertComponentWear(ids[0], at("2026-08-06T01:00:00Z"), [{ component: "drive wheel", lifeSpanHours: 1000, usedLifeHours: 900, remainingPct: 10 }]);
  const { j, sent } = job({ s });
  await j.tick(AUG6_6AM);
  assert.equal(sent.length, 0, "not before 7 AM");
  await j.tick(AUG6_6AM + 90 * MIN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Picker 1: drive wheel has 10% of its life left");
  await j.tick(AUG6_6AM + 90 * MIN + DAY);
  assert.equal(sent.length, 1, "not again the next day");
  // Replaced, then worn down again.
  s.insertComponentWear(ids[0], AUG6_6AM + 2 * DAY, [{ component: "drive wheel", lifeSpanHours: 1000, usedLifeHours: 10, remainingPct: 99 }]);
  await j.tick(AUG6_6AM + 90 * MIN + 2 * DAY);
  s.insertComponentWear(ids[0], AUG6_6AM + 3 * DAY, [{ component: "drive wheel", lifeSpanHours: 1000, usedLifeHours: 880, remainingPct: 12 }]);
  await j.tick(AUG6_6AM + 90 * MIN + 3 * DAY);
  assert.equal(sent.length, 2);
});

test("a part past its rating on a robot still running is flagged once a week", async () => {
  const { s, ids } = account();
  s.insertComponentWear(ids[1], at("2026-08-06T01:00:00Z"), [{ component: "side brush", lifeSpanHours: 500, usedLifeHours: 540, remainingPct: 0 }]);
  const { j, sent } = job({ s });
  await j.tick(AUG6_6AM + 90 * MIN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Picker 2: side brush is past its rated life");
});

test("duty time collapsing for seven days is flagged, but a quiet feed is not", async () => {
  const { s } = account({ idleDays: 8 });
  const { j, sent } = job({ s });
  await j.tick(AUG6_6AM + 90 * MIN);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Picker 2 has run under 2\.4 h a day all week$/);
  // The same fleet with its feed a week old says nothing about duty.
  const stale = account({ idleDays: 8 });
  const q = job({ s: stale.s });
  await q.j.tick(AUG6_6AM + 90 * MIN + 7 * DAY);
  assert.ok(!q.sent.some((m) => /under .* a day all week/.test(m.subject)));
});

test("a vendor sync down for half an hour is one email until it recovers", async () => {
  const { s } = account();
  const control = openControl(":memory:");
  const { j, sent, acct } = job({ s, control });
  control.upsertConnection({ accountId: acct.id, vendor: "gausium", secretSealed: "x" }, AUG6_6AM - 2 * 3_600_000);
  const conn = control.connection(acct.id, "gausium");
  control.recordSync(conn.id, { at: AUG6_6AM - 3_600_000, state: "ok" });
  control.recordSync(conn.id, { at: AUG6_6AM - 40 * MIN, state: "down", detail: "401 bad key" });
  await j.tick(AUG6_6AM);
  await j.tick(AUG6_6AM + MIN);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^gausium has not synced since/);
  assert.match(sent[0].text, /401 bad key/);
  control.recordSync(conn.id, { at: AUG6_6AM + 2 * MIN, state: "ok" });
  await j.tick(AUG6_6AM + 3 * MIN);
  control.recordSync(conn.id, { at: AUG6_6AM + 4 * MIN, state: "down", detail: "timeout" });
  await j.tick(AUG6_6AM + 40 * MIN);
  assert.equal(sent.length, 2, "down again after recovering is news again");
});

test("with sending off it only logs, and a stopped account gets nothing", async () => {
  const { s } = account();
  s.insertComponentWear(1, at("2026-08-06T01:00:00Z"), [{ component: "drive wheel", lifeSpanHours: 1000, usedLifeHours: 900, remainingPct: 10 }]);
  const off = job({ s, send: false });
  await off.j.tick(AUG6_6AM + 90 * MIN);
  assert.equal(off.sent.length, 0);
  assert.ok(off.logs.some((l) => /not sent, BOTLIEN_ALERTS_SEND is off/.test(l)));
  assert.equal(liveTables(fleetContract(s, AUG6_6AM)).ALERT_LOG[RULE.low], undefined, "an unsent alert is not logged as sent");

  const other = account();
  other.s.setKV(KV_ALERTS_STOPPED, "1");
  other.s.insertComponentWear(1, at("2026-08-06T01:00:00Z"), [{ component: "drive wheel", lifeSpanHours: 1000, usedLifeHours: 900, remainingPct: 10 }]);
  const stopped = job({ s: other.s });
  await stopped.j.tick(AUG6_6AM + 90 * MIN);
  assert.equal(stopped.sent.length, 0);
});
