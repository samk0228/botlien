// What the owner types on the dashboard, kept. The page (the Demo served at
// /app) holds every edit in its state object; this module is the server's
// half: which keys may be saved, what each may hold, and where the ones the
// server's own math reads are written through to.
//
// Two shapes:
// - ROBOT keys are per robot. The page keys them by its row index; the
//   server keys them by robot id, so adding or removing a robot never moves
//   one robot's invoice onto another. The adapter translates both ways.
// - ACCOUNT keys are one value for the whole account.
//
// Invoice, hours and lease terms are also written to robot_economics and
// robot_contracts, because the server computes closed periods and (soon)
// sends the morning brief from those. Everything else is page state only.
import { economicsFor } from "./rates.mjs";

const MAX_VALUE_BYTES = 64 * 1024;

const num = (min, max) => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const str = (max) => (v) => typeof v === "string" && v.length <= max;
const dateKey = (v) => v === undefined || v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);

export const ROBOT_INPUTS = {
  robotInvoice: num(0, 1_000_000), // dollars a month
  robotHours: num(0, 24), // scheduled hours a day
  confirmWork: str(80), // the kind of work it does
  excluded: (v) => typeof v === "boolean",
  contract: (v) =>
    v !== null &&
    typeof v === "object" &&
    dateKey(v.start) &&
    ["term", "payback"].every((k) => v[k] === undefined || v[k] === null || num(0, 600)(v[k])) &&
    (v.uptime === undefined || v.uptime === null || num(0, 100)(v.uptime)),
};

export const ACCOUNT_INPUTS = [
  "workWage", "workThroughput", "customWork", "hiddenWork", "employees", "nextEmployeeId",
  "stallMinutes", "taxRate", "taxDepMethod", "taxInterestRate",
  "dashLayout", "dashHidden", "fixes", "plans", "briefSettings", "claims",
  "ownerName", "siteName", "businessName", "timezone", "avatarColor", "avatarIcon",
  // Names the owner gives stall spots: { siteSlug: { "x,y": "aisle 14" } }.
  "placeNames",
];

export class InputError extends Error {}

/** Everything saved, in the shape the contract carries: account values as
 *  they were sent, robot values keyed by robot id. */
export function loadInputs(store) {
  const out = { account: {}, robots: {} };
  for (const row of store.listInputs()) {
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (row.key.startsWith("robot.")) out.robots[row.key.slice(6)] = value;
    else if (row.key.startsWith("account.")) out.account[row.key.slice(8)] = value;
  }
  return out;
}

/** The rate each kind of work is valued at, as the page worked it out:
 *  { work: { cents, unit, own } }. cents is null while a throughput is blank. */
function validRates(rates) {
  if (rates === undefined || rates === null) return {};
  if (typeof rates !== "object" || Array.isArray(rates)) throw new InputError("rates must map work to a rate");
  const entries = Object.entries(rates);
  if (entries.length > 100) throw new InputError("rates has too many kinds of work");
  for (const [work, r] of entries) {
    const ok =
      work.length > 0 && work.length <= 80 &&
      r !== null && typeof r === "object" &&
      (r.cents === null || (Number.isInteger(r.cents) && r.cents >= 0 && r.cents <= 100_000_000)) &&
      str(20)(r.unit) && typeof r.own === "boolean";
    if (!ok) throw new InputError(`the rate for ${work} is not a value it can take`);
  }
  return rates;
}

/** Save a batch of changes. `changes.account` is { key: value }; `changes.robots`
 *  is { key: { robotId: value | null } }, null meaning "back to the default";
 *  `changes.rates` is the rate per kind of work the page is now using, logged
 *  to rate history (with `by`, who saved it) only where it changed.
 *  Rejects the whole batch if any part is unknown or out of range, so a page
 *  bug can never half-save. Returns the keys written. */
export function saveInputs(store, changes, nowMs, by = null) {
  const robotsById = new Map(store.listRobots().map((r) => [String(r.id), r]));
  const account = changes?.account ?? {};
  const robots = changes?.robots ?? {};
  const rates = validRates(changes?.rates);
  const writes = [];

  for (const [key, value] of Object.entries(account)) {
    if (!ACCOUNT_INPUTS.includes(key)) throw new InputError(`${key} is not something the dashboard saves`);
    const json = JSON.stringify(value ?? null);
    if (json.length > MAX_VALUE_BYTES) throw new InputError(`${key} is too large to save`);
    writes.push([`account.${key}`, json]);
  }

  const merged = {};
  for (const [key, byId] of Object.entries(robots)) {
    const valid = ROBOT_INPUTS[key];
    if (!valid) throw new InputError(`${key} is not something the dashboard saves`);
    if (!byId || typeof byId !== "object") throw new InputError(`${key} must map robots to values`);
    const current = loadInputs(store).robots[key] ?? {};
    const next = { ...current };
    for (const [id, value] of Object.entries(byId)) {
      if (!robotsById.has(String(id))) throw new InputError(`robot ${id} is not on this account`);
      if (value === null) delete next[id];
      else if (!valid(value)) throw new InputError(`${key} for robot ${id} is not a value it can take`);
      else next[id] = value;
    }
    merged[key] = next;
    writes.push([`robot.${key}`, JSON.stringify(next)]);
  }

  const rateKeys = [];
  store.transaction(() => {
    for (const [k, v] of writes) store.setInput(k, v, nowMs);
    writeThrough(store, robotsById, merged, robots, nowMs);
    for (const [work, r] of Object.entries(rates)) {
      const last = store.lastRateChange(work);
      if (last && last.cents === r.cents && last.unit === r.unit && Boolean(last.own) === r.own) continue;
      store.addRateChange({ work, cents: r.cents, unit: r.unit, own: r.own, by }, nowMs);
      rateKeys.push(`rate.${work}`);
    }
  });
  return writes.map(([k]) => k).concat(rateKeys);
}

/** Invoice and hours into robot_economics, lease terms into robot_contracts,
 *  for the robots this batch touched. */
function writeThrough(store, robotsById, merged, touched, nowMs) {
  const econIds = new Set([...Object.keys(touched.robotInvoice ?? {}), ...Object.keys(touched.robotHours ?? {})]);
  const stored = new Map(store.listRobotEconomics().map((e) => [String(e.robot_id), e]));
  for (const id of econIds) {
    const robot = robotsById.get(id);
    const base = economicsFor(robot, stored.get(id) ?? null);
    if (!base) continue;
    const invoice = merged.robotInvoice?.[id];
    const hours = merged.robotHours?.[id];
    store.upsertRobotEconomics(
      robot.id,
      {
        taskType: base.taskType,
        taskBasis: base.taskBasis,
        rateCents: base.rateCents,
        invoiceCentsMonth: invoice !== undefined ? Math.round(invoice * 100) : base.invoiceCentsMonth,
        wageCentsHour: stored.get(id)?.wage_cents_hour ?? null,
        operatingHoursDay: hours !== undefined ? hours : base.operatingHoursDay,
      },
      nowMs
    );
  }
  for (const id of Object.keys(touched.contract ?? {})) {
    const c = merged.contract?.[id];
    // The page edits a lease one field at a time and fills the rest from its
    // default. Only a lease the owner has fully stated reaches the server's
    // table; a partial one stays page state, so no half-typed lease is ever
    // read as real terms.
    if (!c || ["start", "term", "payback", "uptime"].some((k) => c[k] === undefined || c[k] === null)) continue;
    store.upsertRobotContract(Number(id), { startDate: c.start ?? null, termMonths: c.term ?? null, paybackMonths: c.payback ?? null, uptimePct: c.uptime ?? null }, nowMs);
  }
}
