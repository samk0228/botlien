// Utilization bucketing. Pure: (snapshot rows for ONE robot, sorted by at) ->
// rollup rows. Durations integrate the step function between snapshots; a gap
// longer than maxGapMs contributes nothing (a dark robot earns no online_ms,
// and an outage gap is not smeared across as uptime).

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

    if (prev) {
      if (!truthy(prev.stuck) && truthy(s.stuck)) b.stuckEpisodes += 1;
      if (prev.mission_state !== "active" && s.mission_state === "active") b.missionCount += 1;
    } else if (s.mission_state === "active") {
      b.missionCount += 1;
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

  return [...buckets.values()].sort((a, b) => a.bucketStartAt - b.bucketStartAt);
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
