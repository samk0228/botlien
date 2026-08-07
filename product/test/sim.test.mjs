import { test } from "node:test";
import assert from "node:assert/strict";
import { createSimConnector, mulberry32 } from "../src/connectors/sim.mjs";
import demoFleet from "../src/scenarios/demo-fleet.mjs";

const START = Date.parse("2026-08-04T08:00:00-07:00");
const MIN = 60_000;
const DAY = 86_400_000;

async function runTicks(connector, tickTimes) {
  await connector.init();
  const out = [];
  for (const t of tickTimes) out.push(await connector.tick(t));
  return out;
}

test("same seed + same tick times → identical streams", async () => {
  const times = [START, START + 5 * MIN, START + 17 * MIN, START + 30 * MIN];
  const a = await runTicks(createSimConnector(demoFleet), times);
  const b = await runTicks(createSimConnector(demoFleet), times);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(a.flatMap((r) => r.events).length > 0);
});

test("different tick partitioning → same per-robot streams (absolute steps)", async () => {
  const fine = await runTicks(createSimConnector(demoFleet), [START, START + 10 * MIN, START + 20 * MIN, START + 40 * MIN]);
  const coarse = await runTicks(createSimConnector(demoFleet), [START, START + 40 * MIN]);
  const byRobot = (rs) => {
    const m = new Map();
    for (const e of rs.flatMap((r) => r.events)) {
      if (!m.has(e.externalId)) m.set(e.externalId, []);
      m.get(e.externalId).push(JSON.stringify(e.status));
    }
    return m;
  };
  const a = byRobot(fine);
  const b = byRobot(coarse);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const key of a.keys()) assert.deepEqual(a.get(key), b.get(key), `stream mismatch for ${key}`);
});

test("scripted outage: heartbeat down, in-window steps never emitted", async () => {
  const c = createSimConnector(demoFleet); // outage min 45-57
  await c.init();
  await c.tick(START);
  const before = await c.tick(START + 44 * MIN);
  assert.equal(before.heartbeat.state, "ok");
  const during = await c.tick(START + 50 * MIN);
  assert.equal(during.heartbeat.state, "down");
  assert.equal(during.detail, undefined);
  const after = await c.tick(START + 120 * MIN);
  assert.equal(after.heartbeat.state, "ok");
  const allAts = after.events.map((e) => e.at);
  const outageStart = START + 45 * MIN;
  const outageEnd = START + 57 * MIN;
  assert.ok(allAts.length > 0);
  assert.ok(allAts.every((at) => at < outageStart || at >= outageEnd), "no statuses inside the outage window");
});

test("declining_utilization profile: day 3 activity well below day 1", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START); // anchors the sim clock
  const rest = await c.tick(START + 3 * DAY);
  const byRobot = [...first.events, ...rest.events].filter((e) => e.externalId === "sim-002");
  const day1 = byRobot.filter((e) => e.at < START + DAY);
  const day3 = byRobot.filter((e) => e.at >= START + 2 * DAY);
  const activeRatio = (list) => list.filter((e) => e.status.missionState === "active").length / list.length;
  assert.ok(activeRatio(day1) > 0.3, `day1 active ratio ${activeRatio(day1)}`);
  assert.ok(activeRatio(day3) < 0.15, `day3 active ratio ${activeRatio(day3)}`);
});

test("battery_degradation profile: daily max battery fades", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START); // anchors the sim clock
  const rest = await c.tick(START + 4 * DAY);
  const byRobot = [...first.events, ...rest.events].filter((e) => e.externalId === "sim-005");
  const dayMax = (d) =>
    Math.max(...byRobot.filter((e) => e.at >= START + d * DAY && e.at < START + (d + 1) * DAY).map((e) => e.status.batteryPct));
  assert.ok(dayMax(3) < dayMax(0) - 5, `day0 max ${dayMax(0)} vs day3 max ${dayMax(3)}`);
});

test("stuck_loop profile emits stuck episodes; recurring_faults emits errors incl critical", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START); // anchors the sim clock
  const rest = await c.tick(START + DAY);
  const events = [...first.events, ...rest.events];
  const stuckCount = events.filter((e) => e.externalId === "sim-004" && e.status.stuck).length;
  assert.ok(stuckCount > 10, `stuck steps: ${stuckCount}`);
  const errs = events.filter((e) => e.externalId === "sim-003").flatMap((e) => e.status.errors);
  assert.ok(errs.length > 20, `errors: ${errs.length}`);
  assert.ok(errs.some((e) => e.severity === "CRITICAL"));
});

test("mulberry32 is deterministic", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});
