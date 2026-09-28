/** What it costs to keep the robots running.
 *
 *  The lease invoice is the only cost the owner is ever handed. It is not the
 *  only cost they pay. Every stall ends with a person walking over, and some
 *  fleets have someone driving the machine by hand for part of the day. That
 *  labour is already in the telemetry and has never been priced.
 *
 *  This module keeps two things strictly apart, and the UI repeats the split:
 *
 *    MEASURED    hands-on-controls time. The vendor reported a human was
 *                driving. Hours x wage, no assumption anywhere in the chain.
 *
 *    ESTIMATED   clearing stalls. Telemetry knows a stall STARTED and knows
 *                when it ended, but it cannot know how long the person spent
 *                walking over, freeing the robot and walking back. So the
 *                count of stalls is observed and the minutes per stall is a
 *                stated assumption the owner can argue with.
 *
 *  Stall DURATION is deliberately not priced here as labour. It is already
 *  counted by the stall tip as work the robot did not really perform, and
 *  charging the same hours twice, once as lost robot output and once as human
 *  time, would inflate the number in exactly the way this product exists to
 *  avoid. Duration is carried through as context only.
 */

const HOUR_MS = 3_600_000;

/** Minutes of a person's time per stall, start to finish: notice, walk over,
 *  free the machine, walk back. Stated on screen next to every figure derived
 *  from it, because it is the one number here nobody measured. Six is
 *  deliberately conservative; the owner can reason about it in their head. */
export const MINUTES_PER_CLEAR = 6;

/** Below this the panel says nothing. Two stalls in a month is not a staffing
 *  cost, it is a Tuesday, and putting a dollar sign on it trains the owner to
 *  ignore the whole panel. */
export const MIN_CLEARS = 3;

const share = (part, whole) => (whole > 0 ? part / whole : 0);

/** One robot's intervention cost over the window.
 *  Returns null when there is no wage to price against: an hour of nobody's
 *  time is not zero dollars, it is an unknown, and the fleet total says so
 *  rather than quietly treating the robot as free to run. */
export function robotInterventions(ctx) {
  const {
    robot,
    rollups = [],
    wageCentsHour = null,
    wageIsBenchmark = false,
    stuckSamples = 0,
    totalSamples = 0,
    conditionSamples = 0,
    activeManualSamples = 0,
    activeSamples = 0,
    activeMs = 0,
    observedMs = 0,
  } = ctx;

  const clears = rollups.reduce((n, r) => n + (r.stuck_episodes ?? 0), 0);

  // Sample share x observed wall time, the same conversion the stall tip uses.
  // Going through wall time rather than assuming a polling interval keeps this
  // correct for any connector's cadence, and for an imported file whose rows
  // arrive at whatever spacing the operator's own dashboard exported.
  const stalledHours = (share(stuckSamples, totalSamples) * observedMs) / HOUR_MS;

  // Hands on the controls is only knowable when the vendor sends the field.
  // Bear does not. An imported CSV does not. Absent means absent, never zero:
  // a fleet with no manual-control feed has not been shown to have no manual
  // driving, and rendering a confident 0 hours would be a lie by omission.
  //
  // Converted against WORKING time, not wall time. A feed that reports the flag
  // on every heartbeat, parked or not, would otherwise turn a 45% share into
  // 45% of the calendar, which came out as 226 hours of hand-driving on a
  // machine that only ran for 34. The share and the clock it multiplies are
  // both defined on mission_state='active', so the answer is bounded by the
  // hours the robot actually worked and reads as what it is: of the time this
  // machine was working, this much of it had a person steering.
  const manualHours =
    conditionSamples > 0 ? (share(activeManualSamples, activeSamples) * activeMs) / HOUR_MS : null;

  const clearHours = (clears * MINUTES_PER_CLEAR) / 60;
  const priced = wageCentsHour > 0;

  return {
    robotId: robot.id,
    robotName: robot.name,
    clears,
    clearHours,
    clearCents: priced ? Math.round(clearHours * wageCentsHour) : null,
    manualHours,
    manualCents: priced && manualHours !== null ? Math.round(manualHours * wageCentsHour) : null,
    stalledHours,
    wageCentsHour: priced ? wageCentsHour : null,
    wageIsBenchmark,
    hasManualFeed: conditionSamples > 0,
    totalHours: clearHours + (manualHours ?? 0),
    totalCents: priced ? Math.round((clearHours + (manualHours ?? 0)) * wageCentsHour) : null,
  };
}

/** The fleet reading. Robots with no wage are counted in the hours and left out
 *  of the money, and the count of them is reported so the owner can see the
 *  total is partial rather than wondering why it looks small. */
export function fleetInterventions(perRobot) {
  const rows = (perRobot ?? []).filter(Boolean);
  // Notable = worth a line of its own. Stalls alone would hide the robot whose
  // whole cost is somebody steering it: it has no stalls, so a clears-only
  // filter dropped it from the list while its money stayed in the total, and
  // the rows then failed to add up to the figure printed above them.
  const notable = rows.filter((r) => r.clears >= MIN_CLEARS || (r.manualHours ?? 0) >= 1);
  const priced = rows.filter((r) => r.totalCents !== null);

  const clears = rows.reduce((n, r) => n + r.clears, 0);
  const clearHours = rows.reduce((n, r) => n + r.clearHours, 0);
  const manualHours = rows.reduce((n, r) => n + (r.manualHours ?? 0), 0);
  const anyManual = rows.some((r) => r.manualHours !== null);

  return {
    clears,
    clearHours,
    clearCents: priced.length ? priced.reduce((n, r) => n + (r.clearCents ?? 0), 0) : null,
    manualHours: anyManual ? manualHours : null,
    manualCents: anyManual && priced.length ? priced.reduce((n, r) => n + (r.manualCents ?? 0), 0) : null,
    totalHours: clearHours + (anyManual ? manualHours : 0),
    totalCents: priced.length ? priced.reduce((n, r) => n + (r.totalCents ?? 0), 0) : null,
    stalledHours: rows.reduce((n, r) => n + r.stalledHours, 0),
    robotCount: rows.length,
    unpricedCount: rows.length - priced.length,
    anyBenchmarkWage: rows.some((r) => r.wageIsBenchmark && r.wageCentsHour !== null),
    hasManualFeed: rows.some((r) => r.hasManualFeed),
    // Worst first, because the point of the panel is which robot to go look at.
    worst: [...notable].sort((a, b) => b.totalHours - a.totalHours).slice(0, 5),
    // The panel is worth rendering at all only when somebody actually walked
    // over to a robot more than a handful of times.
    material: clears >= MIN_CLEARS,
  };
}

/** The sentence under the figure. Written here rather than in the template so
 *  the wording that explains a number lives beside the code that derives it. */
export function interventionSentence(f) {
  if (!f || !f.material) return null;
  const hrs = (h) => (h >= 10 ? Math.round(h).toLocaleString("en-US") : h.toFixed(1));
  const parts = [`${f.clears.toLocaleString("en-US")} stalls cleared by hand, about ${hrs(f.clearHours)} hours`];
  if (f.manualHours !== null && f.manualHours > 0.5) {
    parts.push(`${hrs(f.manualHours)} hours with someone driving the robot directly`);
  }
  return parts.join(", plus ") + ".";
}
