/** Brand against brand, inside the same kind of work.
 *
 *  This is the one comparison a robot manufacturer structurally cannot ship. A
 *  vendor dashboard can only ever see that vendor's machines, so it can tell an
 *  owner how their Servis are doing and can never tell them whether the Servis
 *  are the reason. Botlien sees the whole floor, so it can.
 *
 *  Two rules keep it honest, and both are visible in the output:
 *
 *  1. Comparison happens INSIDE a task type, never across. Cost per tray run
 *     and cost per cleaning hour are different units; a table that ranks them
 *     against each other produces a number with no dimension, which is the same
 *     reasoning byTaskType() already applies to the headline figure.
 *
 *  2. This is an observation, not an experiment. Two brands in one fleet are
 *     rarely running the same routes, shifts or floors, so the gap is reported
 *     with what would remove the doubt rather than as a verdict on the machine.
 */

const HOUR_MS = 3_600_000;

/** A brand carrying less work than this is in the table for completeness and is
 *  marked so it cannot be read as a finding: two thin rows can differ by 40% on
 *  noise alone.
 *
 *  There is deliberately NO minimum robot count. A brand represented by one
 *  machine is still that operator's real experience of the brand and hiding it
 *  would be editorialising. What it is not is proof about the brand, since one
 *  machine can simply be a lemon, so a single-machine brand is flagged and the
 *  panel says so in words rather than being quietly suppressed. */
export const MIN_TASKS_PER_BRAND = 20;

/** Group priced robots by task type, then by brand.
 *  Only task types carrying two or more named brands come back: a single-brand
 *  fleet has nothing to compare and gets no panel rather than a table of one. */
export function byBrand(robotViews) {
  const priced = (robotViews ?? []).filter((v) => v && v.fin && v.brand);
  const unbranded = (robotViews ?? []).filter((v) => v && v.fin && !v.brand).length;

  const byType = new Map();
  for (const v of priced) {
    const t = v.fin.taskType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(v);
  }

  const groups = [];
  for (const [taskType, members] of byType) {
    const brandNames = [...new Set(members.map((v) => v.brand))];
    if (brandNames.length < 2) continue;

    const brands = brandNames
      .map((brand) => {
        const rows = members.filter((v) => v.brand === brand);
        const tasks = rows.reduce((n, v) => n + v.fin.tasks, 0);
        const workCents = rows.reduce((n, v) => n + v.fin.workServicedCents, 0);
        const invoiceCents = rows.reduce((n, v) => n + (v.fin.invoiceProratedCents ?? 0), 0);
        const activeMs = rows.reduce((n, v) => n + (v.fin.activeMs ?? 0), 0);
        return {
          brand,
          robotCount: rows.length,
          robotNames: rows.map((v) => v.name),
          tasks,
          activeHours: activeMs / HOUR_MS,
          workCents,
          invoiceCents,
          // Same definitions as the rest of the statement, so a reader can
          // check a brand row against the robot rows it came from.
          costPerTaskCents: invoiceCents > 0 && tasks > 0 ? invoiceCents / tasks : null,
          coverage: invoiceCents > 0 ? workCents / invoiceCents : null,
          tasksPerActiveHour: activeMs > 0 ? tasks / (activeMs / HOUR_MS) : null,
          thin: tasks < MIN_TASKS_PER_BRAND,
          // One machine is an experience, not evidence about a brand.
          singleMachine: rows.length === 1,
        };
      })
      .filter((b) => b.costPerTaskCents !== null)
      .sort((a, b) => a.costPerTaskCents - b.costPerTaskCents);

    if (brands.length < 2) continue;

    const best = brands[0];
    const worst = brands[brands.length - 1];
    const solid = brands.filter((b) => !b.thin);

    groups.push({
      taskType,
      taskLabel: members[0].fin.taskLabel,
      unit: members[0].fin.unit,
      basis: members[0].fin.basis,
      brands,
      best,
      worst,
      // The spread only means something between two brands that each carry real
      // volume. Two thin rows can differ by 40% on noise alone.
      comparable: solid.length >= 2,
      gapCents: worst.costPerTaskCents - best.costPerTaskCents,
      gapPct: best.costPerTaskCents > 0 ? (worst.costPerTaskCents - best.costPerTaskCents) / best.costPerTaskCents : null,
      // What the gap is worth at the volumes actually observed. Stated as a
      // conditional in the UI, never as money already lost: closing it assumes
      // the difference is the machine rather than the route it was given.
      gapValueCents: Math.round((worst.costPerTaskCents - best.costPerTaskCents) * worst.tasks),
      // Named so the panel can say which side of the comparison rests on a
      // single machine, instead of presenting every row as equally settled.
      singleMachineBrands: brands.filter((b) => b.singleMachine).map((b) => b.brand),
    });
  }

  return { groups, unbranded };
}

/** The line under the table. Kept beside the derivation for the same reason as
 *  interventionSentence: the sentence and the number must not drift apart. */
export function brandSentence(g) {
  if (!g || !g.comparable) return null;
  const money = (c) => (c >= 100 ? `$${(c / 100).toFixed(2)}` : `${Math.round(c)} cents`);
  const pct = g.gapPct === null ? null : Math.round(g.gapPct * 100);
  return (
    `Your ${g.best.brand} machines do the same job for ${money(g.best.costPerTaskCents)} per ${g.unit}. ` +
    `Your ${g.worst.brand} machines cost ${money(g.worst.costPerTaskCents)}` +
    (pct === null ? "" : `, ${pct}% more`) +
    `.`
  );
}
