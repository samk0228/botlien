import { test } from "node:test";
import assert from "node:assert/strict";
import { periodStats, decomposeWork, decomposeCoverage, varianceSentence } from "../src/variance.mjs";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T00:00:00Z");

const econ = (over = {}) => ({
  taskBasis: "mission",
  rateCents: 100,
  invoiceCentsMonth: 90_000, // $900/mo -> $30/day
  ...over,
});

/** `hours` buckets of one hour each, `missions` runs in every one. */
function rollups(startMs, hours, { missions = 10, online = HOUR, active = 0.5 * HOUR } = {}) {
  return Array.from({ length: hours }, (_, i) => ({
    bucket_start_at: startMs + i * HOUR,
    bucket_ms: HOUR,
    sample_count: 60,
    online_ms: online,
    active_ms: active,
    mission_count: missions,
    error_count: 0,
    stuck_episodes: 0,
  }));
}

test("periodStats reports intensity as unknown, never zero, for a robot that was never up", () => {
  const dark = periodStats([], econ(), { fromMs: T0, toMs: T0 + 10 * DAY });
  assert.equal(dark.onlineHours, 0);
  assert.equal(dark.intensity, null, "a robot that was not there did not work slowly");
  assert.equal(dark.tasks, 0);
  assert.equal(dark.coverage, 0, "no work against a real invoice is genuinely zero coverage");

  const up = periodStats(rollups(T0, 240, { missions: 10 }), econ(), { fromMs: T0, toMs: T0 + 10 * DAY });
  assert.equal(up.onlineHours, 240);
  assert.equal(up.tasks, 2400);
  assert.equal(up.intensity, 10);
  assert.equal(up.workCents, 240_000);
});

test("decomposeWork splits the change with no residual", () => {
  const prior = periodStats(rollups(T0, 240, { missions: 10 }), econ(), { fromMs: T0, toMs: T0 + 10 * DAY });
  // Half the hours online, and slower while up.
  const current = periodStats(rollups(T0 + 10 * DAY, 120, { missions: 6 }), econ(), {
    fromMs: T0 + 10 * DAY,
    toMs: T0 + 20 * DAY,
  });
  const d = decomposeWork(prior, current);
  assert.ok(d.exact, "availability + intensity + rate must equal the whole move");
  assert.equal(d.availabilityCents + d.intensityCents + d.rateCents, d.totalCents);
  assert.ok(d.availabilityCents < 0 && d.intensityCents < 0);
  // Rate is stored as one current row per robot, so there is never a prior rate
  // to differ from and this term is structurally zero. Asserted so that the day
  // rate history lands, this test fails and says why.
  assert.equal(d.rateCents, 0);
});

test("an outage lands entirely in availability, not intensity", () => {
  const prior = periodStats(rollups(T0, 240, { missions: 10 }), econ(), { fromMs: T0, toMs: T0 + 10 * DAY });
  // Same work rate per hour it was up, just up for far fewer hours.
  const current = periodStats(rollups(T0 + 10 * DAY, 120, { missions: 10 }), econ(), {
    fromMs: T0 + 10 * DAY,
    toMs: T0 + 20 * DAY,
  });
  const d = decomposeWork(prior, current);
  assert.equal(d.intensityCents, 0, "it worked exactly as hard while it was up");
  assert.equal(d.availabilityCents, d.totalCents);
});

test("decomposeCoverage attributes the whole coverage move", () => {
  const win = { fromMs: T0, toMs: T0 + 10 * DAY };
  const next = { fromMs: T0 + 10 * DAY, toMs: T0 + 20 * DAY };
  const perRobot = [
    {
      robot: { id: 1, name: "Servi 1" },
      priorStats: periodStats(rollups(T0, 240, { missions: 10 }), econ(), win),
      currentStats: periodStats(rollups(next.fromMs, 100, { missions: 10 }), econ(), next),
    },
    {
      robot: { id: 2, name: "Servi 2" },
      priorStats: periodStats(rollups(T0, 240, { missions: 10 }), econ(), win),
      currentStats: periodStats(rollups(next.fromMs, 240, { missions: 6 }), econ(), next),
    },
  ];
  const v = decomposeCoverage(perRobot, { periodDays: 10 });
  assert.ok(v, "two robots with 240 prior hours each is plenty of history");
  assert.ok(v.exact, `effects must sum to the total: ${v.attributedChange} vs ${v.totalChange}`);
  assert.ok(v.currentCoverage < v.priorCoverage);
  assert.equal(v.direction, "down");

  // Servi 1 lost hours, Servi 2 lost pace. Each must be attributed to its own
  // cause, which is the whole point of the panel for a lender reading it as
  // asset condition versus borrower demand.
  const one = v.contributors.find((c) => c.name === "Servi 1");
  const two = v.contributors.find((c) => c.name === "Servi 2");
  assert.equal(one.driver, "availability");
  assert.equal(two.driver, "intensity");
});

test("decomposeCoverage refuses to speak without enough prior history", () => {
  const win = { fromMs: T0, toMs: T0 + DAY };
  const next = { fromMs: T0 + DAY, toMs: T0 + 2 * DAY };
  const thin = [
    {
      robot: { id: 1, name: "Servi 1" },
      priorStats: periodStats(rollups(T0, 10), econ(), win), // 10 online hours
      currentStats: periodStats(rollups(next.fromMs, 10), econ(), next),
    },
  ];
  assert.equal(decomposeCoverage(thin, {}), null);
  assert.equal(decomposeCoverage([], {}), null);

  // No invoice means there was never a coverage ratio to move.
  const noInvoice = [
    {
      robot: { id: 1, name: "Servi 1" },
      priorStats: periodStats(rollups(T0, 240), econ({ invoiceCentsMonth: null }), win),
      currentStats: periodStats(rollups(next.fromMs, 240), econ({ invoiceCentsMonth: null }), next),
    },
  ];
  assert.equal(decomposeCoverage(noInvoice, {}), null);
});

test("varianceSentence names the biggest driver in plain words", () => {
  const win = { fromMs: T0, toMs: T0 + 10 * DAY };
  const next = { fromMs: T0 + 10 * DAY, toMs: T0 + 20 * DAY };
  const v = decomposeCoverage(
    [
      {
        robot: { id: 1, name: "Servi 1" },
        priorStats: periodStats(rollups(T0, 240, { missions: 10 }), econ(), win),
        currentStats: periodStats(rollups(next.fromMs, 60, { missions: 10 }), econ(), next),
      },
    ],
    { periodDays: 10 }
  );
  const s = varianceSentence(v);
  assert.match(s, /coverage fell/);
  assert.match(s, /hours the robots were online/);
  assert.match(s, /10 days/);
  assert.doesNotMatch(s, /variance/i, "no accounting vocabulary in the owner-facing sentence");
  assert.equal(varianceSentence(null), null);
});
