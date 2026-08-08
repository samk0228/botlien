import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";

const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const tempStore = () => openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "botlien.db"));

test("robot upsert is keyed and idempotent", () => {
  const s = tempStore();
  const a = s.upsertRobot({ connector: "sim", externalId: "r1", brand: "Bear", category: "delivery" }, NOW);
  const b = s.upsertRobot({ connector: "sim", externalId: "r1" }, NOW + 1000);
  assert.equal(a, b);
  const row = s.getRobotByKey("sim:r1");
  assert.equal(row.first_seen_at, NOW);
  assert.equal(row.last_seen_at, NOW + 1000);
  assert.equal(s.listRobots().length, 1);
});

test("raw events and snapshots round-trip with at vs received_at distinct", () => {
  const s = tempStore();
  const robotId = s.upsertRobot({ connector: "import", externalId: "hist-1" }, NOW);
  const rawId = s.insertRawEvent({
    connector: "import", robotKey: "import:hist-1", kind: "import", source: "import",
    at: NOW - 86_400_000, receivedAt: NOW, payload: JSON.stringify({ row: 1 }),
  });
  s.insertSnapshot({
    robotId, rawEventId: rawId, at: NOW - 86_400_000, receivedAt: NOW,
    connector: "import", source: "import", connectionState: "online", batteryPct: 87.5,
    charging: false, eStop: false, missionState: "active", stuck: false, moving: true,
    errors: [{ code: "bear:E42", severity: "ERROR" }], pose: { x: 1, y: 2, theta: 0.5 },
  });
  const snap = s.latestSnapshot(robotId);
  assert.equal(snap.at, NOW - 86_400_000);
  assert.equal(snap.received_at, NOW);
  assert.equal(snap.source, "import");
  assert.equal(snap.battery_pct, 87.5);
  assert.deepEqual(JSON.parse(snap.errors), [{ code: "bear:E42", severity: "ERROR" }]);
  assert.equal(s.snapshotsBetween(robotId, NOW - 2 * 86_400_000, NOW).length, 1);
});

test("second active flag with same scope+rule is rejected; cleared frees the slot", () => {
  const s = tempStore();
  s.raiseFlag({ scope: "robot:sim:r1", ruleId: "offline_duration", dimension: "pd", severity: "warn", raisedAt: NOW });
  assert.throws(() =>
    s.raiseFlag({ scope: "robot:sim:r1", ruleId: "offline_duration", dimension: "pd", severity: "crit", raisedAt: NOW + 1 })
  );
  const [flag] = s.activeFlags();
  s.clearFlag(flag.id, NOW + 1000);
  assert.equal(s.activeFlags().length, 0);
  // history retained
  assert.equal(s.allFlags().length, 1);
  // and a new raise now works
  s.raiseFlag({ scope: "robot:sim:r1", ruleId: "offline_duration", dimension: "pd", severity: "warn", raisedAt: NOW + 2000 });
  assert.equal(s.activeFlags().length, 1);
});

test("rollup upsert is idempotent per (robot, bucket)", () => {
  const s = tempStore();
  const robotId = s.upsertRobot({ connector: "sim", externalId: "r2" }, NOW);
  const base = { robotId, bucketStartAt: NOW, bucketMs: 3_600_000, sampleCount: 10, onlineMs: 100, activeMs: 50, missionCount: 2, errorCount: 0, stuckEpisodes: 0 };
  s.upsertRollup(base);
  s.upsertRollup({ ...base, onlineMs: 3_600_000, activeMs: 1_800_000 });
  const rows = s.rollupsBetween(robotId, NOW - 1, NOW + 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].online_ms, 3_600_000);
});

