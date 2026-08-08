// The tips engine: the part of the board that changes the number instead of
// describing it. A coverage ratio is a report card. "Your scrubber spent 6.2
// hours stalled within two meters of one spot" is something an owner can act on
// before lunch.
//
// THE RULE THAT KEEPS A TIP FROM BECOMING MARKETING: a tip may only claim work
// the robot has ALREADY DEMONSTRATED it can do. Every dollar figure here is
// (recoverable hours) x (the cents per active hour this same robot actually
// earned in this same window). Never a vendor throughput spec, never a fitted
// model, never a "robots like yours". If the robot has never hit that rate, we
// cannot claim it would.
//
// That is the same discipline rates.mjs applies to the replacement rate, and it
// is the whole reason an owner should believe this page over the ROI calculator
// on the vendor's website.
//
// Two honesty conventions carried through every rule:
//   - Figures are UPPER BOUNDS and say so. Recovering all of an idle hour is
//     the ceiling, not the forecast.
//   - Every tip carries `basis`, the arithmetic spelled out, for the same
//     reason formulaLine() exists in finance.mjs: an owner who cannot check a
//     number by hand has to take it on faith, and faith is what the vendor is
//     already selling them.

const HOUR_MS = 3_600_000;

// Evidence floors. Below these a "pattern" is noise, and a confident sentence
// about noise is worse than saying nothing.
const MIN_OBSERVED_HOURS = 48;
const MIN_ACTIVE_HOURS = 2;
const MIN_STALL_SAMPLES = 20;

/** Local clock hour of an instant. Local on purpose: a dinner rush is a
 * local-time idea, and SQLite's UTC hour would smear it across two hours for
 * anyone who is not on GMT. */
export function hourOfDay(ms) {
  return new Date(ms).getHours();
}

/** Fold a robot's hourly rollups into a 24-slot profile of its own day.
 * elapsedMs is the observed wall time in those buckets, which is what duty
 * share must be measured against: a robot seen for two Tuesdays at 7pm has two
 * hours of denominator at hour 19, not 24. */
export function profileByHourOfDay(rollups, bucketMs = HOUR_MS) {
  const slots = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    buckets: 0,
    elapsedMs: 0,
    onlineMs: 0,
    activeMs: 0,
    missions: 0,
    errors: 0,
    errorFreeMissions: [],
  }));
  for (const r of rollups ?? []) {
    const s = slots[hourOfDay(r.bucket_start_at)];
    s.buckets += 1;
    s.elapsedMs += r.bucket_ms ?? bucketMs;
    s.onlineMs += r.online_ms ?? 0;
    s.activeMs += r.active_ms ?? 0;
    s.missions += r.mission_count ?? 0;
    s.errors += r.error_count ?? 0;
    if ((r.error_count ?? 0) === 0) s.errorFreeMissions.push(r.mission_count ?? 0);
  }
  return slots;
}

/** The site's day, from what the robots actually did. Peak = every hour at or
 * above 60% of the busiest hour, which picks up a lunch AND a dinner rush
 * rather than only the taller of the two. Derived from the fleet, never from a
 * "restaurants are busy at 7pm" assumption we would have no way to defend. */
export function peakHours(fleetProfile, { relativeFloor = 0.6 } = {}) {
  const max = Math.max(...fleetProfile.map((s) => s.missions), 0);
  if (max <= 0) return [];
  return fleetProfile.filter((s) => s.missions >= max * relativeFloor).map((s) => s.hour);
}

export function mergeProfiles(profiles) {
  const out = profileByHourOfDay([]);
  for (const p of profiles) {
    for (let h = 0; h < 24; h++) {
      out[h].buckets += p[h].buckets;
      out[h].elapsedMs += p[h].elapsedMs;
      out[h].onlineMs += p[h].onlineMs;
      out[h].activeMs += p[h].activeMs;
      out[h].missions += p[h].missions;
      out[h].errors += p[h].errors;
    }
  }
  return out;
}

/** What one active hour of this robot's work was worth, from this window only.
 * The unit that prices every tip. Null when the robot has not worked enough for
 * the figure to mean anything, and a null rate suppresses the dollar line
 * rather than substituting a benchmark: a tip priced off someone else's robot
 * is the exact thing this file exists not to do. */
export function centsPerActiveHour(fin) {
  if (!fin) return null;
  const activeHours = (fin.activeMs ?? 0) / HOUR_MS;
  if (activeHours < MIN_ACTIVE_HOURS) return null;
  if (!(fin.workServicedCents > 0)) return null;
  return fin.workServicedCents / activeHours;
}

