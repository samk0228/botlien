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
//
// Manufacturing is the exception that proves it. A CNC tender's work has no
// honest per-unit human price (the benchmark refused to guess product values),
// so an arm's working hour is priced at what the arm itself costs per hour
// (robot-cost.mjs). Coverage then reads as the share of the robot's cost that
// turned into work, and the rest is idle cost. Value per part is an optional
// layer the owner adds on top.
import { UR_ARMS, INSTALL_BANDS, COST_DEFAULTS, armFor, robotCostPerHour, costDerivation } from "./robot-cost.mjs";

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
// Every kind of work a robot can do, keyed by the value stored in
// robots.category. `delivery` and `cleaning` keep their original ids and rates
// so existing databases keep reading correctly.
// What a robot for each kind of work costs to buy, in cents: the price payback
// is measured against when the owner has not entered their own. The same
// figures as the dashboard's EQUIP_COST.
export const EQUIP_COST_CENTS = {
  delivery: 1_800_000,
  bussing: 1_800_000,
  cleaning: 2_800_000,
  picking: 3_200_000,
  putaway: 3_200_000,
  room_delivery: 1_800_000,
  laundry: 2_200_000,
  // Deployed cost of each work's default arm and install band: a UR10e in a
  // complex cell, and a UR10e in a welding cell.
  machine_tending: 12_399_000,
  welding: 14_878_800,
};

export const BENCHMARKS = {
  delivery: {
    label: "Tray or food delivery",
    taskType: "tray_delivery",
    taskBasis: TASK_BASIS.MISSION,
    unit: "run",
    unitPlural: "runs",
    // A server or busser hand-carries roughly 30 trips an hour; loaded wage
    // ~$22/hr (BLS 35-3031 food serving, plus ~28% for payroll load).
    humanUnitsPerHour: 30,
    wageCentsHour: 2_200,
    // Bear Servi rental quotes in the reseller channel run $399/mo on a
    // 36-month term up to $999/mo month-to-month. $999 is the conservative end.
    invoiceCentsMonth: 99_900,
    operatingHoursDay: 12,
  },
  bussing: {
    label: "Bussing and dish return",
    taskType: "bus_run",
    taskBasis: TASK_BASIS.MISSION,
    unit: "run",
    unitPlural: "runs",
    // Same wage, fewer trips per hour: a loaded bus tub moves slower than a tray.
    humanUnitsPerHour: 25,
    wageCentsHour: 2_200,
    invoiceCentsMonth: 99_900,
    operatingHoursDay: 12,
  },
  cleaning: {
    label: "Floor cleaning",
    taskType: "cleaning_hour",
    taskBasis: TASK_BASIS.ACTIVE_HOUR,
    unit: "active hour",
    unitPlural: "active hours",
    // One robot-hour of scrubbing is valued at one contracted human-hour. No
    // productivity multiplier is applied, which keeps the figure conservative.
    humanUnitsPerHour: 1,
    wageCentsHour: 2_500,
    invoiceCentsMonth: 80_000,
    operatingHoursDay: 8,
  },
  picking: {
    label: "Order picking",
    taskType: "pick",
    taskBasis: TASK_BASIS.MISSION,
    unit: "pick",
    unitPlural: "picks",
    // Warehouse associate ~$18.50/hr (BLS 53-7065) plus ~28% load, and roughly
    // 60 picks an hour on a manual cart.
    humanUnitsPerHour: 60,
    wageCentsHour: 2_400,
    // Warehouse AMRs lease well above hospitality robots.
    invoiceCentsMonth: 150_000,
    operatingHoursDay: 16,
  },
  putaway: {
    label: "Putaway and replenishment",
    taskType: "putaway",
    taskBasis: TASK_BASIS.MISSION,
    unit: "move",
    unitPlural: "moves",
    humanUnitsPerHour: 40,
    wageCentsHour: 2_400,
    invoiceCentsMonth: 150_000,
    operatingHoursDay: 16,
  },
  room_delivery: {
    label: "Room and guest delivery",
    taskType: "room_delivery",
    taskBasis: TASK_BASIS.MISSION,
    unit: "delivery",
    unitPlural: "deliveries",
    // Hotel attendant ~$20/hr loaded. Far fewer trips per hour than a dining
    // room: corridors, elevators, and a door knock each cost minutes.
    humanUnitsPerHour: 12,
    wageCentsHour: 2_000,
    invoiceCentsMonth: 99_900,
    operatingHoursDay: 24,
  },
  laundry: {
    label: "Laundry handling",
    taskType: "laundry_hour",
    taskBasis: TASK_BASIS.ACTIVE_HOUR,
    unit: "active hour",
    unitPlural: "active hours",
    humanUnitsPerHour: 1,
    wageCentsHour: 1_900,
    invoiceCentsMonth: 90_000,
    operatingHoursDay: 16,
  },
  // Robot arms. No wage and no throughput: the unit is an hour the arm spent
  // working, priced at the arm's own cost per hour (see costModel). The
  // invoice is that same cost over a month of scheduled hours, so an arm that
  // works every scheduled hour covers exactly 1.00x. operatingHoursDay is the
  // benchmark's 4,000 hours a year over 250 working days.
  machine_tending: {
    label: "CNC machine tending",
    taskType: "tending_hour",
    taskBasis: TASK_BASIS.ACTIVE_HOUR,
    unit: "working hour",
    unitPlural: "working hours",
    humanUnitsPerHour: 1,
    wageCentsHour: null,
    costModel: { arm: "ur10e", install: "complex" },
    operatingHoursDay: 16,
  },
  welding: {
    label: "Robotic welding",
    taskType: "welding_hour",
    taskBasis: TASK_BASIS.ACTIVE_HOUR,
    unit: "working hour",
    unitPlural: "working hours",
    humanUnitsPerHour: 1,
    wageCentsHour: null,
    costModel: { arm: "ur10e", install: "welding" },
    operatingHoursDay: 16,
  },
};

