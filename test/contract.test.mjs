import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStore, migrate, MIGRATIONS } from "../src/store.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { billingPeriods, downtimeEpisodes, fleetContract, closePeriods, dateKey, KV_BILLING_DAY, CLOSE_GRACE_MS } from "../src/contract.mjs";
import { requiresSession } from "../src/gate.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);

// ---- migrations ----

test("migrations bring a fresh store to the latest version", () => {
  const s = openStore(":memory:");
  assert.equal(Number(s.db.prepare("PRAGMA user_version").get().user_version), MIGRATIONS.length);
  assert.deepEqual(s.listSites(), []);
});

test("migrate is idempotent: a second run changes nothing and does not throw", () => {
  const s = openStore(":memory:");
  assert.equal(migrate(s.db), MIGRATIONS.length);
  assert.equal(Number(s.db.prepare("PRAGMA user_version").get().user_version), MIGRATIONS.length);
});

test("an old database without site_id gains the column and keeps its robots", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE robots (id INTEGER PRIMARY KEY AUTOINCREMENT, robot_key TEXT NOT NULL UNIQUE,
    connector TEXT NOT NULL, external_id TEXT NOT NULL, display_name TEXT, brand TEXT, model TEXT,
    category TEXT NOT NULL DEFAULT 'delivery', fleet_id INTEGER, first_seen_at INTEGER, last_seen_at INTEGER)`);
  db.exec(`INSERT INTO robots (robot_key, connector, external_id) VALUES ('x:1','x','1')`);
  migrate(db);
  const row = db.prepare("SELECT robot_key, site_id FROM robots").get();
  assert.equal(row.robot_key, "x:1");
  assert.equal(row.site_id, null);
});

// ---- billing periods ----

test("a period runs from the anchor day to the day before the next one", () => {
  const [open, prev] = billingPeriods(at("2026-09-02T20:00:00Z"), { anchorDay: 4, tz: TZ });
  assert.equal(open.start, "2026-08-04");
  assert.equal(open.end, "2026-09-03");
  assert.equal(open.status, "open");
  assert.equal(open.label, "Aug 4 to Sep 3, 2026");
  assert.equal(prev.start, "2026-07-04");
  assert.equal(prev.end, "2026-08-03");
  assert.equal(prev.status, "closed");
});

test("on the anchor day itself the new period is already open", () => {
  const [open] = billingPeriods(at("2026-09-04T19:00:00Z"), { anchorDay: 4, tz: TZ });
  assert.equal(open.start, "2026-09-04");
});

test("period edges are local midnight, not UTC midnight", () => {
  const [open] = billingPeriods(at("2026-08-20T12:00:00Z"), { anchorDay: 4, tz: TZ });
  assert.equal(dateKey(open.fromMs, TZ), "2026-08-04");
  assert.equal(dateKey(open.fromMs - 1, TZ), "2026-08-03");
});

// ---- downtime episodes ----

const snap = (iso, o = {}) => ({ at: at(iso), stuck: 0, e_stop: 0, errors: null, pose_x: 1, pose_y: 2, ...o });

test("consecutive stuck samples are one episode, a long gap starts another", () => {
  const eps = downtimeEpisodes(
    [
      snap("2026-08-05T21:05:00Z", { stuck: 1 }),
      snap("2026-08-05T21:06:00Z", { stuck: 1 }),
      snap("2026-08-05T21:07:00Z", { stuck: 1 }),
      snap("2026-08-05T22:30:00Z", { stuck: 1 }),
    ],
    { tz: TZ, sampleMs: MIN }
  );
  assert.equal(eps.length, 2);
  assert.equal(eps[0].minutes, 3);
  assert.equal(eps[0].date, "2026-08-05");
  assert.equal(eps[0].start, "14:05");
  assert.deepEqual(eps[0].pose, { x: 1, y: 2 });
});

test("a warning is not downtime; an error is, and it names its code", () => {
  const eps = downtimeEpisodes(
    [
      snap("2026-08-11T17:00:00Z", { errors: JSON.stringify([{ code: "gausium:W1", severity: "WARNING" }]) }),
      snap("2026-08-11T17:20:00Z", { errors: JSON.stringify([{ code: "locus:E-217", severity: "ERROR" }]) }),
    ],
    { tz: TZ }
  );
  assert.equal(eps.length, 1);
  assert.equal(eps[0].cause, "error locus:E-217");
});

test("an e-stop outranks stuck on the same sample", () => {
  const [ep] = downtimeEpisodes([snap("2026-08-14T18:20:00Z", { stuck: 1, e_stop: 1 })], { tz: TZ });
  assert.equal(ep.kind, "e-stop");
});

// ---- the whole contract ----

function seededStore() {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  const id = s.upsertRobot({ connector: "import", externalId: "p2", displayName: "Picker 2 (Zone B)", brand: "Locus", model: "LocusBot", category: "picking" }, at("2026-08-04T12:00:00Z"));
  const site = s.upsertSite("Pier 4", at("2026-08-04T12:00:00Z"));
  s.setRobotSite(id, site);
  // A day of work: a mission every 10 minutes, then a stuck stretch.
  const t0 = at("2026-08-05T15:00:00Z");
  for (let i = 0; i < 48; i++) {
    const t = t0 + i * 10 * MIN;
    const stuck = i >= 30 && i < 33;
    s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: "active", missionId: `m${i}`, moving: !stuck, stuck, pose: { x: 3, y: 4 } });
  }
  rebuildRollupsForRobot(s, id);
  s.upsertRobotContract(id, { startDate: "2025-07-01", termMonths: 36, paybackMonths: 14, uptimePct: 95 }, at("2026-08-05T00:00:00Z"));
  s.insertTicket({ ref: "T-1041", brand: "Locus", robotId: id, title: "Repeat stalls at aisle 14", openedAt: at("2026-08-15T23:10:00Z") });
  return { s, id };
}

test("the contract carries the customer's site, robot, units, downtime, contract and ticket", () => {
  const { s, id } = seededStore();
  const c = fleetContract(s, at("2026-09-01T00:00:00Z"));
  assert.equal(c.version, 1);
  assert.deepEqual(c.sites.map((x) => x.name), ["Pier 4"]);
  assert.equal(c.periods[0].start, "2026-08-04");
  assert.equal(c.periods[0].status, "open");

  const r = c.robots.find((x) => x.id === id);
  assert.equal(r.name, "Picker 2 (Zone B)");
  assert.equal(r.siteId, c.sites[0].id);
  assert.equal(r.brand, "Locus");
  assert.equal(r.work, "Order picking");
  assert.ok(r.units > 0, "units come from the rollups");

  assert.equal(c.daily.filter((d) => d.robotId === id).length, 1);
  assert.equal(c.daily[0].date, "2026-08-05");

  const stuck = c.downtime.filter((d) => d.kind === "stuck");
  // Three stuck samples ten minutes apart, from a robot that reports every
  // ten minutes, are one stall, not three.
  assert.equal(stuck.length, 1);
  assert.ok(stuck[0].minutes >= 20);
  assert.deepEqual(c.contracts[0], { robotId: id, startDate: "2025-07-01", termMonths: 36, paybackMonths: 14, uptimePct: 95, equipCostCents: null });
  assert.equal(c.tickets[0].ref, "T-1041");
  assert.equal(c.provenance.contracts, "owner");
  assert.equal(c.provenance.tickets, "owner");
});

test("an empty account gets empty tables marked missing, never zeros", () => {
  const s = openStore(":memory:");
  const c = fleetContract(s, at("2026-09-01T00:00:00Z"));
  assert.equal(c.hasTelemetry, false);
  assert.deepEqual(c.robots, []);
  assert.deepEqual(c.downtime, []);
  assert.equal(c.provenance.robots, "missing");
  assert.equal(c.provenance.contracts, "missing");
});

test("a period with no telemetry has no coverage rather than zero coverage", () => {
  const { s } = seededStore();
  const c = fleetContract(s, at("2026-09-01T00:00:00Z"));
  const closed = c.periods[1];
  assert.equal(closed.status, "closed");
  assert.equal(Object.values(closed.siteCoverage)[0], null);
  assert.equal(c.robots[0].coverageDelta, null);
});

test("excluded robots leave the contract", () => {
  const { s, id } = seededStore();
  s.excludeRobot(id, at("2026-08-20T00:00:00Z"));
  const c = fleetContract(s, at("2026-09-01T00:00:00Z"));
  assert.equal(c.robots.length, 0);
});

test("the contract API sits behind a session", () => {
  assert.equal(requiresSession("/api/v1/fleet"), true);
});

// ---- closing periods ----

/** One picker with a day of work in July (with a stall) and one in August,
 *  a $1,000 lease, 12 scheduled hours a day. */
function twoPeriodStore({ lease = true, days = ["2026-07-10T15:00:00Z", "2026-08-05T15:00:00Z"] } = {}) {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  const id = s.upsertRobot({ connector: "import", externalId: "p1", displayName: "Picker 1", brand: "Locus", model: "LocusBot", category: "picking" }, at("2026-07-01T12:00:00Z"));
  s.setRobotSite(id, s.upsertSite("Pier 4", at("2026-07-01T12:00:00Z")));
  for (const day of days) {
    const t0 = at(day);
    for (let i = 0; i < 48; i++) {
      const t = t0 + i * 10 * MIN;
      const stuck = day.startsWith("2026-07") && i >= 20 && i < 30;
      s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: "active", missionId: `${day}-${i}`, moving: !stuck, stuck, pose: { x: 3, y: 4 } });
    }
  }
  rebuildRollupsForRobot(s, id);
  s.upsertRobotEconomics(id, { taskType: "picking", taskBasis: "mission", rateCents: 40, invoiceCentsMonth: 100_000, wageCentsHour: null, operatingHoursDay: 12 }, at("2026-07-01T12:00:00Z"));
  if (lease) s.upsertRobotContract(id, { startDate: "2026-07-04", termMonths: 36, paybackMonths: 14, uptimePct: 99.9 }, at("2026-07-01T12:00:00Z"));
  return { s, id };
}
const AUG_6 = at("2026-08-06T18:00:00Z");

test("an ended period closes once its data has moved past it, and only once", () => {
  const { s } = twoPeriodStore();
  assert.deepEqual(closePeriods(s, AUG_6), ["2026-07-04"]);
  assert.deepEqual(closePeriods(s, AUG_6 + 3_600_000), []);
  const c = fleetContract(s, AUG_6);
  assert.equal(c.periods[0].frozen, false);
  assert.equal(c.periods[1].frozen, true);
  assert.equal(c.periods[1].status, "closed");
  assert.equal(c.periods[1].closedAt, AUG_6);
});

test("a closed period keeps its figures when the invoice changes afterwards", () => {
  const { s, id } = twoPeriodStore();
  closePeriods(s, AUG_6);
  const before = fleetContract(s, AUG_6);
  s.upsertRobotEconomics(id, { taskType: "picking", taskBasis: "mission", rateCents: 40, invoiceCentsMonth: 200_000, wageCentsHour: null, operatingHoursDay: 12 }, AUG_6);
  const after = fleetContract(s, AUG_6);
  const cov = (c, i) => Object.values(c.periods[i].siteCoverage)[0];
  assert.equal(cov(after, 1), cov(before, 1), "July as it closed");
  assert.deepEqual(after.periods[1].robots, before.periods[1].robots);
  assert.ok(cov(after, 0) < cov(before, 0), "the open period moves with the new invoice");
  // Last period's delta is against July as it closed.
  assert.equal(after.robots[0].coverageDelta, after.robots[0].coverage - before.periods[1].robots[0].coverage);
});

test("a period does not close inside the grace day or before newer data arrives", () => {
  // Data only in July: July is still the open period, whatever the date.
  assert.deepEqual(closePeriods(twoPeriodStore({ days: ["2026-07-10T15:00:00Z"] }).s, at("2026-09-20T00:00:00Z")), []);
  // August data exists, but it is not yet a day past July's end (Aug 4, local midnight).
  const { s } = twoPeriodStore({ days: ["2026-07-10T15:00:00Z", "2026-08-04T08:00:00Z"] });
  const julyEnd = fleetContract(s, at("2026-08-04T12:00:00Z")).periods[1].endsAtMs;
  assert.deepEqual(closePeriods(s, julyEnd + CLOSE_GRACE_MS - 1), []);
  assert.deepEqual(closePeriods(s, julyEnd + CLOSE_GRACE_MS), ["2026-07-04"]);
});

test("each period carries uptime and credit, and credit needs a stated promise", () => {
  const { s } = twoPeriodStore();
  const july = fleetContract(s, AUG_6).periods[1];
  const r = july.robots[0];
  assert.equal(r.incidents, 1);
  assert.ok(r.downtimeMinutes >= 90, `the July stall is counted (${r.downtimeMinutes} min)`);
  assert.equal(r.promisedUptimePct, 99.9);
  assert.ok(r.deliveredUptimePct < 99.9);
  assert.ok(r.creditCents > 0);
  assert.equal(july.totals.creditCents, r.creditCents);

  const noLease = fleetContract(twoPeriodStore({ lease: false }).s, AUG_6).periods[1];
  assert.equal(noLease.robots[0].creditCents, null);
  assert.equal(noLease.totals.creditCents, null, "no promise, no credit total, not zero");
});