function share(part, whole) {
  return whole > 0 ? part / whole : 0;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtHours(h) {
  return h >= 10 ? h.toFixed(0) : h.toFixed(1);
}

function fmtMoney(cents) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHour(h) {
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/** "5pm to 9pm" for a run of hours, "12pm, 5pm and 7pm" otherwise.
 *
 * Wraps midnight, which matters as soon as the fleet contains a night cleaner:
 * hours [23,0,1,2] naively sort to [0,1,2,23] and print as "12am to 3am and
 * 11pm", describing one continuous shift as two disjoint ones. */
export function describeHours(hours) {
  if (hours.length === 0) return "";
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const runs = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && h === last[last.length - 1] + 1) last.push(h);
    else runs.push([h]);
  }
  // A run ending at 11pm and one starting at midnight are the same stretch.
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first[0] === 0 && last[last.length - 1] === 23) {
      runs.pop();
      runs[0] = [...last, ...first];
    }
  }
  const parts = runs.map((run) =>
    run.length === 1 ? fmtHour(run[0]) : `${fmtHour(run[0])} to ${fmtHour((run[run.length - 1] + 1) % 24)}`
  );
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Price recoverable hours at the robot's own observed earning rate. Returns
 * null (not zero) when the robot has not earned enough for the rate to exist,
 * so the caller renders "not priced" rather than a confident $0.00. */
function priceHours(hours, perHourCents) {
  if (perHourCents === null || !(hours > 0)) return null;
  return Math.round(hours * perHourCents);
}

// ---------------------------------------------------------------------------
// Rules. Each takes one robot's context and returns a tip or null. Order here
// is not priority; tips are ranked by value at the end.
// ---------------------------------------------------------------------------

/** Charging through the rush. The cleanest tip in the product: the fix is a
 * schedule change in the vendor console, it costs nothing, and the robot has
 * already proved what it does with an available peak hour. */
export function chargeInPeak(ctx) {
  const { robot, profile, peaks, perHourCents } = ctx;
  if (peaks.length === 0 || !ctx.chargingByHourOfDay) return null;

  let peakElapsedMs = 0;
  let peakChargingMs = 0;
  let peakActiveMs = 0;
  const hitHours = [];
  for (const h of peaks) {
    const elapsed = profile[h].elapsedMs;
    if (elapsed <= 0) continue;
    const chargingShare = ctx.chargingByHourOfDay[h];
    peakElapsedMs += elapsed;
    peakChargingMs += elapsed * chargingShare;
    peakActiveMs += profile[h].activeMs;
    if (chargingShare >= 0.12) hitHours.push(h);
  }
  if (hitHours.length === 0 || peakElapsedMs <= 0) return null;

  const chargingShareOfPeak = share(peakChargingMs, peakElapsedMs);
  if (chargingShareOfPeak < 0.08) return null;

  // What the robot does with a peak hour it is NOT charging through. This is
  // the bound: we claim the recovered hours would be as busy as the peak hours
  // it already works, and no busier.
  const availablePeakMs = peakElapsedMs - peakChargingMs;
  const peakDutyShare = share(peakActiveMs, availablePeakMs);
  if (peakDutyShare <= 0) return null;

  const recoverableHours = (peakChargingMs / HOUR_MS) * peakDutyShare;
  const valueCents = priceHours(recoverableHours, perHourCents);

  // Quietest hours it is already online, which is where the charge should go.
  const quiet = [...profile]
    .filter((s) => s.elapsedMs > 0 && !peaks.includes(s.hour))
    .sort((a, b) => share(a.missions, a.elapsedMs) - share(b.missions, b.elapsedMs))
    .slice(0, 3)
    .map((s) => s.hour);

  return {
    id: "charge_in_peak",
    robotId: robot.id,
    robotName: robot.name,
    taskType: ctx.fin?.taskType ?? null,
    kind: "schedule",
    // Hour-specific rather than "your rush": this same rule fires on a night
    // scrubber whose busiest hours are 1am, and telling that owner their robot
    // charges through the dinner service would be plainly wrong.
    title: `${robot.name} charges during its busiest hours`,
    finding:
      `Its heaviest work falls in ${describeHours(peaks)}, and it spent ${Math.round(chargingShareOfPeak * 100)}% of that ` +
      `on the charger, which is ${fmtHours(peakChargingMs / HOUR_MS)} hours. ` +
      `In the busy hours it was available it ran at ${Math.round(peakDutyShare * 100)}% duty.`,
    action: `Move the charge window to ${describeHours(quiet)}, when it is barely working anyway.`,
    valueCents,
    valuePeriod: ctx.periodLabel,
    basis:
      `${fmtHours(peakChargingMs / HOUR_MS)} peak hours charging x ${Math.round(peakDutyShare * 100)}% observed peak duty ` +
      `= ${fmtHours(recoverableHours)} active hours` +
      (valueCents === null ? "" : ` x ${fmtMoney(perHourCents)} per active hour it already earned = ${fmtMoney(valueCents)}`),
    bound: "upper bound: assumes recovered hours are exactly as busy as its current peak hours, never busier",
  };
}