/** The cost model behind a robot-arm work, with the owner's overrides laid
 *  over the defaults: which arm (from the robot's model when it names a UR),
 *  its price, the install multiple, hours a year, and its resale share. Null for work priced
 *  per unit. `estimated` stays true until the owner has given a price and a
 *  schedule of their own, which is the benchmark's rule for showing it. */
export function robotCostFor(category, model = null, own = null) {
  const cm = BENCHMARKS[category]?.costModel;
  if (!cm) return null;
  const arm = armFor(own?.arm) ?? armFor(model) ?? cm.arm;
  const spec = UR_ARMS[arm];
  const installMultiple = own?.install ?? INSTALL_BANDS[cm.install].multiple;
  const armPriceCents = own?.armPrice > 0 ? Math.round(own.armPrice * 100) : spec.priceCents;
  const hoursPerYear = own?.hoursYear ?? COST_DEFAULTS.hoursPerYear;
  const resaleShare = own?.resale ?? COST_DEFAULTS.resaleShare;
  const cost = robotCostPerHour({ armPriceCents, installMultiple, watts: spec.watts, hoursPerYear, resaleShare });
  return {
    arm,
    armLabel: spec.label,
    armPriceCents,
    installMultiple,
    hoursPerYear,
    resaleShare,
    ...cost,
    derivation: costDerivation(spec.label, cost),
    estimated: !(own?.armPrice > 0 && own?.hoursYear > 0),
  };
}

// The invoice for a robot-cost work is its cost over a month of scheduled
// hours; filled in here so every benchmark row still carries one.
for (const [k, b] of Object.entries(BENCHMARKS)) {
  if (b.costModel) b.invoiceCentsMonth = Math.round((robotCostFor(k).perHour * COST_DEFAULTS.hoursPerYear) / 12);
}

