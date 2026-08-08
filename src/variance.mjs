// Variance decomposition: why the coverage number moved.
//
// A dashboard that says "coverage is 1.4x" when it said 2.3x last month has
// raised a question and refused to answer it. This module answers it, and the
// answer is arithmetic rather than narrative: the change splits into effects
// that sum EXACTLY to the total change, so an owner can see the whole gap
// accounted for and nothing hand-waved into a residual.
//
// THE MODEL. Work performed is
//
//     W = R x H x I
//
//   R  rate, what one unit of that work costs to buy elsewhere
//   H  online hours, the robot reachable and available
//   I  intensity, units of work per online hour
//
// A chain decomposition between a prior period (0) and the current one (1):
//
//   availability = R0 x I0 x (H1 - H0)      it was up for more or less time
//   intensity    = R0 x H1 x (I1 - I0)      it did more or less per hour it was up
//   rate         = (R1 - R0) x H1 x I1      the work is worth more or less
//
// These sum to W1 - W0 identically, no residual term. Coverage is W / V for
// invoice V, so the coverage change decomposes as
//
//   from work    = (W1 - W0) / V0
//   from invoice = W1 x (1/V1 - 1/V0)
//
// which likewise sums exactly to W1/V1 - W0/V0.
//
// ONE HONEST LIMITATION, STATED IN THE UI TOO. robot_economics keeps one
// current row per robot with no rate history, so R0 and R1 are always the same
// number and the rate effect is structurally zero. That is not a bug to route
// around, it is a property worth knowing: when an owner edits their replacement
// rate or invoice on the setup screen, BOTH periods are restated at the new
// number and the comparison stays internally consistent. What it cannot do is
// tell you that your rate changed in March. Rate history is the fix, and it is
// not built.
//
// The same decomposition is what a lender needs. A robot decaying through the
// availability channel is an asset-condition story, one decaying through
// intensity while fully online is a demand story about the operator's business.
// Those are LGD and PD respectively, which is why this lives in its own module
// and not inside the owner renderer.
import { taskCount, proratedInvoiceCents, MONTH_MS } from "./finance.mjs";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Below this there is not enough prior period to compare against, and a
// confident "coverage fell 40%" computed off six hours of history is worse
// than showing nothing.
const MIN_PRIOR_HOURS = 72;

/** One period reduced to the four quantities the decomposition needs. Pure. */
export function periodStats(rollups, econ, { fromMs, toMs }) {
  const windowMs = Math.max(0, toMs - fromMs);
  const onlineMs = (rollups ?? []).reduce((s, r) => s + (r.online_ms ?? 0), 0);
  const activeMs = (rollups ?? []).reduce((s, r) => s + (r.active_ms ?? 0), 0);
  const tasks = taskCount(rollups, econ?.taskBasis);
  const onlineHours = onlineMs / HOUR_MS;
  const rateCents = econ?.rateCents ?? 0;
  const workCents = rateCents > 0 ? tasks * rateCents : 0;
  const invoiceCents = proratedInvoiceCents(econ?.invoiceCentsMonth ?? null, windowMs);
  return {
    fromMs,
    toMs,
    windowMs,
    onlineHours,
    activeHours: activeMs / HOUR_MS,
    tasks,
    // Intensity is undefined, not zero, for a robot that was never online: it
    // did not work slowly, it was not there. Zero would make the intensity term
    // absorb an outage that belongs entirely to availability.
    intensity: onlineHours > 0 ? tasks / onlineHours : null,
    rateCents,
    workCents,
    invoiceCents,
    coverage: invoiceCents > 0 ? workCents / invoiceCents : null,
  };
}

/** Split the change in work between two periods for ONE robot. Dollars, which
 * unlike coverage ratios are additive across a fleet. */
export function decomposeWork(prior, current) {
  const I0 = prior.intensity ?? 0;
  const I1 = current.intensity ?? 0;
  const availabilityCents = prior.rateCents * I0 * (current.onlineHours - prior.onlineHours);
  const intensityCents = prior.rateCents * current.onlineHours * (I1 - I0);
  const rateCents = (current.rateCents - prior.rateCents) * current.onlineHours * I1;
  return {
    availabilityCents,
    intensityCents,
    rateCents,
    totalCents: current.workCents - prior.workCents,
    // Guard rather than trust: if these ever stop summing, the decomposition is
    // lying and the caller must not render it as if it were complete.
    exact: Math.abs(availabilityCents + intensityCents + rateCents - (current.workCents - prior.workCents)) < 1,
  };
}

/** Fleet-level variance: the coverage move, fully attributed.
 *
 * `perRobot` is [{ robot, priorStats, currentStats }]. Assembled by the caller
 * so this module never touches the store and can be tested against fixtures. */
