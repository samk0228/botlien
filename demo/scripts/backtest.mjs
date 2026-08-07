// The retrospective backtest: THE question this company lives or dies on —
// does telemetry decline precede payment trouble?
//
//   node scripts/backtest.mjs --telemetry export.csv --outcomes outcomes.csv \
//        [--lead-days 30] [--step-min 360] [--out report.json]
//
// Imports an operator's historical telemetry + outcomes into a throwaway
// in-memory store, replays history through the SAME flag rules live data
// uses (virtual clock, no code differences), then measures whether flags
// preceded outcomes. Exit code 0; the numbers speak for themselves.
import { writeFileSync } from "node:fs";
import { openStore } from "../src/store.mjs";
import { createEngine } from "../src/engine.mjs";
import { importTelemetry, importOutcomes } from "../src/importer.mjs";
import { loadConfig } from "../src/infra.mjs";

const DAY = 86_400_000;
const MIN = 60_000;

/** Replay history through the flag engine on a stepped virtual clock.
 * The replay STOPS at the last snapshot: stepping past the end of the dataset
 * makes every robot look dead (no recent data ⇒ utilization "drops" to zero),
 * which is an artifact of the export ending, not a signal. */
export async function runBacktest(store, config, { stepMs = 6 * 60 * MIN } = {}) {
  const range = store.snapshotTimeRange();
  if (!range) throw new Error("no snapshots in store — import telemetry first");
  const engine = createEngine({ store, connectors: [], config });
  let steps = 0;
  for (let t = range.minAt; t <= range.maxAt; t += stepMs) {
    await engine.runOnce(t);
    steps += 1;
  }
  return { from: range.minAt, to: range.maxAt, steps };
}

/** Pure analysis over the replayed store. */
export function analyzeBacktest(store, { leadDays = 30 } = {}) {
  const leadMs = leadDays * DAY;
  const flags = store.allFlags().filter((f) => f.robot_id !== null);
  const outcomes = store.listOutcomes();
  const robots = store.listRobots();

  const robotLinked = outcomes.filter((o) => o.robot_id !== null);
  const accountLevel = outcomes.length - robotLinked.length;

  // Recall: which outcomes had at least one flag in the lead window before them?
  let hits = 0;
  const leadTimesDays = [];
  const byRuleOutcomes = new Map();
  for (const o of robotLinked) {
    const preceding = flags.filter(
      (f) => f.robot_id === o.robot_id && f.raised_at <= o.at && f.raised_at >= o.at - leadMs
    );
    if (preceding.length > 0) {
      hits += 1;
      const firstAt = Math.min(...preceding.map((f) => f.raised_at));
      leadTimesDays.push((o.at - firstAt) / DAY);
      for (const ruleId of new Set(preceding.map((f) => f.rule_id))) {
        byRuleOutcomes.set(ruleId, (byRuleOutcomes.get(ruleId) ?? 0) + 1);
      }
    }
  }

  // Precision proxy: which flags were followed by an outcome on that robot?
  let flagsWithOutcome = 0;
  for (const f of flags) {
    const followed = robotLinked.some((o) => o.robot_id === f.robot_id && o.at >= f.raised_at && o.at <= f.raised_at + leadMs);
    if (followed) flagsWithOutcome += 1;
  }

  // 2x2 contingency at the robot level.
  const flagged = new Set(flags.map((f) => f.robot_id));
  const withOutcome = new Set(robotLinked.map((o) => o.robot_id));
  let ff = 0, fn = 0, nf = 0, nn = 0;
  for (const r of robots) {
    const isFlagged = flagged.has(r.id);
    const hasOutcome = withOutcome.has(r.id);
    if (isFlagged && hasOutcome) ff += 1;
    else if (isFlagged) fn += 1;
    else if (hasOutcome) nf += 1;
    else nn += 1;
  }

  const byRule = [...new Set(flags.map((f) => f.rule_id))].map((ruleId) => ({
    ruleId,
    flagsRaised: flags.filter((f) => f.rule_id === ruleId).length,
    outcomesPreceded: byRuleOutcomes.get(ruleId) ?? 0,
  })).sort((a, b) => b.outcomesPreceded - a.outcomesPreceded);

  return {
    leadDays,
    totals: {
      robots: robots.length,
      flagsRaised: flags.length,
      outcomes: outcomes.length,
      robotLinkedOutcomes: robotLinked.length,
      accountLevelOutcomes: accountLevel,
    },
    recall: {
      outcomesPrecededByFlag: hits,
      totalOutcomes: robotLinked.length,
      rate: robotLinked.length ? hits / robotLinked.length : null,
      medianLeadDays: median(leadTimesDays),
    },
    precision: {
      flagsFollowedByOutcome: flagsWithOutcome,
      totalFlags: flags.length,
      rate: flags.length ? flagsWithOutcome / flags.length : null,
    },
    contingency: { flaggedWithOutcome: ff, flaggedNoOutcome: fn, unflaggedWithOutcome: nf, unflaggedNoOutcome: nn },
    byRule,
  };
}

