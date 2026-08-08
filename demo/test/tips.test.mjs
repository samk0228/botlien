import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeHours,
  centsPerActiveHour,
  profileByHourOfDay,
  peakHours,
  mergeProfiles,
  chargingShareByHourOfDay,
  chargeInPeak,
  idleInPeak,
  stallHotspot,
  errorDrag,
  fleetImbalance,
  buildTips,
} from "../src/tips.mjs";

const HOUR = 3_600_000;

/** Local-time bucket start for a given day offset and clock hour. Built through
 * the Date constructor rather than by adding milliseconds so the fixtures land
 * on the same local hours the code reads, in any timezone. */
const at = (day, hour) => new Date(2026, 6, 1 + day, hour, 0, 0, 0).getTime();

function rollup(day, hour, { active = 0, online = HOUR, missions = 0, errors = 0, samples = 60 } = {}) {
  return {
    bucket_start_at: at(day, hour),
    bucket_ms: HOUR,
    sample_count: samples,
    online_ms: online,
    active_ms: active,
    mission_count: missions,
    error_count: errors,
    stuck_episodes: 0,
  };
}

/** A robot busy at 12-13 and 18-20, idle otherwise, over `days` days. */
function busyDays(days, { peakActive = 0.5 * HOUR, offActive = 0.05 * HOUR, peakMissions = 20, offMissions = 2 } = {}) {
  const rows = [];
  for (let d = 0; d < days; d++) {
    for (let h = 10; h < 22; h++) {
      const isPeak = h === 12 || h === 13 || h === 18 || h === 19 || h === 20;
      rows.push(rollup(d, h, { active: isPeak ? peakActive : offActive, missions: isPeak ? peakMissions : offMissions }));
    }
  }
  return rows;
}

const fin = (over) => ({
  basis: "mission",
  taskType: "tray_delivery",
  taskLabel: "runs started",
  unit: "run",
  tasks: 1000,
  rateCents: 73,
  workServicedCents: 73_000,
  invoiceProratedCents: 30_000,
  coverage: 73_000 / 30_000,
  activeMs: 100 * HOUR,
  ...over,
});

function ctxFor(rollups, over = {}) {
  const f = over.fin ?? fin();
  return {
    robot: { id: 1, name: "Servi 1" },
    fin: f,
    rollups,
    profile: profileByHourOfDay(rollups),
    observedMs: rollups.reduce((s, r) => s + r.bucket_ms, 0),
    totalSamples: rollups.reduce((s, r) => s + r.sample_count, 0),
    perHourCents: centsPerActiveHour(f),
    chargingByHourOfDay: Array(24).fill(0),
    hotspots: [],
    stallSamples: 0,
    peaks: [12, 13, 18, 19, 20],
    periodLabel: "over the 14 days measured",
    ...over,
  };
}

test("describeHours collapses runs and wraps midnight", () => {
  assert.equal(describeHours([17, 18, 19, 20]), "5pm to 9pm");
  assert.equal(describeHours([12, 13, 18, 19, 20]), "12pm to 2pm and 6pm to 9pm");
  assert.equal(describeHours([9]), "9am");
  // The night-cleaner case: naive sorting reports one shift as two.
  assert.equal(describeHours([23, 0, 1, 2]), "11pm to 3am");
  assert.equal(describeHours([]), "");
});

test("centsPerActiveHour refuses to price a robot that has barely worked", () => {
  assert.equal(centsPerActiveHour(fin({ activeMs: 0.5 * HOUR })), null, "below the active-hours floor");
  assert.equal(centsPerActiveHour(fin({ workServicedCents: 0 })), null, "no work performed");
  assert.equal(centsPerActiveHour(null), null);
  assert.equal(centsPerActiveHour(fin({ activeMs: 100 * HOUR, workServicedCents: 50_000 })), 500);
});

test("peakHours reads the busy stretch off the fleet, catching both rushes", () => {
  const profile = profileByHourOfDay(busyDays(7));
  assert.deepEqual(peakHours(profile), [12, 13, 18, 19, 20]);
  // Nothing happened, so there is no peak to name rather than a default one.
  assert.deepEqual(peakHours(profileByHourOfDay([])), []);
});

test("mergeProfiles sums hour slots across robots", () => {
  const a = profileByHourOfDay([rollup(0, 12, { active: HOUR, missions: 5 })]);
  const b = profileByHourOfDay([rollup(0, 12, { active: HOUR, missions: 7 })]);
  const merged = mergeProfiles([a, b]);
  assert.equal(merged[12].missions, 12);
  assert.equal(merged[12].activeMs, 2 * HOUR);
});

