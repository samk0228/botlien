import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  // Measured INSIDE the service window. The fleet no longer runs around the
  // clock, so a whole-day ratio is mostly a count of the hours the restaurant
  // is shut, and it moves whenever the opening hours do. Comparing peak-hour
  // duty keeps this testing the thing it is named after: the profile declines.
  const inService = (e) => {
    const h = new Date(e.at).getHours();
    return h >= demoFleet.service.openHour && h < demoFleet.service.closeHour;
  };
  const activeRatio = (list) => {
    const open = list.filter(inService);
    return open.filter((e) => e.status.missionState === "active").length / open.length;
  };
  assert.ok(activeRatio(day1) > 0.3, `day1 active ratio ${activeRatio(day1)}`);
  assert.ok(activeRatio(day3) < 0.15, `day3 active ratio ${activeRatio(day3)}`);
});

test("service window and demand curve shape the day", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START);
  const rest = await c.tick(START + 2 * DAY);
  const servi = [...first.events, ...rest.events].filter((e) => e.externalId === "sim-001");

  const atHour = (h) => servi.filter((e) => new Date(e.at).getHours() === h);
  const activeShare = (list) => list.filter((e) => e.status.missionState === "active").length / (list.length || 1);

  // Dark at 4am: nothing running, ever.
  assert.equal(activeShare(atHour(4)), 0, "robots must not invent picks while the floor is dark");
  // The morning wave beats the shift change, the warehouse equivalent of the
  // dead middle of the afternoon.
  assert.ok(activeShare(atHour(9)) > activeShare(atHour(14)) + 0.15, "the 9am wave should outwork the 2pm shift change");

  // A healthy mobile picker should land near a believable day of work. The band
  // is wide because pace is a scenario knob, but it excludes both the ~400 runs
  // the uncalibrated simulator produced for a tray robot and the four-figure
  // counts an unthrottled picker would report.
  const day = servi.filter((e) => e.at >= START + DAY && e.at < START + 2 * DAY);
  const runs = new Set(day.map((e) => e.status.missionId).filter(Boolean)).size;
  assert.ok(runs > 150 && runs < 600, `a day's picks should be plausible for one picker, got ${runs}`);
});

test("demo cleaners keep enough duty for the wear rules to fire", async () => {
  // COUPLING, MADE EXECUTABLE. The consumable and deferred-maintenance rules
  // only speak about a machine that is actually being worked: deferred_maintenance
  // will not fire below rules.deferred_maintenance.min_active_ms_24h, and the
  // wear model in simWear() accumulates against active time. So the demo's
  // cleaning duty cycle silently controls whether the asset-condition story
  // appears on the risk board at all.
  //
  // That coupling is invisible from either side. Recalibrating cleaner duty
  // downward would take the PD-side wear story off the demo with every test
  // still green, which is exactly how a demo quietly stops demonstrating the
  // thing it exists to demonstrate. This test is the tripwire: if it fails,
  // either restore the duty or retune headStart in simWear() to match.
  const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  const minActiveMsDay = config.rules.deferred_maintenance.min_active_ms_24h;

  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START);
  const rest = await c.tick(START + 6 * DAY);
  const events = [...first.events, ...rest.events];

  const cleaners = demoFleet.robots.filter((r) => r.category === "cleaning");
  assert.ok(cleaners.length > 0, "the demo fleet needs a cleaner for the wear story");

  for (const r of cleaners) {
    const mine = events.filter((e) => e.externalId === r.externalId);
    // One sample a minute, so one active sample is one active minute.
    const activeMsPerDay = (mine.filter((e) => e.status.missionState === "active").length / 6) * 60_000;
    assert.ok(
      activeMsPerDay >= minActiveMsDay * 2,
      `${r.displayName} logs ${Math.round(activeMsPerDay / 60_000)} active min/day against a ` +
        `${minActiveMsDay / 60_000} min/day rule floor; under 2x headroom the wear rules stop firing on the demo`
    );
  }
});

test("pose is reported, and stalls concentrate on one spot", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  const first = await c.tick(START);
  const rest = await c.tick(START + 2 * DAY);
  const scrubber = [...first.events, ...rest.events].filter((e) => e.externalId === "sim-006");
  assert.ok(scrubber.every((e) => e.status.pose !== null), "a scenario with a floor reports pose on every status");

  const stalls = scrubber.filter((e) => e.status.stuck);
  assert.ok(stalls.length > 10, `expected stalls, got ${stalls.length}`);
  const cell = (p) => `${Math.round(p.x / 2) * 2},${Math.round(p.y / 2) * 2}`;
  const tally = new Map();
  for (const s of stalls) tally.set(cell(s.status.pose), (tally.get(cell(s.status.pose)) ?? 0) + 1);
  const top = Math.max(...tally.values());
  assert.ok(top / stalls.length > 0.5, `stalls should cluster, top cell held ${top}/${stalls.length}`);
});

test("a per-robot outage goes dark without taking the pipe down", async () => {
  const c = createSimConnector(demoFleet);
  await c.init();
  await c.tick(START); // anchor
  const later = await c.tick(START + 17 * DAY);
  const outageStart = START + 15 * DAY;
  const outageEnd = outageStart + 72 * 3_600_000;
  const inWindow = (e) => e.at >= outageStart && e.at < outageEnd;

  const dark = later.events.filter((e) => e.externalId === "sim-001" && inWindow(e));
  assert.equal(dark.length, 0, "the robot under a scripted outage reports nothing");
  const siblings = later.events.filter((e) => e.externalId === "sim-002" && inWindow(e));
  assert.ok(siblings.length > 0, "its siblings keep reporting throughout");
  assert.equal(later.heartbeat.state, "ok", "one dead robot is not a dead connector");
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
  const stuckCount = events.filter((e) => e.externalId === "sim-006" && e.status.stuck).length;
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