/** Idle while the room is full. Deliberately measured over NON-charging time,
 * so this rule and chargeInPeak cannot both bill the same hour. */
export function idleInPeak(ctx) {
  const { robot, profile, peaks, perHourCents } = ctx;
  if (peaks.length === 0) return null;

  const chargeShare = ctx.chargingByHourOfDay ?? Array(24).fill(0);
  const avail = (h) => profile[h].elapsedMs * (1 - chargeShare[h]);

  // The robot's own ceiling: the best duty share it reached in any hour with
  // enough observation behind it. Its own record, not a target we invented.
  const candidates = profile
    .filter((s) => s.buckets >= 3 && avail(s.hour) > 0)
    .map((s) => ({ hour: s.hour, duty: share(s.activeMs, avail(s.hour)) }));
  if (candidates.length < 4) return null;
  const best = candidates.reduce((a, b) => (b.duty > a.duty ? b : a));
  if (best.duty <= 0.05) return null;

  let gapMs = 0;
  let peakAvailMs = 0;
  let peakActiveMs = 0;
  for (const h of peaks) {
    const a = avail(h);
    if (a <= 0) continue;
    peakAvailMs += a;
    peakActiveMs += profile[h].activeMs;
    gapMs += Math.max(0, a * best.duty - profile[h].activeMs);
  }
  if (peakAvailMs <= 0) return null;

  const peakDuty = share(peakActiveMs, peakAvailMs);
  // Only worth saying when the gap is material AND large relative to the peak.
  if (gapMs / HOUR_MS < 2 || peakDuty >= best.duty * 0.8) return null;

  const recoverableHours = gapMs / HOUR_MS;
  const valueCents = priceHours(recoverableHours, perHourCents);

  return {
    id: "idle_in_peak",
    robotId: robot.id,
    robotName: robot.name,
    taskType: ctx.fin?.taskType ?? null,
    kind: "capacity",
    title: `${robot.name} sits idle when it should be busiest`,
    finding:
      `Across ${describeHours(peaks)}, its heaviest stretch, it ran at ${Math.round(peakDuty * 100)}% duty, ` +
      `against ${Math.round(best.duty * 100)}% in its own best hour (${fmtHour(best.hour)}). ` +
      `The capacity is there and unused.`,
    action:
      `Check whether the work is still being done by hand in those hours, or whether its zone excludes the busiest area. ` +
      `Charging is already excluded from this reading, so the idle time is real.`,
    valueCents,
    valuePeriod: ctx.periodLabel,
    basis:
      `peak hours at ${Math.round(best.duty * 100)}% (its own best) minus what it actually ran ` +
      `= ${fmtHours(recoverableHours)} active hours` +
      (valueCents === null ? "" : ` x ${fmtMoney(perHourCents)} per active hour = ${fmtMoney(valueCents)}`),
    bound: "upper bound: assumes every peak hour could match its own best hour",
  };
}

/** One bad spot on the floor. The most physically actionable tip in the set,
 * and priced as work AT RISK rather than upside: a robot reporting an active
 * mission while wedged against a chair leg is already being credited for that
 * time, so the honest framing is that the credit is overstated, not that there
 * is money lying around. */