test("chargingShareByHourOfDay folds absolute hours into a 24-slot share", () => {
  const rows = [
    { hour_start: at(0, 19), charging_samples: 30, samples: 60 },
    { hour_start: at(1, 19), charging_samples: 30, samples: 60 },
    { hour_start: at(0, 3), charging_samples: 0, samples: 60 },
  ];
  const share = chargingShareByHourOfDay(rows);
  assert.equal(share[19], 0.5);
  assert.equal(share[3], 0);
  assert.equal(share[7], 0, "unobserved hours are zero, not NaN");
});

test("chargeInPeak prices recovered hours at the robot's OWN observed rate", () => {
  const charging = Array(24).fill(0);
  for (const h of [12, 13, 18, 19, 20]) charging[h] = 0.5; // half the peak on the charger
  const tip = chargeInPeak(ctxFor(busyDays(14), { chargingByHourOfDay: charging }));
  assert.ok(tip, "should fire when half the peak is spent charging");
  assert.equal(tip.id, "charge_in_peak");

  // The claim is bounded by duty observed in peak hours it was NOT charging.
  // Peak hours: 5/day x 14 days = 70 elapsed, half charging = 35 charging hours.
  // Available peak = 35h, active in peak = 5 x 14 x 0.5h = 35h -> 100% duty...
  // but the profile's active time spans all peak hours, so the bound is the
  // observed share, and the tip must never claim more hours than were charging.
  const claimed = tip.valueCents / centsPerActiveHour(fin());
  assert.ok(claimed <= 35 + 1e-6, `claimed ${claimed}h must not exceed the 35h spent charging`);
  assert.match(tip.basis, /per active hour it already earned/);
  assert.ok(tip.bound.includes("upper bound"));
});

test("chargeInPeak stays silent when the charger is used off-peak", () => {
  const charging = Array(24).fill(0);
  charging[3] = 1; // charges at 3am, exactly as it should
  assert.equal(chargeInPeak(ctxFor(busyDays(14), { chargingByHourOfDay: charging })), null);
});

test("idleInPeak measures over non-charging time so it cannot bill the same hour twice", () => {
  // Idle through the rush: peak duty far below its own best hour at 10am.
  const rows = [];
  for (let d = 0; d < 14; d++) {
    for (let h = 10; h < 22; h++) {
      const isPeak = [12, 13, 18, 19, 20].includes(h);
      rows.push(rollup(d, h, { active: h === 10 ? 0.9 * HOUR : isPeak ? 0.1 * HOUR : 0.2 * HOUR, missions: isPeak ? 20 : 3 }));
    }
  }
  const idle = idleInPeak(ctxFor(rows));
  assert.ok(idle, "a robot at 10% duty through its busiest hours is worth flagging");

  // Now say it was charging through all of that. The idle gap must shrink,
  // because charging time belongs to chargeInPeak and billing it here too would
  // double-count one hour across two tips.
  const charging = Array(24).fill(0);
  for (const h of [12, 13, 18, 19, 20]) charging[h] = 0.95;
  const withCharge = idleInPeak(ctxFor(rows, { chargingByHourOfDay: charging }));
  assert.ok(withCharge === null || withCharge.valueCents < idle.valueCents, "charging time must not be billed as idle");
});

test("idleInPeak stays silent when the robot already runs at its own ceiling", () => {
  const rows = [];
  for (let d = 0; d < 14; d++) {
    for (let h = 10; h < 22; h++) rows.push(rollup(d, h, { active: 0.5 * HOUR, missions: [12, 13, 18, 19, 20].includes(h) ? 20 : 2 }));
  }
  assert.equal(idleInPeak(ctxFor(rows)), null, "uniform duty means no peak-hour gap to recover");
});

test("stallHotspot needs concentration, and prices stalls as work already counted", () => {
  const rows = busyDays(14);
  const base = {
    hotspots: [{ gx: 4, gy: 8, samples: 800 }, { gx: 12, gy: 2, samples: 200 }],
    stallSamples: 1000,
    totalSamples: 10_000,
  };
  const tip = stallHotspot(ctxFor(rows, base));
  assert.ok(tip);
  assert.equal(tip.valueKind, "at_risk", "stall time is credited work, not upside");
  assert.match(tip.finding, /80%/);

  // Scattered stalls are a different problem and this rule must not claim them.
  const scattered = stallHotspot(ctxFor(rows, { ...base, hotspots: [{ gx: 4, gy: 8, samples: 150 }] }));
  assert.equal(scattered, null);
  // Too few stalls to call it a pattern.
  const thin = stallHotspot(ctxFor(rows, { ...base, hotspots: [{ gx: 4, gy: 8, samples: 9 }], stallSamples: 10 }));
  assert.equal(thin, null);
});