export function formatReport(r, replay) {
  const pct = (v) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const lines = [];
  lines.push("BOTLIEN RETROSPECTIVE BACKTEST");
  if (replay) {
    lines.push(`Replayed ${new Date(replay.from).toISOString().slice(0, 10)} → ${new Date(replay.to).toISOString().slice(0, 10)} in ${replay.steps} steps`);
  }
  lines.push("");
  lines.push(`Robots: ${r.totals.robots} · Flags raised: ${r.totals.flagsRaised} · Outcomes: ${r.totals.outcomes} (${r.totals.robotLinkedOutcomes} robot-linked, ${r.totals.accountLevelOutcomes} account-level)`);
  lines.push("");
  lines.push(`RECALL   ${r.recall.outcomesPrecededByFlag}/${r.recall.totalOutcomes} outcomes had a flag in the prior ${r.leadDays} days (${pct(r.recall.rate)})`);
  lines.push(`         median lead time: ${r.recall.medianLeadDays === null ? "n/a" : r.recall.medianLeadDays.toFixed(1) + " days"} of warning before the outcome`);
  lines.push(`PRECISION ${r.precision.flagsFollowedByOutcome}/${r.precision.totalFlags} flags were followed by an outcome within ${r.leadDays} days (${pct(r.precision.rate)})`);
  lines.push("");
  lines.push("Robot-level contingency:");
  lines.push(`                     outcome     no outcome`);
  lines.push(`  flagged        ${String(r.contingency.flaggedWithOutcome).padStart(8)}   ${String(r.contingency.flaggedNoOutcome).padStart(10)}`);
  lines.push(`  not flagged    ${String(r.contingency.unflaggedWithOutcome).padStart(8)}   ${String(r.contingency.unflaggedNoOutcome).padStart(10)}`);
  lines.push("");
  lines.push("By rule:");
  for (const b of r.byRule) {
    lines.push(`  ${b.ruleId.padEnd(22)} raised ${String(b.flagsRaised).padStart(4)} · preceded ${b.outcomesPreceded} outcome(s)`);
  }
  if (r.recall.totalOutcomes < 10) {
    lines.push("");
    lines.push(`CAVEAT: only ${r.recall.totalOutcomes} robot-linked outcome(s) — directional at best, not statistically meaningful. Get more history.`);
  }
  return lines.join("\n");
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- CLI ----
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const telemetryFile = arg("telemetry");
  const outcomesFile = arg("outcomes");
  if (!telemetryFile || !outcomesFile) {
    console.error("usage: node scripts/backtest.mjs --telemetry <csv|jsonl> --outcomes <csv|jsonl> [--lead-days 30] [--step-min 360] [--out report.json]");
    process.exit(1);
  }
  const leadDays = Number(arg("lead-days", "30"));
  const stepMs = Number(arg("step-min", "360")) * MIN;
  const nowMs = Date.now();

  const store = openStore(":memory:");
  const config = loadConfig();
  const tel = importTelemetry(store, telemetryFile, { nowMs });
  const out = importOutcomes(store, outcomesFile, { nowMs });
  console.log(`imported ${tel.imported} telemetry rows (${tel.skipped} skipped) across ${tel.robots.length} robots; ${out.imported} outcomes (${out.skipped} skipped)\n`);

  const replay = await runBacktest(store, config, { stepMs });
  const report = analyzeBacktest(store, { leadDays });
  console.log(formatReport(report, replay));

  const outPath = arg("out");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ replay, report }, null, 2));
    console.log(`\nreport written to ${outPath}`);
  }
  store.close();
}
