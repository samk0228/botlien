// Financial telemetry. Pure: (rollup rows for ONE robot, its economics, a time
// window) -> the four owner-facing numbers. No store dependency, no clock, so
// every figure is reproducible from its inputs and testable without a DB.
//
// WHAT THIS MODULE MAY CLAIM: the value of the SERVICE the robot performed,
// priced at what that unit of work costs to buy elsewhere, against what the
// owner pays to lease it.
//
// WHAT IT MAY NEVER CLAIM: revenue touched, profit, labor actually saved, or
// anything about what the business would look like without the robot. Those
// need payroll and POS data this pipeline does not have, and estimating them
// would put us in the same position as the vendor ROI marketing we exist to be
// an alternative to.
//
// COUNTING CAVEAT, stated once here and surfaced in the UI: mission_count in
// utilization_rollups counts idle -> active transitions, which are mission
// STARTS, not completions. Telemetry cannot tell us a run finished. So the
// count is labelled "runs started" everywhere and never "deliveries completed".

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Invoices are quoted per month; windows are arbitrary. A stated 30-day month
// keeps proration honest and reproducible rather than drifting with calendar
// length. It is a convention, so it is named, not hidden in a magic number.
export const MONTH_MS = 30 * DAY_MS;

export const TASK_LABEL = {
  mission: "runs started",
  active_hour: "active hours",
};

/** Tasks performed in a set of rollups, in the unit named by basis.
 * mission -> whole runs started. active_hour -> fractional hours of duty. */
export function taskCount(rollups, basis) {
  if (!rollups || rollups.length === 0) return 0;
  if (basis === "active_hour") {
    return rollups.reduce((sum, r) => sum + (r.active_ms ?? 0), 0) / HOUR_MS;
  }
  return rollups.reduce((sum, r) => sum + (r.mission_count ?? 0), 0);
}

/** Total duty milliseconds across rollups. */
export function activeMs(rollups) {
  if (!rollups || rollups.length === 0) return 0;
  return rollups.reduce((sum, r) => sum + (r.active_ms ?? 0), 0);
}

/** Monthly invoice scaled to the window actually measured. Null in, null out:
 * an owner who has not entered an invoice gets "unknown", never zero, because
 * zero would render as infinite coverage. */
export function proratedInvoiceCents(invoiceCentsMonth, windowMs) {
  if (invoiceCentsMonth === null || invoiceCentsMonth === undefined) return null;
  if (!(windowMs > 0)) return 0;
  return Math.round(invoiceCentsMonth * (windowMs / MONTH_MS));
}

/** Capacity is the time the owner says the robot is expected to be available,
 * not wall-clock time, so a 12-hour restaurant is not scored against 24 hours. */
export function capacityMs(operatingHoursDay, windowMs) {
  if (!(operatingHoursDay > 0) || !(windowMs > 0)) return null;
  return (operatingHoursDay / 24) * windowMs;
}

/** The full owner reading for one robot over one window.
 * Returns null when the robot has no economics at all: unconfigured must render
 * as unconfigured, never as a zeroed-out dashboard that looks like real data. */
export function robotFinancials(rollups, econ, { fromMs, toMs }) {
  if (!econ) return null;
  const windowMs = Math.max(0, toMs - fromMs);
  const basis = econ.taskBasis;
  const tasks = taskCount(rollups, basis);
  const duty = activeMs(rollups);

  const workCents = econ.rateCents > 0 ? Math.round(tasks * econ.rateCents) : 0;
  const invoiceCents = proratedInvoiceCents(econ.invoiceCentsMonth, windowMs);
  const capMs = capacityMs(econ.operatingHoursDay, windowMs);

  return {
    basis,
    taskType: econ.taskType,
    // The economics carry the vocabulary for their kind of work, so a warehouse
    // reads "picks started" where a restaurant reads "runs started". Falls back
    // to the generic label when none was supplied.
    taskLabel: econ.taskLabel ?? TASK_LABEL[basis] ?? "tasks",
    unit: econ.unit ?? "task",
    rateDerivation: econ.rateDerivation ?? null,
    tasks,
    rateCents: econ.rateCents,
    workServicedCents: workCents,
    invoiceCentsMonth: econ.invoiceCentsMonth ?? null,
    invoiceProratedCents: invoiceCents,
    // Coverage needs a real invoice to divide by. No invoice, or a zero one,
    // means the question "does it cover its cost" has no answer yet.
    coverage: invoiceCents > 0 ? workCents / invoiceCents : null,
    // Cost per task needs tasks to divide by, and a robot that did nothing has
    // an undefined cost per task, not a zero one.
    costPerTaskCents: invoiceCents !== null && tasks > 0 ? invoiceCents / tasks : null,
    // Labour-equivalent hours: work serviced expressed in hours of the person
    // who would otherwise do that specific task. It falls out of the rate
    // derivation for free, since rate = wage / throughput, so
    //   tasks x rate / wage = tasks / throughput = hours of that job.
    //
    // WHAT THIS IS NOT, and the UI says so next to it: headcount, FTEs, or
    // labour saved. A Servi that runs 400 trays does not remove a server, who
    // also takes orders, upsells, handles complaints, and closes. This is hours
    // of ONE task, and turning it into a robots-versus-employees verdict would
    // require knowing which human tasks were actually displaced, which is
    // exactly the leap the vendor ROI calculators make and the reason this
    // product exists as an alternative to them.
    laborEquivalentHours: econ.wageCentsHour > 0 ? workCents / econ.wageCentsHour : null,
    wageCentsHour: econ.wageCentsHour ?? null,
    wageIsBenchmark: econ.wageIsBenchmark === true,
    activeMs: duty,
    capacityMs: capMs,
    // Capacity is hours-per-day, not a schedule, so duty performed outside the
    // declared hours still lands in the numerator. That makes >100% reachable,
    // and it is reported rather than clamped: it means the declared operating
    // hours are wrong, which is a thing the owner should see and fix, not a
    // number to quietly cap at a tidy 100%.
    utilizationPct: capMs > 0 ? (duty / capMs) * 100 : null,
    overCapacity: capMs > 0 && duty > capMs,
    windowMs,
    isDefault: econ.isDefault === true,
  };
}