export function decomposeCoverage(perRobot, { periodDays = null } = {}) {
  const rows = (perRobot ?? []).filter((r) => r.priorStats && r.currentStats);
  if (rows.length === 0) return null;

  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const priorWork = sum((r) => r.priorStats.workCents);
  const currentWork = sum((r) => r.currentStats.workCents);
  const priorInvoice = sum((r) => r.priorStats.invoiceCents ?? 0);
  const currentInvoice = sum((r) => r.currentStats.invoiceCents ?? 0);
  const priorOnlineHours = sum((r) => r.priorStats.onlineHours);

  // No prior invoice means no prior coverage to have moved away from.
  if (!(priorInvoice > 0) || !(currentInvoice > 0)) return null;
  if (priorOnlineHours < MIN_PRIOR_HOURS) return null;

  const priorCoverage = priorWork / priorInvoice;
  const currentCoverage = currentWork / currentInvoice;

  const parts = rows.map((r) => ({ robot: r.robot, ...decomposeWork(r.priorStats, r.currentStats) }));
  const availabilityCents = parts.reduce((s, p) => s + p.availabilityCents, 0);
  const intensityCents = parts.reduce((s, p) => s + p.intensityCents, 0);
  const rateWorkCents = parts.reduce((s, p) => s + p.rateCents, 0);

  // Coverage units. Work effects divide by the PRIOR invoice; the invoice
  // effect carries the whole of the denominator change, which is what makes
  // the four terms sum to the total exactly rather than approximately.
  const effects = [
    {
      key: "availability",
      label: "hours online",
      coverage: availabilityCents / priorInvoice,
      workCents: availabilityCents,
      explain: "the robots were reachable and available for more or fewer hours",
    },
    {
      key: "intensity",
      label: "work per hour online",
      coverage: intensityCents / priorInvoice,
      workCents: intensityCents,
      explain: "for every hour they were up, they got through more or less work",
    },
    {
      key: "rate",
      label: "replacement rate",
      coverage: rateWorkCents / priorInvoice,
      workCents: rateWorkCents,
      explain: "what a unit of that work is worth changed",
    },
    {
      key: "invoice",
      label: "invoiced amount",
      coverage: currentWork * (1 / currentInvoice - 1 / priorInvoice),
      workCents: -(currentInvoice - priorInvoice),
      explain: "you were billed for a different amount, or over a different number of days",
    },
  ];

  const totalChange = currentCoverage - priorCoverage;
  const attributed = effects.reduce((s, e) => s + e.coverage, 0);

  // Which robots moved the dollars. Ranked by absolute contribution because the
  // one that fell hardest and the one that saved the month are equally worth
  // naming.
  const contributors = parts
    .map((p) => ({
      name: p.robot.name,
      robotId: p.robot.id,
      workCents: p.totalCents,
      availabilityCents: p.availabilityCents,
      intensityCents: p.intensityCents,
      driver: Math.abs(p.availabilityCents) >= Math.abs(p.intensityCents) ? "availability" : "intensity",
    }))
    .sort((a, b) => Math.abs(b.workCents) - Math.abs(a.workCents));

  return {
    priorCoverage,
    currentCoverage,
    totalChange,
    priorWorkCents: priorWork,
    currentWorkCents: currentWork,
    priorInvoiceCents: priorInvoice,
    currentInvoiceCents: currentInvoice,
    periodDays,
    effects: effects.filter((e) => Math.abs(e.coverage) >= 0.005),
    // Kept so the renderer can refuse to draw a decomposition that does not add
    // up, rather than showing bars that silently miss a chunk of the move.
    attributedChange: attributed,
    exact: Math.abs(attributed - totalChange) < 0.005,
    contributors: contributors.slice(0, 4),
    direction: totalChange >= 0 ? "up" : "down",
  };
}

/** The whole thing as one sentence, which is how an owner will actually read
 * it. Accounting vocabulary ("unfavourable volume variance") is precise and
 * unreadable; this says the same thing in the words a manager would use. */
export function varianceSentence(v) {
  if (!v) return null;
  const dir = v.direction === "up" ? "rose" : "fell";
  const span = v.periodDays ? `${Math.round(v.periodDays)} days` : "period";
  const head =
    `Over the last ${span}, coverage ${dir} from ${v.priorCoverage.toFixed(2)}x to ${v.currentCoverage.toFixed(2)}x ` +
    `against the ${span} before.`;

  const ranked = [...v.effects].sort((a, b) => Math.abs(b.coverage) - Math.abs(a.coverage));
  const top = ranked[0];
  if (!top || Math.abs(v.totalChange) < 0.01) return `${head} Nothing moved enough to explain.`;

  const naming = {
    availability: "hours the robots were online",
    intensity: "how much they got through per hour online",
    rate: "the replacement rate",
    invoice: "the invoiced amount",
  };

  // Shares only make sense when every effect pushes the same way. When one
  // pulls the other way the parts exceed the whole, and the arithmetically
  // correct sentence is "110% of the fall was availability, and intensity gave
  // 10% back", which reads as a broken number however true it is. Offsetting
  // moves are stated in coverage points instead.
  const sign = Math.sign(v.totalChange);
  const material = ranked.filter((e) => Math.abs(e.coverage) >= 0.005);
  const offsetting = material.some((e) => Math.sign(e.coverage) !== sign);

  let body;
  if (offsetting) {
    body = `${material
      .slice(0, 3)
      .map((e) => `${naming[e.key]} ${e.coverage < 0 ? "cost" : "added back"} ${Math.abs(e.coverage).toFixed(2)}x`)
      .join(", and ")}.`;
  } else {
    const shareOf = (e) => Math.round((Math.abs(e.coverage) / Math.abs(v.totalChange)) * 100);
    const pieces = [`${shareOf(top)}% of that is ${naming[top.key]}`];
    if (ranked[1] && shareOf(ranked[1]) >= 15) pieces.push(`${shareOf(ranked[1])}% is ${naming[ranked[1].key]}`);
    body = `${pieces.join(", and ")}.`;
  }

  const who = v.contributors[0];
  const tail = who && Math.abs(who.workCents) > 0 ? ` ${who.name} accounts for the largest single share.` : "";

  return `${head} ${body}${tail}`;
}

export { MIN_PRIOR_HOURS, HOUR_MS, DAY_MS, MONTH_MS };
