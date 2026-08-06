// Benchmark economics by robot category: what a unit of the robot's work costs
// to buy from a human or a service vendor, plus typical RaaS invoice and
// operating hours. These are the prefill values for onboarding, not truth. Every
// one is a v1 hypothesis the owner is expected to overwrite with their own
// numbers, exactly like the flag thresholds in rules.mjs.
//
// THE RULE: a rate prices the SERVICE PERFORMED, never the revenue touched. A
// tray run is worth what a runner charges to carry it, not the price of the
// food on it. Anything that would require knowing what the business would have
// done without the robot belongs nowhere in this file.

export const TASK_BASIS = {
  // tasks = sum(mission_count): discrete trips, priced per run
  MISSION: "mission",
  // tasks = sum(active_ms)/hour: continuous work, priced per hour. A scrubber on
  // one long cycle is one mission but hours of work, so mission counting would
  // undercount it by an order of magnitude.
  ACTIVE_HOUR: "active_hour",
};

// The rate is DERIVED, never asserted: loaded wage divided by how many of that
// task a person completes in an hour. An owner can check "$22.00/hr ÷ 30 runs
// per hour = $0.73 per run" on a napkin, which an unexplained "$1.25 benchmark"
// does not permit. Deriving it is what separates this from vendor ROI collateral.
export const BENCHMARKS = {
  delivery: {
    taskType: "tray_delivery",
    taskBasis: TASK_BASIS.MISSION,
    unit: "run",
    // A server or busser hand-carries roughly 30 trips an hour; loaded wage
    // ~$22/hr (BLS 35-3031 food serving, plus ~28% for payroll load).
    humanUnitsPerHour: 30,
    wageCentsHour: 2_200,
    // Bear Servi rental quotes in the reseller channel run $399/mo on a
    // 36-month term up to $999/mo month-to-month. $999 is the conservative end.
    invoiceCentsMonth: 99_900,
    operatingHoursDay: 12,
  },
  cleaning: {
    taskType: "cleaning_hour",
    taskBasis: TASK_BASIS.ACTIVE_HOUR,
    unit: "active hour",
    // One robot-hour of scrubbing is valued at one contracted human-hour. No
    // productivity multiplier is applied, which keeps the figure conservative.
    humanUnitsPerHour: 1,
    wageCentsHour: 2_500,
    invoiceCentsMonth: 80_000,
    operatingHoursDay: 8,
  },
};

/** rate = loaded wage / human throughput. Returns null for unknown work rather
 * than borrowing a rate from a different kind of job. */
export function derivedRateCents(category, wageCentsHour = null) {
  const b = BENCHMARKS[category];
  if (!b) return null;
  const wage = wageCentsHour ?? b.wageCentsHour;
  return Math.round(wage / b.humanUnitsPerHour);
}

/** The derivation, spelled out for the UI so the rate is auditable. */
export function rateDerivation(category, wageCentsHour = null) {
  const b = BENCHMARKS[category];
  if (!b) return null;
  const wage = wageCentsHour ?? b.wageCentsHour;
  const rate = derivedRateCents(category, wage);
  return `$${(rate / 100).toFixed(2)} per ${b.unit} = $${(wage / 100).toFixed(2)}/hr ÷ ${b.humanUnitsPerHour} ${b.unit}${b.humanUnitsPerHour === 1 ? "" : "s"} per hour`;
}

/** Benchmark economics for a robot, or null when its category has no benchmark.
 * Null is deliberate: an unpriced category must show "set your rate" rather than
 * inherit a number from an unrelated kind of work. */
export function defaultEconomicsFor(robot) {
  const b = BENCHMARKS[robot?.category];
  if (!b) return null;
  return {
    taskType: b.taskType,
    taskBasis: b.taskBasis,
    unit: b.unit,
    rateCents: derivedRateCents(robot.category),
    rateDerivation: rateDerivation(robot.category),
    invoiceCentsMonth: b.invoiceCentsMonth,
    wageCentsHour: b.wageCentsHour,
    operatingHoursDay: b.operatingHoursDay,
  };
}

/** Resolve the economics to use for a robot: the owner's stored row when it
 * exists, otherwise the benchmark. isDefault drives the "these are benchmark
 * numbers, set your real ones" affordance in the UI. Returns null when neither
 * exists, which callers must render as unconfigured rather than as zero. */
export function economicsFor(robot, storedRow) {
  if (storedRow) {
    return {
      taskType: storedRow.task_type,
      taskBasis: storedRow.task_basis,
      unit: BENCHMARKS[robot?.category]?.unit ?? "task",
      rateCents: storedRow.rate_cents,
      rateDerivation: null, // the owner set this figure, so it needs no derivation
      invoiceCentsMonth: storedRow.invoice_cents_month,
      wageCentsHour: storedRow.wage_cents_hour,
      operatingHoursDay: storedRow.operating_hours_day,
      isDefault: false,
    };
  }
  const d = defaultEconomicsFor(robot);
  return d ? { ...d, isDefault: true } : null;
}