/** Work grouped by task type. Cost per task is only meaningful within a type:
 * tray runs and cleaning hours are different units, and adding them produces a
 * number with no dimension. A mixed fleet therefore gets a per-type table, and
 * cost per task is promoted to a headline figure only when one type exists. */
export function byTaskType(perRobot) {
  const groups = new Map();
  for (const f of (perRobot ?? []).filter(Boolean)) {
    if (!groups.has(f.taskType)) {
      groups.set(f.taskType, {
        taskType: f.taskType,
        taskLabel: f.taskLabel,
        unit: f.unit ?? "task",
        basis: f.basis,
        rateCents: f.rateCents,
        tasks: 0,
        workServicedCents: 0,
        invoiceProratedCents: 0,
        robotCount: 0,
      });
    }
    const g = groups.get(f.taskType);
    g.tasks += f.tasks;
    g.workServicedCents += f.workServicedCents;
    g.invoiceProratedCents += f.invoiceProratedCents ?? 0;
    g.robotCount += 1;
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      costPerTaskCents: g.tasks > 0 && g.invoiceProratedCents > 0 ? g.invoiceProratedCents / g.tasks : null,
      coverage: g.invoiceProratedCents > 0 ? g.workServicedCents / g.invoiceProratedCents : null,
    }))
    .sort((a, b) => b.workServicedCents - a.workServicedCents);
}

/** Fleet totals. Sums the numerator and the denominator, then divides once.
 * Averaging per-robot ratios would let an idle robot with a tiny invoice
 * outvote the fleet, which is how ratio dashboards lie. */
export function fleetFinancials(perRobot) {
  const rows = (perRobot ?? []).filter(Boolean);
  if (rows.length === 0) {
    return {
      robotCount: 0,
      configuredCount: 0,
      workServicedCents: 0,
      invoiceProratedCents: 0,
      coverage: null,
      laborEquivalentHours: null,
      laborHoursPartial: false,
      anyBenchmarkWage: false,
      activeMs: 0,
      capacityMs: 0,
      utilizationPct: null,
      anyDefault: false,
    };
  }
  const workCents = rows.reduce((s, r) => s + (r.workServicedCents ?? 0), 0);
  const invoiceCents = rows.reduce((s, r) => s + (r.invoiceProratedCents ?? 0), 0);
  const duty = rows.reduce((s, r) => s + (r.activeMs ?? 0), 0);
  const cap = rows.reduce((s, r) => s + (r.capacityMs ?? 0), 0);
  // Summed only across robots that HAVE a wage. A robot with no wage behind it
  // contributes no hours rather than zero hours, so the fleet total never
  // quietly understates itself by treating "unknown" as "none".
  const withWage = rows.filter((r) => r.laborEquivalentHours !== null);
  return {
    robotCount: rows.length,
    configuredCount: rows.length,
    workServicedCents: workCents,
    invoiceProratedCents: invoiceCents,
    coverage: invoiceCents > 0 ? workCents / invoiceCents : null,
    laborEquivalentHours: withWage.length > 0 ? withWage.reduce((s, r) => s + r.laborEquivalentHours, 0) : null,
    laborHoursPartial: withWage.length > 0 && withWage.length < rows.length,
    anyBenchmarkWage: rows.some((r) => r.wageIsBenchmark),
    activeMs: duty,
    capacityMs: cap,
    utilizationPct: cap > 0 ? (duty / cap) * 100 : null,
    overCapacity: cap > 0 && duty > cap,
    anyDefault: rows.some((r) => r.isDefault),
  };
}

/** The audit line under every figure: the arithmetic, spelled out, so an owner
 * can check it by hand. This transparency is the product, not decoration. */
export function formulaLine(f) {
  if (!f) return "not configured";
  const tasks = f.basis === "active_hour" ? f.tasks.toFixed(1) : String(Math.round(f.tasks));
  const rate = (f.rateCents / 100).toFixed(2);
  const work = (f.workServicedCents / 100).toFixed(2);
  const parts = [`${tasks} ${f.taskLabel} x $${rate} = $${work} of work serviced`];
  if (f.rateDerivation) parts.push(`rate ${f.rateDerivation}`);
  if (f.invoiceProratedCents !== null) {
    const days = Math.round(f.windowMs / DAY_MS);
    parts.push(`invoice $${(f.invoiceProratedCents / 100).toFixed(2)} (${days}d of $${((f.invoiceCentsMonth ?? 0) / 100).toFixed(2)}/mo)`);
  }
  if (f.coverage !== null) parts.push(`coverage ${f.coverage.toFixed(2)}x`);
  return parts.join(" · ");
}
