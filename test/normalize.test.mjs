import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBearStatus, validateStatus, toEpochMs } from "../src/normalize.mjs";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bear-status.json"), "utf8")
);

test("healthy Bear status maps to exact BotStatus", () => {
  const s = normalizeBearStatus(fixtures.healthy);
  assert.equal(s.externalId, "pennybot-abc123");
  assert.equal(s.at, Date.parse("2026-08-04T10:15:00Z"));
  assert.equal(s.seq, 4211);
  assert.equal(s.connectionState, "online");
  assert.equal(s.batteryPct, 82.5);
  assert.equal(s.charging, false);
  assert.equal(s.eStop, false);
  assert.equal(s.missionState, "active");
  assert.equal(s.missionId, "m-889");
  assert.equal(s.stuck, false);
  assert.equal(s.moving, true);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.pose, { x: 12.4, y: 3.1, theta: 1.57 });
  assert.deepEqual(validateStatus(s), []);
});

test("troubled Bear status: proto-style timestamp, estop, critical errors, stuck, not moving", () => {
  const s = normalizeBearStatus(fixtures.troubled);
  assert.equal(s.at, 1785842100500);
  assert.equal(s.connectionState, "offline");
  assert.equal(s.charging, true);
  assert.equal(s.eStop, true);
  assert.equal(s.missionState, "failed");
  assert.equal(s.stuck, true);
  assert.equal(s.moving, false);
  assert.deepEqual(s.errors, [
    { code: "bear:E210", severity: "CRITICAL" },
    { code: "bear:E105", severity: "WARNING" },
  ]);
  assert.deepEqual(validateStatus(s), []);
});

test("sparse status: unknowns stay null, never guessed", () => {
  const s = normalizeBearStatus(fixtures.sparse);
  assert.equal(s.connectionState, null);
  assert.equal(s.batteryPct, null);
  assert.equal(s.charging, null);
  assert.equal(s.eStop, null);
  assert.equal(s.missionState, null);
  assert.equal(s.stuck, null);
  assert.equal(s.moving, null);
  assert.equal(s.errors, null);
  assert.equal(s.pose, null);
});

test("validateStatus catches bad input", () => {
  assert.deepEqual(validateStatus(null), ["status is not an object"]);
  const bad = { externalId: null, at: 0, batteryPct: 140, connectionState: "weird" };
  const problems = validateStatus(bad);
  assert.ok(problems.some((p) => p.includes("externalId")));
  assert.ok(problems.some((p) => p.includes("at")));
  assert.ok(problems.some((p) => p.includes("battery")));
  assert.ok(problems.some((p) => p.includes("connectionState")));
});

test("toEpochMs handles ISO, proto, seconds, and ms", () => {
  assert.equal(toEpochMs("2026-08-04T00:00:00Z"), 1785801600000);
  assert.equal(toEpochMs({ seconds: 1785801600, nanos: 250000000 }), 1785801600250);
  assert.equal(toEpochMs(1785801600), 1785801600000);
  assert.equal(toEpochMs(1785801600000), 1785801600000);
  assert.equal(toEpochMs("not a date"), null);
  assert.equal(toEpochMs(null), null);
});
