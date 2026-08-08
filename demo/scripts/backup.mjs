// Back every SQLite database up to a single directory. Run via
// `npm run backup -- /path/to/destination`.
//
// Copying a live SQLite file with `cp` is not a backup. Readers and writers are
// concurrent, so a plain copy can catch a write half-applied and produce a file
// that opens fine and is subtly wrong. SQLite's own VACUUM INTO takes a
// consistent snapshot of a live database, WAL included, with no locking of the
// running app.
//
// The output is a plain directory of .db files: no format to decode, and
// restore is a copy back with the app stopped.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { resolvePath } from "../src/infra.mjs";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: npm run backup -- /path/to/destination");
  process.exit(2);
}

// Timestamped so a run never overwrites the previous good copy. A backup script
// whose second run destroys the first is worse than none, because it looks like
// it is working right up until the moment it matters.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(dest, `botlien-${stamp}`);
mkdirSync(outDir, { recursive: true });

const controlDb = resolvePath(process.env.BOTLIEN_CONTROL_DB ?? "data/control.db");
const opsDb = resolvePath(process.env.BOTLIEN_DB ?? "data/botlien.db");
const tenantDir = resolvePath(process.env.BOTLIEN_TENANT_DIR ?? "data/tenants");

const targets = [];
for (const p of [controlDb, opsDb]) if (existsSync(p)) targets.push(p);
if (existsSync(tenantDir)) {
  for (const f of readdirSync(tenantDir)) {
    if (f.endsWith(".db")) targets.push(join(tenantDir, f));
  }
}

if (targets.length === 0) {
  console.error("FAIL  no databases found. Check BOTLIEN_CONTROL_DB / BOTLIEN_TENANT_DIR.");
  process.exit(1);
}

let failed = 0;
for (const src of targets) {
  // Tenant files are named by account id, so a flat destination would collide
  // control.db with nothing but 1.db with 1.db across directories.
  const name = src.startsWith(tenantDir) ? `tenant-${basename(src)}` : basename(src);
  const out = join(outDir, name);
  try {
    const db = new DatabaseSync(src, { readOnly: true });
    // The path is interpolated because VACUUM INTO takes no bound parameter.
    // These paths come from our own argv and directory listing, never a request.
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    db.close();
    console.log(`  ok   ${name}  ${(statSync(out).size / 1024).toFixed(0)}KB`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}  ${String(err).slice(0, 160)}`);
  }
}

if (failed > 0) {
  console.error(`\nFAIL  ${failed} of ${targets.length} database(s) did not back up.`);
  process.exit(1);
}

console.log(`\nPASS  ${targets.length} database(s) -> ${outDir}`);
console.log(
  "\nA backup you have never restored is not a backup. Restore test: stop the app,\n" +
    "copy these files back over the originals, start it, and sign in.",
);
