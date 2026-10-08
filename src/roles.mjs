// Who on an account may see and change what. The owner is whoever made the
// account. Owners invite managers and technicians by email; each signs in with
// their own link and lands in the owner's account.
//
//   owner       everything, and the only one who manages the team
//   manager     everything but the team
//   technician  read only, times and causes only: no dollar figure, ever
//
// "No dollar figure" is enforced here, on the server, by taking the figures
// out of every JSON answer and of the data written into the page, not by
// hiding them on screen. It fails closed: a field whose name says money keeps
// its shape but every value in it becomes null, and any string still carrying
// a dollar amount after that is blanked,
// so a figure added to the contract later cannot leak by being forgotten.

export const ROLES = ["owner", "manager", "technician"];
export const INVITABLE = ["manager", "technician"];

export const seesDollars = (role) => role === "owner" || role === "manager";
export const canWrite = (role) => role === "owner" || role === "manager";
export const canManageTeam = (role) => role === "owner";

// Field names that carry money, or a ratio of money to money, or the owner's
// prices and terms. Anything with "cents" in its name is money by this
// codebase's convention (every dollar amount is stored and sent as cents).
const MONEY_KEY = /cents/i;
const MONEY_KEYS = new Set([
  "cost", "costs", "derivation", "coverage", "coverageDelta", "siteCoverage", "payback", "contracts",
  "inputs", "rateHistory", "resaleShare", "installMultiple", "priceSource",
]);
const DOLLAR_TEXT = /\$\s?\d/;
export const HIDDEN = "[hidden for your role]";

// Inside a money field, the few things that are not money: what the arm is,
// how much of its time it worked, and whether its figures are estimates.
const NOT_MONEY = new Set(["arm", "armLabel", "workingPct", "hoursPerYear", "estimated"]);

/** Every value under a money field, emptied: the same keys and the same
 *  number of rows, so a page that reads the shape keeps working, and null
 *  where each figure was. */
function emptied(value) {
  if (Array.isArray(value)) return value.map(emptied);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).map((k) => [k, NOT_MONEY.has(k) ? redactDollars(value[k]) : emptied(value[k])]));
  return null;
}

/** A copy of `value` with every dollar figure taken out. */
export function redactDollars(value) {
  if (Array.isArray(value)) return value.map(redactDollars);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = MONEY_KEY.test(k) || MONEY_KEYS.has(k) ? emptied(v) : redactDollars(v);
    return out;
  }
  if (typeof value === "string" && DOLLAR_TEXT.test(value)) return HIDDEN;
  return value;
}

/** For a viewer who may not see dollars, wrap a response so every JSON body
 *  it sends is redacted on the way out, whichever route wrote it. Anything
 *  that claims to be JSON and is not is replaced with an error, never sent
 *  through as it was. */
export function redactJSONResponses(res) {
  const writeHead = res.writeHead.bind(res);
  const end = res.end.bind(res);
  let json = false;
  res.writeHead = (code, ...rest) => {
    const headers = rest.find((h) => h && typeof h === "object") ?? {};
    const type = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    json = /application\/json/i.test(String(type));
    if (json) for (const k of Object.keys(headers)) if (k.toLowerCase() === "content-length") delete headers[k];
    return writeHead(code, ...rest);
  };
  res.end = (body, ...rest) => {
    if (json && body !== undefined && body !== null && body !== "") {
      try {
        body = JSON.stringify(redactDollars(JSON.parse(String(body))));
      } catch {
        body = JSON.stringify({ error: "This answer could not be checked for your role, so it was not sent." });
      }
    }
    return end(body, ...rest);
  };
  return res;
}