// What kind of business the owner runs. This is the ONE thing a telemetry export
// cannot tell us: nothing in a status stream distinguishes a restaurant from a
// warehouse. Everything else (how many robots, which brands, how much volume,
// over what period) comes from the file, so we do not ask it.
//
// The answer selects which kinds of work are offered and what the defaults are,
// which is why it is worth one screen before the upload.
export const BUSINESS_TYPES = {
  // First: UR manufacturing is the first customer (decided 9/30/26).
  manufacturing: {
    label: "Manufacturing",
    blurb: "Robot arms tending CNC machines or welding. Priced from what each arm costs to own and run.",
    works: ["machine_tending", "welding"],
    defaultWork: "machine_tending",
    exportHint: "your Universal Robots arms",
  },
  restaurant: {
    label: "Restaurant, cafe, or bar",
    blurb: "Robots running trays, bussing, or cleaning the floor after service.",
    works: ["delivery", "bussing", "cleaning"],
    defaultWork: "delivery",
    exportHint: "Bear Universe or Pudu Cloud",
  },
  warehouse: {
    label: "Warehouse or e-commerce",
    blurb: "Robots picking orders, replenishing, or moving inventory.",
    works: ["picking", "putaway", "cleaning"],
    defaultWork: "picking",
    exportHint: "your WMS or robot fleet console",
  },
  hotel: {
    label: "Hotel or hospitality",
    blurb: "Robots delivering to rooms, moving laundry, or cleaning common areas.",
    works: ["room_delivery", "laundry", "cleaning"],
    defaultWork: "room_delivery",
    exportHint: "Bear Universe, Keenon, or Pudu Cloud",
  },
  facilities: {
    label: "Cleaning or facilities services",
    blurb: "Scrubbers and sweepers you run on your own sites or a client's.",
    works: ["cleaning"],
    defaultWork: "cleaning",
    exportHint: "Gausium, Pudu, or Tennant",
  },
  other: {
    label: "Something else",
    blurb: "We will offer every kind of work and you can pick per robot.",
    works: Object.keys(BENCHMARKS ?? {}),
    defaultWork: "delivery",
    exportHint: "your robot vendor's console",
  },
};
// `other` offers everything; assigned after BENCHMARKS exists so the key list
// stays in one place.
BUSINESS_TYPES.other.works = Object.keys(BENCHMARKS);

export const DEFAULT_BUSINESS = "restaurant";

/** The kinds of work to offer for a business, always a real list. */
export function worksFor(businessType) {
  return (BUSINESS_TYPES[businessType] ?? BUSINESS_TYPES[DEFAULT_BUSINESS]).works;
}

/** What a newly imported robot should be assumed to do, before the owner
 * corrects it on the confirm screen. */
export function defaultWorkFor(businessType) {
  return (BUSINESS_TYPES[businessType] ?? BUSINESS_TYPES[DEFAULT_BUSINESS]).defaultWork;
}

/** What answering this question actually buys the owner: the kinds of work we
 * will offer and what a unit of the main one is worth, with its derivation.
 *
 * The question is only worth asking if the owner can see what it changes, so
 * this is shown on the screen itself rather than discovered three steps later. */
export function businessPreview(businessType) {
  const b = BUSINESS_TYPES[businessType];
  if (!b) return null;
  const main = BENCHMARKS[b.defaultWork];
  return {
    key: businessType,
    label: b.label,
    blurb: b.blurb,
    exportHint: b.exportHint,
    works: b.works.map((w) => BENCHMARKS[w].label),
    unit: main.unit,
    rateCents: derivedRateCents(b.defaultWork),
    derivation: rateDerivation(b.defaultWork),
    // Manufacturing leads with the arm's cost per hour, not a rate per unit.
    costBasis: main.costModel ? "robot" : "labor",
    operatingHoursDay: main.operatingHoursDay,
  };
}

/** rate = loaded wage / human throughput. Returns null for unknown work rather
 * than borrowing a rate from a different kind of job. */
export function derivedRateCents(category, wageCentsHour = null) {
  const b = BENCHMARKS[category];
  if (!b) return null;
  if (b.costModel) return Math.round(robotCostFor(category).perHour);
  const wage = wageCentsHour ?? b.wageCentsHour;
  return Math.round(wage / b.humanUnitsPerHour);
}

