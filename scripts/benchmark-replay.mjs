#!/usr/bin/env node
// Replay a gateway recording through Botlien and print what the line did.
//
//   node scripts/benchmark-replay.mjs run.jsonl [--expect linelab.json] [--json out.json]
//
// run.jsonl is what `gateway.mjs --record run.jsonl` wrote: one event per
// line, exactly as sent to /api/v1/events. The replay builds a throwaway
// manufacturing account in memory and pushes every event through the same
// path a live account takes, so the figures are the dashboard's, not a
// side calculation. --expect names a file of the figures Line Lab reported
// for the same run (see benchmark/cnc-shop-v1.1.json for the shape); every
// field it names is checked, and the exit code is 1 when any differs.
import { readFileSync, writeFileSync } from "node:fs";
import { parseRecording, replay, report, compare, formatReport } from "../src/benchmark.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
if (!file) {
  console.error("usage: node scripts/benchmark-replay.mjs run.jsonl [--expect linelab.json] [--json out.json]");
  process.exit(2);
}
const { events, bad } = parseRecording(readFileSync(file, "utf8"));
if (bad.length) console.error(`${bad.length} line(s) could not be read and were skipped: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}`);
if (!events.length) {
  console.error("no events in the recording");
  process.exit(2);
}
const replayed = replay(events);
if (replayed.rejected.length) console.error(`${replayed.rejected.length} event(s) rejected by the server: ${replayed.rejected.slice(0, 3).map((r) => `line ${r.index + 1}: ${r.problems.join("; ")}`).join(" | ")}`);
const rep = report(replayed);
const expectPath = opt("expect");
const cmp = expectPath ? compare(rep, JSON.parse(readFileSync(expectPath, "utf8"))) : null;
console.log(formatReport(rep, cmp));
const jsonPath = opt("json");
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ ...rep, compare: cmp }, null, 2));
process.exit(cmp && !cmp.ok ? 1 : 0);
