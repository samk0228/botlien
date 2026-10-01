// What a robot arm costs to own and run per scheduled hour, from the Overnight
// Line Benchmark v1.1 (Antonio, Sep 30 2026). This is the number manufacturing
// accounts lead with: no wages and no guessed product prices, only the robot's
// own price, how it was installed, how long it lasts and what it draws.
//
//   deployed      = arm price x (1 + install multiple)
//   ownership/hr  = (deployed - resale) / lifetime hours
//   maintenance/hr= arm price x maintenance share / hours per year
//   energy/hr     = watts / 1000 x electricity price per kWh
//   C             = ownership + maintenance + energy
//
// Then, with the share of scheduled time the robot is actually working:
//   cost per hour of real work = C / working share
//   idle cost per year         = C x hours per year x (1 - working share)
//   cost of a stop             = C x robot-minutes idle / 60
//
// Three inputs are judgment, not sourced (hours per year, resale, which
// install band a business falls in). Every figure built on these defaults is
// "estimated" until the owner enters their own price and schedule.

export const COST_DEFAULTS = {
  hoursPerYear: 4_000, // two shifts. Judgment.
  lifetimeYears: 7, // Universal Robots blog; Standard Bots 2026 guide
  lifetimeHours: 35_000,
  maintenanceShare: 0.05, // low end of 5% to 10%, Standard Bots 2026 guide
  resaleShare: 0.4, // used UR listings. Judgment.
  kwhCents: 9.77, // US EIA, July 2026, industrial rate
};

// List prices (Devonics; Vention for the UR30) and rated power (UR technical
// manuals). The benchmark gives no power figure for the UR30, so it borrows
// the UR20's 500 W and says so.
export const UR_ARMS = {
  ur3e: { label: "UR3e", priceCents: 3_301_100, watts: 150 },
  ur5e: { label: "UR5e", priceCents: 3_836_300, watts: 250 },
  ur10e: { label: "UR10e", priceCents: 4_959_600, watts: 350 },
  ur16e: { label: "UR16e", priceCents: 5_775_400, watts: 350 },
  ur20: { label: "UR20", priceCents: 6_299_000, watts: 500 },
  ur30: { label: "UR30", priceCents: 6_141_500, watts: 500, wattsAssumed: true },
};

// Integration on top of the arm, as a multiple of the arm's price.
export const INSTALL_BANDS = {
  simple: { multiple: 1.0, label: "simple cell" },
  complex: { multiple: 1.5, label: "complex cell" },
  welding: { multiple: 2.0, label: "welding cell" },
};

/** The catalog key for whatever a vendor or an owner calls the arm: "UR10e",
 *  "UR10", "ur 10e CB3" all read as the UR10e. Null for anything else, so an
 *  unknown arm falls back to the work's default rather than a wrong price. */
export function armFor(model) {
  const m = String(model ?? "").toLowerCase().replace(/[\s_-]/g, "").match(/^ur(30|20|16|10|5|3)/);
  if (!m) return null;
  const key = ["20", "30"].includes(m[1]) ? `ur${m[1]}` : `ur${m[1]}e`;
  return UR_ARMS[key] ? key : null;
}

/** C and its parts, in cents per hour (unrounded, so sums stay exact).
 *  Returns null when there is no price to build it from. */
export function robotCostPerHour({
  armPriceCents,
  installMultiple,
  watts,
  hoursPerYear = COST_DEFAULTS.hoursPerYear,
  lifetimeYears = COST_DEFAULTS.lifetimeYears,
  lifetimeHours = COST_DEFAULTS.lifetimeHours,
  maintenanceShare = COST_DEFAULTS.maintenanceShare,
  resaleShare = COST_DEFAULTS.resaleShare,
  kwhCents = COST_DEFAULTS.kwhCents,
}) {
  if (!(armPriceCents > 0) || !(installMultiple >= 0) || !(hoursPerYear > 0)) return null;
  const deployedCents = armPriceCents * (1 + installMultiple);
  // Whichever runs out first: the years or the hours.
  const lifeHours = Math.min(lifetimeYears * hoursPerYear, lifetimeHours);
  const ownership = (deployedCents - armPriceCents * resaleShare) / lifeHours;
  const maintenance = (armPriceCents * maintenanceShare) / hoursPerYear;
  const energy = ((watts ?? 0) / 1000) * kwhCents;
  return { deployedCents, lifeHours, ownership, maintenance, energy, perHour: ownership + maintenance + energy };
}

/** C / working share. Null when the robot never worked: an hour of real work
 *  that never happened has no cost, not an infinite one. */
export function costPerWorkingHour(perHourCents, workingShare) {
  return workingShare > 0 ? perHourCents / workingShare : null;
}

/** C x hours per year x share not working. The most an owner could win back,
 *  not a promise: some waiting is built into the line. */
export function idleCostPerYear(perHourCents, workingShare, hoursPerYear = COST_DEFAULTS.hoursPerYear) {
  if (workingShare === null || workingShare === undefined) return null;
  return perHourCents * hoursPerYear * Math.max(0, 1 - Math.min(1, workingShare));
}

/** A stop, priced: C x minutes idle / 60 for every robot it left idle. */
export function stopCost(idle) {
  return idle.reduce((sum, { perHourCents, minutes }) => sum + (perHourCents * minutes) / 60, 0);
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/** The one line that makes C checkable by hand. */
export function costDerivation(armLabel, cost) {
  return `${money(cost.perHour)} per scheduled hour = what a ${armLabel} costs to own and run, working or waiting (${money(cost.ownership)} ownership + ${money(cost.maintenance)} maintenance + ${money(cost.energy)} energy). Divide by the working share for the cost of an hour of real work.`;
}