/** The derivation, spelled out for the UI so the rate is auditable. */
export function rateDerivation(category, wageCentsHour = null) {
  const b = BENCHMARKS[category];
  if (!b) return null;
  if (b.costModel) return robotCostFor(category).derivation;
  const wage = wageCentsHour ?? b.wageCentsHour;
  const rate = derivedRateCents(category, wage);
  const money = (c) => `$${(c / 100).toFixed(2)}`;

  // Time-based work has no throughput to divide by: one robot-hour is valued at
  // one contracted human-hour, and "÷ 1 active hour per hour" reads as nonsense.
  if (b.taskBasis === TASK_BASIS.ACTIVE_HOUR) {
    return `${money(rate)} per ${b.unit} = one contracted human-hour at ${money(wage)}/hr`;
  }
  // unitPlural rather than unit + "s", which produced "deliverys".
  return `${money(rate)} per ${b.unit} = ${money(wage)}/hr ÷ ${b.humanUnitsPerHour} ${b.unitPlural} per hour`;
}

/** Benchmark economics for a robot, or null when its category has no benchmark.
 * Null is deliberate: an unpriced category must show "set your rate" rather than
 * inherit a number from an unrelated kind of work. */
export function defaultEconomicsFor(robot, ownCost = null) {
  const b = BENCHMARKS[robot?.category];
  if (!b) return null;
  // An arm is priced from its own model and the owner's figures, per robot.
  const cost = robotCostFor(robot.category, robot.model, ownCost);
  if (cost) {
    return {
      taskType: b.taskType,
      taskBasis: b.taskBasis,
      unit: b.unit,
      taskLabel: taskLabelFor(robot.category),
      rateCents: Math.round(cost.perHour),
      rateDerivation: cost.derivation,
      invoiceCentsMonth: Math.round((cost.perHour * cost.hoursPerYear) / 12),
      wageCentsHour: null,
      operatingHoursDay: b.operatingHoursDay,
    };
  }
  return {
    taskType: b.taskType,
    taskBasis: b.taskBasis,
    unit: b.unit,
    // The vocabulary follows the work: a warehouse reads "picks started", not
    // "runs started". Carried on the economics so finance.mjs stays pure and
    // never needs to know this catalog exists.
    taskLabel: taskLabelFor(robot.category),
    rateCents: derivedRateCents(robot.category),
    rateDerivation: rateDerivation(robot.category),
    invoiceCentsMonth: b.invoiceCentsMonth,
    wageCentsHour: b.wageCentsHour,
    operatingHoursDay: b.operatingHoursDay,
  };
}

/** How a count of this work reads in a sentence. Mission-based work is always
 * "started", never "completed": telemetry reports a mission beginning and
 * cannot show that it finished. */
export function taskLabelFor(category) {
  const b = BENCHMARKS[category];
  if (!b) return "tasks";
  return b.taskBasis === TASK_BASIS.ACTIVE_HOUR ? b.unitPlural : `${b.unitPlural} started`;
}

/** Resolve the economics to use for a robot: the owner's stored row when it
 * exists, otherwise the benchmark. isDefault drives the "these are benchmark
 * numbers, set your real ones" affordance in the UI. Returns null when neither
 * exists, which callers must render as unconfigured rather than as zero. */
export function economicsFor(robot, storedRow, ownCost = null) {
  if (storedRow) {
    // The wage is the one optional field on the setup form, and it is the
    // divisor behind the labour-equivalent hours line. Falling back to the
    // benchmark keeps that line available for an owner who skipped the field,
    // but the fallback is FLAGGED rather than silent: "63 hours at your $24"
    // and "63 hours at a benchmark $22" are different claims and the UI has to
    // be able to tell them apart.
    const benchWage = BENCHMARKS[robot?.category]?.wageCentsHour ?? null;
    const ownWage = storedRow.wage_cents_hour;
    return {
      taskType: storedRow.task_type,
      taskBasis: storedRow.task_basis,
      unit: BENCHMARKS[robot?.category]?.unit ?? "task",
      taskLabel: taskLabelFor(robot?.category),
      rateCents: storedRow.rate_cents,
      rateDerivation: null, // the owner set this figure, so it needs no derivation
      invoiceCentsMonth: storedRow.invoice_cents_month,
      wageCentsHour: ownWage ?? benchWage,
      wageIsBenchmark: !(ownWage > 0) && benchWage > 0,
      operatingHoursDay: storedRow.operating_hours_day,
      isDefault: false,
    };
  }
  const d = defaultEconomicsFor(robot, ownCost);
  return d ? { ...d, isDefault: true } : null;
}
