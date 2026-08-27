// Verify a telemetry CSV all the way to a coverage statement, the same path an
// owner walks: import → confirm → statement. Exits non-zero if it does not
// land, so it can be a gate rather than something to read.
//
//   node scripts/verify-import.mjs <file.csv> [--business warehouse]
//
// WHY THIS IS NOT JUST "DID IT PARSE". The importer is alias-tolerant and skips
// rows it cannot read, on purpose, with reasons. That is the right behaviour and
// it also means a file whose columns are all unrecognised imports "successfully"
// and produces an empty dashboard. Anything under a high match rate is treated
// as a failure here, because on a call that is what it will look like.
import { readFileSync, rmSync, existsSync } from "node:fs";
import { openStore } from "../src/store.mjs";
import { importTelemetryFromText } from "../src/importer.mjs";
import { ownerModel, confirmModel, applyConfirm, setBusinessType, recordImport } from "../src/owner.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-import.mjs <file.csv> [--business warehouse]");
  process.exit(2);
}
const business = arg("business", "warehouse");

// Per-robot work kind. In the product this is the /owner/confirm screen: an
// export says how many robots there are and how much they did, and cannot say
// what kind of work each one does. Left uncorrected the importer applies one
// category to the whole file, and a scrubber gets priced per pick.
const CATEGORY_BY_NAME = [
  [/picker|pick arm/i, "picking"],
  [/forklift/i, "putaway"],
  [/scrubber|clean/i, "cleaning"],
];
// The importer prefixes the robot key with its connector, so a row whose
// robot_id was "sim-005" arrives as "import:sim-005". Strip it before matching.
const CATEGORY_BY_ID = { "sim-001": "picking", "sim-002": "picking", "sim-003": "picking",
  "sim-004": "picking", "sim-005": "putaway", "sim-006": "cleaning", "sim-007": "cleaning" };

const dbPath = "/tmp/verify-import.db";
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const store = openStore(dbPath);
const nowMs = Date.now();
const text = readFileSync(file, "utf8");

console.log(`importing ${file} (${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)} MB)`);
const t0 = Date.now();
const result = importTelemetryFromText(store, text, file, { category: "picking", nowMs });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const matchRate = result.rows ? result.imported / result.rows : 0;
console.log(`  ${result.imported.toLocaleString()} of ${result.rows.toLocaleString()} rows imported in ${secs}s`);
console.log(`  ${result.robots?.length ?? result.robots?.size ?? "?"} robots, ${result.skipped.toLocaleString()} skipped`);
console.log(`  match rate ${(matchRate * 100).toFixed(1)}%`);

recordImport(store, result);
setBusinessType(store, business);

// The confirm step, applied programmatically.
const cm = confirmModel(store, nowMs);
const changes = cm.robots.map((r) => {
  const key = String(r.name ?? "").replace(/^[a-z]+:/, "");
  const byId = CATEGORY_BY_ID[key];
  const byName = CATEGORY_BY_NAME.find(([re]) => re.test(r.name ?? ""))?.[1];
  return { robotId: r.id, category: byId ?? byName ?? "picking" };
});
applyConfirm(store, changes, nowMs);
console.log(`  confirmed ${changes.length} robots, business = ${business}`);

const m = ownerModel(store, nowMs);
const t = m.totals ?? {};
console.log("");
console.log("COVERAGE STATEMENT");
console.log(`  fleet            ${t.coverage === null || t.coverage === undefined ? "none" : t.coverage.toFixed(2) + "x"}`);
console.log(`  work serviced    $${((t.workServicedCents ?? 0) / 100).toFixed(2)}`);
console.log(`  lease invoices   $${((t.invoiceProratedCents ?? 0) / 100).toFixed(2)}`);
console.log(`  utilisation      ${t.utilizationPct === null || t.utilizationPct === undefined ? "none" : t.utilizationPct.toFixed(0) + "%"}`);
console.log(`  window           ${m.windowLabel ?? "?"}`);
console.log("");
console.log("PER ROBOT");
for (const r of m.robots ?? []) {
  const c = r.fin?.coverage;
  console.log(`  ${String(r.name).padEnd(22)} ${c === null || c === undefined ? "  none " : c.toFixed(2) + "x"}  ${r.category}`);
}
console.log("");
console.log(`  ${(m.tips ?? []).length} tips, $${((m.tipsUpsideCents ?? 0) / 100).toFixed(2)} of upside`);

const problems = [];
if (matchRate < 0.95) problems.push(`only ${(matchRate * 100).toFixed(1)}% of rows matched`);
if ((result.robots?.length ?? result.robots?.size ?? 0) === 0) problems.push("no robots created");
if (t.coverage === null || t.coverage === undefined) problems.push("no fleet coverage produced");
if (!(m.robots ?? []).some((r) => r.fin?.coverage !== null && r.fin?.coverage !== undefined)) {
  problems.push("no robot produced a coverage figure");
}
if (m.unpricedCount > 0) problems.push(`${m.unpricedCount} robot(s) ended up unpriced`);

console.log("");
if (problems.length) {
  console.log("FAILED");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("OK: import → confirm → coverage statement works end to end");