export function stallHotspot(ctx) {
  const { robot, hotspots, stallSamples, totalSamples, perHourCents, observedMs } = ctx;
  if (!hotspots || hotspots.length === 0) return null;
  if (stallSamples < MIN_STALL_SAMPLES || !(totalSamples > 0)) return null;

  const top = hotspots[0];
  const concentration = share(top.samples, stallSamples);
  if (concentration < 0.3) return null;

  // Samples are near-evenly spaced, so a sample share is a fair reading of a
  // time share. Converting through observed wall time rather than assuming a
  // polling interval keeps this correct for any connector's cadence.
  const stallMs = share(stallSamples, totalSamples) * observedMs;
  const topStallMs = stallMs * concentration;
  const valueCents = priceHours(topStallMs / HOUR_MS, perHourCents);

  return {
    id: "stall_hotspot",
    robotId: robot.id,
    robotName: robot.name,
    taskType: ctx.fin?.taskType ?? null,
    kind: "floor",
    title: `${robot.name} keeps getting stuck in the same place`,
    finding:
      `${Math.round(concentration * 100)}% of its stall time happened within a couple of meters of one spot ` +
      `(around x ${top.gx}, y ${top.gy} on its map). That is ${fmtHours(topStallMs / HOUR_MS)} hours in one place.`,
    action:
      `Walk to that spot during service. It is usually a chair that gets pushed out, a propped door, ` +
      `a floor mat edge, or a blind corner the map does not know about.`,
    valueCents,
    valuePeriod: ctx.periodLabel,
    valueKind: "at_risk",
    basis:
      `${fmtHours(stallMs / HOUR_MS)} hours stalled x ${Math.round(concentration * 100)}% in that one cell ` +
      `= ${fmtHours(topStallMs / HOUR_MS)} hours` +
      (valueCents === null ? "" : ` x ${fmtMoney(perHourCents)} per active hour = ${fmtMoney(valueCents)}`),
    bound: "this is work already counted in your coverage that the robot did not really perform, so clearing it makes the number honest as well as bigger",
  };
}

/** Faults that cost throughput. Compares hours that carried an error against
 * this robot's own median for the SAME hour of day among error-free hours, so
 * a quiet 3pm is never scored against a busy 7pm. */
export function errorDrag(ctx) {
  const { robot, profile, rollups, fin } = ctx;
  if (!fin || !(fin.rateCents > 0)) return null;
  if (fin.basis !== "mission") return null; // hour-priced work does not lose tasks, it loses hours

  const medianByHour = profile.map((s) => median(s.errorFreeMissions));
  let shortfall = 0;
  let hoursWithErrors = 0;
  let errorCount = 0;
  for (const r of rollups ?? []) {
    const errs = r.error_count ?? 0;
    if (errs <= 0) continue;
    const expected = medianByHour[hourOfDay(r.bucket_start_at)];
    if (expected === null) continue;
    hoursWithErrors += 1;
    errorCount += errs;
    shortfall += Math.max(0, expected - (r.mission_count ?? 0));
  }
  if (hoursWithErrors < 5 || shortfall < 5) return null;

  const valueCents = Math.round(shortfall * fin.rateCents);
  const label = fin.taskLabel ?? "tasks";

  return {
    id: "error_drag",
    robotId: robot.id,
    robotName: robot.name,
    taskType: fin.taskType ?? null,
    kind: "faults",
    title: `Faults are costing ${robot.name} real throughput`,
    finding:
      `${errorCount} faults across ${hoursWithErrors} hours. Those hours came in ${Math.round(shortfall)} ${label} ` +
      `below this robot's own median for the same hour of day.`,
    action:
      `Pull its error log for the top recurring code and raise it with the vendor. ` +
      `A fault that repeats on a schedule is a warranty conversation, not an operating cost.`,
    valueCents,
    valuePeriod: ctx.periodLabel,
    basis:
      `${Math.round(shortfall)} ${label} below its own error-free median x ${fmtMoney(fin.rateCents)} per ${fin.unit ?? "task"} ` +
      `= ${fmtMoney(valueCents)}`,
    bound: "correlation, not proof of cause: these are the hours faults appeared in, and faults may be a symptom of the same thing slowing the robot down",
  };
}

/** The renewal question, which is the only robots-versus-labour comparison
 * worth making: not "should I have hired someone", which the owner settled when
 * they signed, but "is this particular unit earning the same invoice its
 * siblings earn". Compared only within one kind of work, because runs and
 * cleaning hours are different units. */
