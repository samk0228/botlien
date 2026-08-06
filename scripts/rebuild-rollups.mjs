// Rebuild utilization_rollups from status_snapshots, which are the source of
// truth and are never mutated.
//
//   node scripts/rebuild-rollups.mjs [--db data/botlien.db] [--dry-run]
//
// Two reasons to run this:
//   1. Repairing a database written before the recompute window was aligned to
//      bucket boundaries. That bug let the trailing edge of the window overwrite
//      complete buckets with partial ones, grinding history down to one sample
//      per hour. Every stored aggregate from that era understates the truth.
//   2. After importTelemetry. The importer writes snapshots but no rollups, so a
//      dropped CSV produces an empty board until this runs.
//
// Idempotent: recomputing a correct bucket yields the same row.
import { openStore } from "../src/store.mjs";
import { computeRollups } from "../src/rollup.mjs";
import { loadConfig, ROOT } from "../src/infra.mjs";
import { join } from "node:path";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DAY = 86_400_000;

/** Recompute every bucket for one robot, reading snapshots in day-sized chunks
 * so a multi-month database never lands in memory at once. Chunks are expanded
 * to whole bucket boundaries, so no bucket is ever computed from a partial slice
 * (which is the bug this script exists to repair). */
export function rebuildRobot(store, robotId, bucketMs, { dryRun = false } = {}) {
  const rows = store.snapshotsBetween(robotId, 0, Number.MAX_SAFE_INTEGER);
  if (rows.length === 0) return { buckets: 0, snapshots: 0 };

  const minAt = rows[0].at;
  const maxAt = rows[rows.length - 1].at;
  let written = 0;

  for (let chunkStart = Math.floor(minAt / DAY) * DAY; chunkStart <= maxAt; chunkStart += DAY) {
    const chunk = rows.filter((r) => r.at >= chunkStart && r.at < chunkStart + DAY);
    if (chunk.length === 0) continue;
    for (const b of computeRollups(chunk, bucketMs)) {
      if (!dryRun) store.upsertRollup({ robotId, ...b });
      written += 1;
    }
  }
  return { buckets: written, snapshots: rows.length };
}

function distribution(store, robots, bucketMs) {
  let starved = 0;
  let total = 0;
  for (const r of robots) {
    for (const b of store.rollupsBetween(r.id, 0, Number.MAX_SAFE_INTEGER)) {
      total += 1;
      if (b.sample_count <= 2) starved += 1;
    }
  }
  return { total, starved, pct: total === 0 ? 0 : Math.round((100 * starved) / total) };
}

async function main() {
  const config = loadConfig();
  const dbPath = arg("db", join(ROOT, config.db_path));
  const dryRun = process.argv.includes("--dry-run");
  const bucketMs = config.engine.rollup_bucket_ms ?? 3_600_000;

  const store = openStore(dbPath);
  const robots = store.listRobots();
  if (robots.length === 0) {
    console.log(`no robots in ${dbPath}, nothing to rebuild`);
    return;
  }

  const before = distribution(store, robots, bucketMs);
  console.log(`${dbPath}: ${robots.length} robots, ${before.total} buckets, ${before.starved} starved (${before.pct}%)`);
  if (dryRun) console.log("(dry run: nothing will be written)");

  let buckets = 0;
  let snapshots = 0;
  for (const r of robots) {
    const res = rebuildRobot(store, r.id, bucketMs, { dryRun });
    buckets += res.buckets;
    snapshots += res.snapshots;
    console.log(`  ${r.robot_key}: ${res.snapshots} snapshots -> ${res.buckets} buckets`);
  }

  const after = distribution(store, robots, bucketMs);
  console.log(`rebuilt ${buckets} buckets from ${snapshots} snapshots`);
  console.log(`starved buckets: ${before.starved} (${before.pct}%) -> ${after.starved} (${after.pct}%)`);
  store.close();
}

// only run when invoked directly, so the rebuild helpers stay importable in tests
if (process.argv[1] && process.argv[1].endsWith("rebuild-rollups.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