test("errorDrag compares against the robot's own median for the SAME hour of day", () => {
  // Clean baseline: 20 runs at 19:00 every day. Then three fault-ridden 19:00s
  // that only managed 5. The shortfall is 45 runs, priced at the owner's rate.
  const rows = [];
  for (let d = 0; d < 20; d++) rows.push(rollup(d, 19, { active: 0.5 * HOUR, missions: 20 }));
  for (let d = 20; d < 26; d++) rows.push(rollup(d, 19, { active: 0.5 * HOUR, missions: 5, errors: 4 }));
  const tip = errorDrag(ctxFor(rows));
  assert.ok(tip, "six fault hours running 15 below median is a finding");
  assert.equal(tip.valueCents, Math.round(6 * 15 * 73));
  assert.match(tip.bound, /correlation, not proof/);

  // Hour-priced work loses hours, not tasks, so this rule declines to speak.
  assert.equal(errorDrag(ctxFor(rows, { fin: fin({ basis: "active_hour" }) })), null);
});

test("fleetImbalance compares within one kind of work and needs three units", () => {
  const mk = (id, name, coverage, taskType = "tray_delivery") => ({
    robot: { id, name },
    fin: fin({ taskType, coverage, invoiceProratedCents: 30_000, workServicedCents: 30_000 * coverage }),
  });

  // Two robots is a difference, not a pattern.
  assert.equal(fleetImbalance([mk(1, "A", 2.0), mk(2, "B", 0.4)], "p").length, 0);

  const tips = fleetImbalance([mk(1, "A", 2.0), mk(2, "B", 1.8), mk(3, "C", 0.4)], "this period");
  assert.equal(tips.length, 1);
  assert.equal(tips[0].robotName, "C");
  assert.match(tips[0].action, /renewal/);
  // Measured against the MEDIAN sibling, not the best one.
  assert.match(tips[0].finding, /fleet median of 1\.80x/);

  // Different units never get compared to each other.
  assert.equal(fleetImbalance([mk(1, "A", 2.0), mk(2, "B", 1.8), mk(3, "S", 0.4, "cleaning_hour")], "p").length, 0);
});

test("buildTips folds one finding per rule per kind of work and never double-counts money", () => {
  const rows = [];
  for (let d = 0; d < 14; d++) {
    for (let h = 10; h < 22; h++) {
      const isPeak = [12, 13, 18, 19, 20].includes(h);
      rows.push(rollup(d, h, { active: h === 10 ? 0.9 * HOUR : isPeak ? 0.1 * HOUR : 0.2 * HOUR, missions: isPeak ? 20 : 3 }));
    }
  }
  const ctxs = [
    ctxFor(rows, { robot: { id: 1, name: "Servi 1" } }),
    ctxFor(rows, { robot: { id: 2, name: "Servi 2" } }),
    ctxFor(rows, { robot: { id: 3, name: "Servi 3" } }),
  ];
  const out = buildTips(ctxs, { periodLabel: "over the 14 days measured" });

  const idle = out.tips.filter((t) => t.id === "idle_in_peak");
  assert.equal(idle.length, 1, "three robots with one shared problem is one finding");
  assert.deepEqual(idle[0].alsoRobots, ["Servi 2", "Servi 3"]);
  assert.equal(out.suppressed, 2);
  // The headline total must not triple because the fleet has three robots.
  assert.equal(out.totalUpsideCents, out.tips.filter((t) => t.valueKind !== "at_risk").reduce((s, t) => s + (t.valueCents ?? 0), 0));
  assert.ok(out.totalUpsideCents < idle[0].valueCents * 2);
});

test("buildTips says nothing at all on a robot with too little history", () => {
  const thin = ctxFor(busyDays(1)); // 12 hours of buckets, under the 48h floor
  assert.deepEqual(buildTips([thin]).tips, []);
});

test("at-risk money is excluded from the recoverable headline", () => {
  const rows = busyDays(14);
  const out = buildTips(
    [ctxFor(rows, { hotspots: [{ gx: 4, gy: 8, samples: 900 }], stallSamples: 1000, totalSamples: 10_000 })],
    { periodLabel: "p" }
  );
  const stall = out.tips.find((t) => t.id === "stall_hotspot");
  assert.ok(stall && stall.valueCents > 0);
  assert.equal(out.totalUpsideCents, 0, "work already counted in coverage is not recoverable upside");
});
