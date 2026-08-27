// Export a scenario's history as a telemetry CSV the owner import accepts.
//
// WHY THIS EXISTS. The demo fleet lives behind --demo, and --demo has no
// sign-in: it is one scripted fleet shown without auth because that is what a
// sales demo needs. Live mode has the sign-in and deliberately runs no
// simulated robots, so an owner importing their own export never finds invented
// units mixed into their fleet. Both decisions are right, and together they
// mean there is no flag that produces "a demo behind the login".
//
// This closes that gap without weakening either decision: the scenario is
// replayed once, written out as an ordinary telemetry export, and imported
// through /owner/import like any operator's file. What comes out the other side
// is a normal tenant with normal data, not a simulator running in production.
//
// It also exercises the exact path a real design partner will use, which is the
// more valuable side effect: if the import is broken, we find out here rather
// than on a call.
//
//   node scripts/export-scenario-csv.mjs [--scenario demo-fleet] [--days 21]
//                                        [--out fleet.csv] [--every 1]
//
// RESOLUTION. Default is every sample, one a minute, because the rollups count
// an active sample as an active minute. Downsampling with --every 5 makes the
// file five times smaller and undercounts active time five to one, so the
// coverage figure it produces will not match the live demo. Use it to eyeball
// the shape of a file, never to produce numbers anyone will read.
import { writeFileSync } from "node:fs";
import { createSimConnector } from "../src/connectors/sim.mjs";

const DAY_MS = 86_400_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const scenarioName = arg("scenario", "demo-fleet");
const days = Number(arg("days", "21"));
const every = Math.max(1, Number(arg("every", "1")));
const outPath = arg("out", `${scenarioName}-${days}d.csv`);

// Column names are the importer's first-choice aliases, so a file produced here
// needs no mapping. The importer accepts several spellings per field; picking
// the canonical one keeps the export readable as documentation of the format.
const HEADER = [
  "robot_id", "timestamp", "connection_state", "battery_pct",
  "mission_state", "mission_id", "stuck", "charging", "moving", "errors",
];

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowFor(status) {
  return [
    status.externalId,
    // ISO rather than epoch. Both import, and a human opening this file to
    // check it against their own records can read one of them.
    new Date(status.at).toISOString(),
    status.connectionState,
    status.batteryPct,
    status.missionState,
    status.missionId,
    status.stuck === null || status.stuck === undefined ? "" : String(status.stuck),
    status.charging === null || status.charging === undefined ? "" : String(status.charging),
    status.moving === null || status.moving === undefined ? "" : String(status.moving),
    Array.isArray(status.errors) ? status.errors.join("|") : "",
  ].map(csvCell).join(",");
}

const scenario = (await import(`../src/scenarios/${scenarioName}.mjs`)).default;

// A fresh connector anchored to the start of history, exactly as backfill does.
// The anchor tick is what fixes startMs, and every day-indexed phase in the
// scenario — a decline that begins on day 2, an outage on day 15 — is measured
// from it. Anchor to "now" instead and the interesting events land in the
// future, where nobody importing this file will ever see them.
const connector = createSimConnector(scenario);
await connector.init();

const toMs = Date.now();
const fromMs = toMs - days * DAY_MS;

const lines = [HEADER.join(",")];
let kept = 0;
let sampled = 0;

const anchor = await connector.tick(fromMs);
for (const e of anchor.events) {
  sampled += 1;
  if (sampled % every === 0) { lines.push(rowFor(e.status)); kept += 1; }
}

// A day at a time. One tick for the whole span would build every sample for
// every robot in memory before a byte is written; three weeks of a seven-robot
// fleet at one sample a minute is over 200k objects.
for (let d = 0; d < days; d++) {
  const dayEnd = Math.min(fromMs + (d + 1) * DAY_MS, toMs);
  const { events } = await connector.tick(dayEnd);
  for (const e of events) {
    sampled += 1;
    if (sampled % every === 0) { lines.push(rowFor(e.status)); kept += 1; }
  }
  process.stdout.write(`\rday ${d + 1}/${days}, ${kept.toLocaleString()} rows`);
}
await connector.stop();

writeFileSync(outPath, lines.join("\n") + "\n");

const robots = new Set(scenario.robots.map((r) => r.externalId));
const bytes = Buffer.byteLength(lines.join("\n"));
process.stdout.write("\r".padEnd(60) + "\r");
console.log(`wrote ${outPath}`);
console.log(`  ${kept.toLocaleString()} rows, ${robots.size} robots, ${days} days`);
console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}`);
if (every > 1) {
  console.log(`  WARNING: --every ${every} keeps one sample in ${every}. Active time will`);
  console.log(`  read ${every}x low and coverage will not match the live demo.`);
}