export function fleetImbalance(robotCtxs, periodLabel) {
  const byType = new Map();
  for (const c of robotCtxs) {
    if (!c.fin || !(c.fin.invoiceProratedCents > 0)) continue;
    if (!byType.has(c.fin.taskType)) byType.set(c.fin.taskType, []);
    byType.get(c.fin.taskType).push(c);
  }

  const tips = [];
  for (const [taskType, group] of byType) {
    if (group.length < 3) continue; // two robots is a difference, not a pattern
    const sorted = [...group].sort((a, b) => b.fin.coverage - a.fin.coverage);
    const worst = sorted[sorted.length - 1];
    const med = median(sorted.map((c) => c.fin.coverage));
    if (med === null || !(med > 0)) continue;
    if (worst.fin.coverage >= med * 0.7) continue;

    // The gap against the MEDIAN sibling, not the best one. Every robot cannot
    // be the best robot, but every robot can plausibly be the middle one.
    const target = Math.round(worst.fin.invoiceProratedCents * med);
    const gapCents = Math.max(0, target - worst.fin.workServicedCents);

    tips.push({
      id: "fleet_imbalance",
      robotId: worst.robot.id,
      robotName: worst.robot.name,
      taskType,
      kind: "renewal",
      title: `${worst.robot.name} earns its invoice least`,
      finding:
        `It returned ${worst.fin.coverage.toFixed(2)}x against a fleet median of ${med.toFixed(2)}x on the same kind of work, ` +
        `while costing ${fmtMoney(worst.fin.invoiceProratedCents)} over this period. ` +
        `${sorted[0].robot.name} returned ${sorted[0].fin.coverage.toFixed(2)}x.`,
      action:
        `Move it to a busier zone or section before renewal. If its position cannot change, this is the unit to drop ` +
        `when the term ends, and it is the only robot decision this data can honestly support.`,
      valueCents: gapCents > 0 ? gapCents : null,
      valuePeriod: periodLabel,
      basis:
        `${fmtMoney(worst.fin.invoiceProratedCents)} invoice x ${med.toFixed(2)}x fleet median = ${fmtMoney(target)} of work expected, ` +
        `against ${fmtMoney(worst.fin.workServicedCents)} performed`,
      bound: `assumes this unit could reach the median of its siblings in the same ${taskType.replace(/_/g, " ")} work`,
    });
  }
  return tips;
}

// ---------------------------------------------------------------------------

const ROBOT_RULES = [chargeInPeak, idleInPeak, stallHotspot, errorDrag];

/** Build every tip for a fleet. `robotCtxs` is assembled by the caller from the
 * store (see ownerModel), which keeps this module pure and testable against
 * hand-written fixtures rather than a database.
 *
 * Ranked by value because an owner reads two tips and closes the tab, so the
 * two that pay for the subscription have to be the two at the top. Unpriced
 * tips sort last rather than being dropped: "we found a pattern we cannot
 * price" still beats silence. */
export function buildTips(robotCtxs, { periodLabel = "this period", limit = 6 } = {}) {
  const tips = [];
  for (const ctx of robotCtxs) {
    if (ctx.observedMs < MIN_OBSERVED_HOURS * HOUR_MS) continue;
    for (const rule of ROBOT_RULES) {
      const tip = rule({ ...ctx, periodLabel });
      if (tip) tips.push(tip);
    }
  }
  tips.push(...fleetImbalance(robotCtxs, periodLabel));

  tips.sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1));

  // One tip per rule PER KIND OF WORK. Four tray robots idling through the same
  // rush is ONE finding about the dining room, and printing it four times reads
  // as four problems, buries the other rules below the fold, and quadruples the
  // headline recoverable total by counting one insight once per machine.
  //
  // Keyed on the kind of work as well as the rule, because a night scrubber and
  // a lunch tray robot have different busy hours: folding them together would
  // print "same pattern on Scrubber 75" under a finding about the dinner rush,
  // which is two different problems wearing one sentence.
  const byRule = new Map();
  for (const tip of tips) {
    const key = `${tip.id}::${tip.taskType ?? "any"}`;
    const seen = byRule.get(key);
    if (!seen) {
      byRule.set(key, { ...tip, alsoRobots: [] });
      continue;
    }
    seen.alsoRobots.push(tip.robotName);
    // The money is only claimed once, but the fleet-wide size of the pattern is
    // still worth knowing, so it is carried separately and never summed into
    // the recoverable total.
    seen.alsoValueCents = (seen.alsoValueCents ?? 0) + (tip.valueCents ?? 0);
  }
  const deduped = [...byRule.values()].sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1));

  const shown = deduped.slice(0, limit);
  return {
    tips: shown,
    hidden: deduped.length - shown.length,
    suppressed: tips.length - deduped.length,
    // Only upside is summed. "At risk" money is already inside the coverage
    // number, so adding it to a recoverable total would count it twice and
    // inflate the one figure an owner is most likely to repeat out loud.
    totalUpsideCents: shown
      .filter((t) => t.valueKind !== "at_risk" && t.valueCents !== null)
      .reduce((s, t) => s + t.valueCents, 0),
  };
}

/** Fold the store's per-absolute-hour charging rows into a 24-slot share of
 * time spent charging. Exported for the caller and for tests. */
export function chargingShareByHourOfDay(rows) {
  const charging = Array(24).fill(0);
  const samples = Array(24).fill(0);
  for (const r of rows ?? []) {
    const h = hourOfDay(r.hour_start);
    charging[h] += r.charging_samples ?? 0;
    samples[h] += r.samples ?? 0;
  }
  return charging.map((c, h) => share(c, samples[h]));
}

export { HOUR_MS, MIN_OBSERVED_HOURS };
