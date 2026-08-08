// Utilization bucketing. Pure: (snapshot rows for ONE robot, sorted by at) ->
// rollup rows. Durations integrate the step function between snapshots; a gap
// longer than maxGapMs contributes nothing (a dark robot earns no online_ms,
// and an outage gap is not smeared across as uptime).
//
// MISSION COUNTING. A mission is counted once per distinct mission_id seen in a
// bucket, not once per idle -> active transition. Transition counting reads the
// polling cadence as if it were the workload: poll every 30s instead of every
// 60s and a robot appears to do more runs, because a short idle blip between
// two legs of the same mission becomes a second transition. That is harmless
// on a dashboard showing one period and fatal to any comparison of two periods,
// which is exactly what the variance panel does. Distinct ids are what the
// robot actually reported.
//
// Two consequences, both deliberate:
//   - A bucket is still computable from its own snapshots alone. upsertRollup
//     overwrites wholesale, so a bucket that depended on rows outside itself
//     would be silently wrong on the next partial recompute. That invariant is
//     what the aligned recompute window exists to protect, so counting is kept
//     bucket-local rather than deduplicating across the whole window.
//   - A mission spanning a bucket boundary therefore counts in both buckets.
//     For mission-priced work (tray runs, picks, deliveries) a run lasts
//     minutes against a one-hour bucket, so the overlap is a rounding error.
//     Work that genuinely runs for hours (cleaning, laundry) is priced on
//     active_hour and never reads mission_count at all.
//
// Connectors that do not report a mission id fall back to transition counting,
// which is the old behavior and the best available from that data.

export function computeRollups(snapshots, bucketMs, { maxGapMs = 5 * 60_000 } = {}) {
  const buckets = new Map(); // bucketStartAt -> accumulator
  const acc = (bucketStartAt) => {
    if (!buckets.has(bucketStartAt)) {
      buckets.set(bucketStartAt, {
        bucketStartAt,
        bucketMs,
        sampleCount: 0,
        onlineMs: 0,
        activeMs: 0,
        missionCount: 0,
        errorCount: 0,
        stuckEpisodes: 0,
        batteryMinPct: null,
        batteryMaxPct: null,
        // counting state, stripped before the row is returned
        missionIds: new Set(),
        anonMissions: 0,
      });
    }
    return buckets.get(bucketStartAt);
  };

  let prev = null;
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const bucketStartAt = Math.floor(s.at / bucketMs) * bucketMs;
    const b = acc(bucketStartAt);
    b.sampleCount += 1;

    const errors = parseErrors(s.errors);
    b.errorCount += errors.length;

    if (s.battery_pct !== null && s.battery_pct !== undefined) {
      b.batteryMinPct = b.batteryMinPct === null ? s.battery_pct : Math.min(b.batteryMinPct, s.battery_pct);
      b.batteryMaxPct = b.batteryMaxPct === null ? s.battery_pct : Math.max(b.batteryMaxPct, s.battery_pct);
    }

    if (prev && !truthy(prev.stuck) && truthy(s.stuck)) b.stuckEpisodes += 1;

    if (s.mission_state === "active") {
      if (s.mission_id !== null && s.mission_id !== undefined && s.mission_id !== "") {
        b.missionIds.add(s.mission_id);
      } else if (!prev || prev.mission_state !== "active") {
        // no id to dedupe on, so this connector gets transition counting
        b.anonMissions += 1;
      }
    }

    const next = snapshots[i + 1];
    if (next) {
      const bucketEnd = bucketStartAt + bucketMs;
      const dt = Math.max(0, Math.min(next.at - s.at, maxGapMs, bucketEnd - s.at));
      if (s.connection_state === "online") b.onlineMs += dt;
      if (s.mission_state === "active") b.activeMs += dt;
    }
    prev = s;
  }

  return [...buckets.values()]
    .map(({ missionIds, anonMissions, ...row }) => ({
      ...row,
      missionCount: missionIds.size + anonMissions,
    }))
    .sort((a, b) => a.bucketStartAt - b.bucketStartAt);
}

const DAY_MS = 86_400_000;

/** Recompute every bucket for one robot from its snapshots, which are the
 * source of truth and are never mutated. Takes the store as a parameter rather
 * than importing one, so this module keeps no I/O dependency of its own.
 *
 * Chunks by day so a multi-month history never lands in memory at once, and
 * chunk edges fall on day boundaries so no bucket is ever computed from a
 * partial slice — the bug that ground 93% of the demo database to one sample. */
export function rebuildRollupsForRobot(store, robotId, bucketMs = 3_600_000) {
  const rows = store.snapshotsBetween(robotId, 0, Number.MAX_SAFE_INTEGER);
  if (rows.length === 0) return { buckets: 0, snapshots: 0 };

  const minAt = rows[0].at;
  const maxAt = rows[rows.length - 1].at;
  let buckets = 0;

  for (let chunkStart = Math.floor(minAt / DAY_MS) * DAY_MS; chunkStart <= maxAt; chunkStart += DAY_MS) {
    const chunk = rows.filter((r) => r.at >= chunkStart && r.at < chunkStart + DAY_MS);
    if (chunk.length === 0) continue;
    for (const b of computeRollups(chunk, bucketMs)) {
      store.upsertRollup({ robotId, ...b });
      buckets += 1;
    }
  }
  return { buckets, snapshots: rows.length };
}

function parseErrors(e) {
  if (!e) return [];
  if (Array.isArray(e)) return e;
  try {
    const parsed = JSON.parse(e);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function truthy(v) {
  return v === 1 || v === true;
}