test("rollupsBetweenAll returns every robot's buckets in one read", () => {
  const s = tempStore();
  const a = s.upsertRobot({ connector: "sim", externalId: "ra" }, NOW);
  const b = s.upsertRobot({ connector: "sim", externalId: "rb" }, NOW);
  const base = { bucketMs: 3_600_000, sampleCount: 1, onlineMs: 0, activeMs: 0, missionCount: 1, errorCount: 0, stuckEpisodes: 0 };
  s.upsertRollup({ ...base, robotId: a, bucketStartAt: NOW });
  s.upsertRollup({ ...base, robotId: a, bucketStartAt: NOW + 3_600_000 });
  s.upsertRollup({ ...base, robotId: b, bucketStartAt: NOW });

  const all = s.rollupsBetweenAll(NOW - 1, NOW + 7_200_000);
  assert.equal(all.length, 3);
  assert.equal(all.filter((r) => r.robot_id === a).length, 2);
  assert.equal(all.filter((r) => r.robot_id === b).length, 1);

  // window still bounds the read
  assert.equal(s.rollupsBetweenAll(NOW - 1, NOW + 1).length, 2);
});

test("robot economics upsert is idempotent and absent means null", () => {
  const s = tempStore();
  const robotId = s.upsertRobot({ connector: "sim", externalId: "r-econ", category: "delivery" }, NOW);
  assert.equal(s.getRobotEconomics(robotId), null);

  const econ = {
    taskType: "tray_delivery",
    taskBasis: "mission",
    rateCents: 125,
    invoiceCentsMonth: 99_900,
    wageCentsHour: 2_000,
    operatingHoursDay: 12,
  };
  s.upsertRobotEconomics(robotId, econ, NOW);
  s.upsertRobotEconomics(robotId, { ...econ, rateCents: 200, invoiceCentsMonth: 50_000 }, NOW + 1000);

  assert.equal(s.listRobotEconomics().length, 1);
  const row = s.getRobotEconomics(robotId);
  assert.equal(row.rate_cents, 200);
  assert.equal(row.invoice_cents_month, 50_000);
  assert.equal(row.updated_at, NOW + 1000);
});

test("optional economics fields persist as null, not zero", () => {
  const s = tempStore();
  const robotId = s.upsertRobot({ connector: "sim", externalId: "r-sparse" }, NOW);
  s.upsertRobotEconomics(robotId, { taskType: "cleaning_hour", taskBasis: "active_hour", rateCents: 3_800 }, NOW);
  const row = s.getRobotEconomics(robotId);
  assert.equal(row.invoice_cents_month, null);
  assert.equal(row.wage_cents_hour, null);
  assert.equal(row.operating_hours_day, null);
});

test("robots can be assigned to a site so multi-site rollups drop in later", () => {
  const s = tempStore();
  const fleetId = s.insertFleet({ name: "Main site" }, NOW);
  const robotId = s.upsertRobot({ connector: "sim", externalId: "r-site" }, NOW);
  s.setRobotFleet(robotId, fleetId);
  assert.equal(s.listRobots()[0].fleet_id, fleetId);
  assert.equal(s.listFleets()[0].name, "Main site");
});

test("heartbeats, outcomes, kv", () => {
  const s = tempStore();
  s.insertHeartbeat({ connector: "sim", at: NOW, state: "ok" });
  s.insertHeartbeat({ connector: "sim", at: NOW + 60_000, state: "down", detail: "scripted outage" });
  assert.equal(s.latestHeartbeat("sim").state, "down");
  assert.equal(s.heartbeatsBetween("sim", NOW, NOW + 60_000).length, 2);

  const robotId = s.upsertRobot({ connector: "import", externalId: "hist-2" }, NOW);
  s.insertOutcome({ robotId, kind: "payment_missed", at: NOW - 5 * 86_400_000, amountCents: 149900, sourceFile: "outcomes.csv" }, NOW);
  assert.equal(s.listOutcomes()[0].kind, "payment_missed");

  s.setKV("cursor", "abc");
  s.setKV("cursor", "def");
  assert.equal(s.getKV("cursor"), "def");
  assert.equal(s.getKV("missing"), null);
});
