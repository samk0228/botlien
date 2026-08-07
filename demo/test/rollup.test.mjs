import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRollups } from "../src/rollup.mjs";

const T0 = Date.parse("2026-08-04T10:00:00Z"); // exactly on an hour boundary
const MIN = 60_000;
const HOUR = 3_600_000;

const snap = (o) => ({
  at: T0,
  connection_state: "online",
  mission_state: "idle",
  stuck: 0,
  errors: null,
  battery_pct: 80,
  ...o,
});

test("online/active integration over 1-minute cadence", () => {
  const snapshots = [];
  for (let m = 0; m < 60; m++) {
    snapshots.push(snap({ at: T0 + m * MIN, mission_state: m < 30 ? "active" : "idle" }));
  }
  const [b] = computeRollups(snapshots, HOUR);
  assert.equal(b.bucketStartAt, T0);
  assert.equal(b.sampleCount, 60);
  assert.equal(b.onlineMs, 59 * MIN); // last snapshot has no successor
  assert.equal(b.activeMs, 30 * MIN);
  assert.equal(b.missionCount, 1);
});

test("gaps beyond maxGapMs earn no online time", () => {
  const snapshots = [
    snap({ at: T0 }),
    snap({ at: T0 + 1 * MIN }),
    snap({ at: T0 + 21 * MIN }), // 20-minute gap: capped at maxGap (5 min)
    snap({ at: T0 + 22 * MIN }),
  ];
  const [b] = computeRollups(snapshots, HOUR);
  assert.equal(b.onlineMs, 1 * MIN + 5 * MIN + 1 * MIN);
});

test("stuck episodes and error counts", () => {
  const snapshots = [
    snap({ at: T0 }),
    snap({ at: T0 + 1 * MIN, stuck: 1 }),
    snap({ at: T0 + 2 * MIN, stuck: 1 }),
    snap({ at: T0 + 3 * MIN, stuck: 0 }),
    snap({ at: T0 + 4 * MIN, stuck: 1, errors: JSON.stringify([{ code: "sim:E1", severity: "WARNING" }, { code: "sim:E2", severity: "CRITICAL" }]) }),
    snap({ at: T0 + 5 * MIN, stuck: 0 }),
  ];
  const [b] = computeRollups(snapshots, HOUR);
  assert.equal(b.stuckEpisodes, 2);
  assert.equal(b.errorCount, 2);
});

test("bucket boundaries split correctly and battery min/max track", () => {
  const snapshots = [
    snap({ at: T0 + 59 * MIN, battery_pct: 70 }),
    snap({ at: T0 + 60 * MIN, battery_pct: 65 }),
    snap({ at: T0 + 61 * MIN, battery_pct: 90 }),
  ];
  const rollups = computeRollups(snapshots, HOUR);
  assert.equal(rollups.length, 2);
  assert.equal(rollups[0].bucketStartAt, T0);
  assert.equal(rollups[1].bucketStartAt, T0 + HOUR);
  assert.equal(rollups[0].batteryMinPct, 70);
  assert.equal(rollups[1].batteryMinPct, 65);
  assert.equal(rollups[1].batteryMaxPct, 90);
  // snapshot at :59 credits at most 1 minute into its own bucket
  assert.equal(rollups[0].onlineMs, 1 * MIN);
});

test("empty input → empty output", () => {
  assert.deepEqual(computeRollups([], HOUR), []);
});
