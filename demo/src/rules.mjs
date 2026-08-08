// Rule definitions as data. Each rule: { id, dimension, scope, defaults,
// eval(ctx, params) -> null | { severity: 'warn'|'crit', evidence } }.
// Thresholds come from config.json `rules` (merged over defaults by the
// engine), with per-category overrides ready via `byCategory` when humanoids
// arrive — no engine change needed, just config.
//
// Robot-scope ctx: { robot, latest, lastOnlineAt, window24h, rollups, nowMs, heartbeatState }
// Connector-scope ctx: { connector, heartbeats, nowMs }
// All rules are pure; every threshold is a v1 hypothesis until backtested.

const MIN = 60_000;
const DAY = 86_400_000;

export const RULES = [
  {
    id: "offline_duration",
    dimension: "pd",
    scope: "robot",
    defaults: { warn_min: 30, crit_min: 240 },
    eval(ctx, p) {
      // Gated on connector health: when the pipe is down we know nothing
      // about the robot, and "one robot dark" must not be confused with it.
      if (ctx.heartbeatState !== "ok") return null;
      if (ctx.latest && ctx.latest.connection_state === "online") return null;
      const anchor = ctx.lastOnlineAt ?? ctx.latest?.at ?? ctx.robot.first_seen_at;
      if (!anchor) return null;
      const offlineMin = (ctx.nowMs - anchor) / MIN;
      if (offlineMin >= p.crit_min) return { severity: "crit", evidence: { offline_min: Math.round(offlineMin) } };
      if (offlineMin >= p.warn_min) return { severity: "warn", evidence: { offline_min: Math.round(offlineMin) } };
      return null;
    },
  },
  {
    id: "error_severity",
    dimension: "pd",
    scope: "robot",
    defaults: { recur_count_24h: 5 },
    eval(ctx, p) {
      const latestErrors = parseErrors(ctx.latest?.errors);
      // Bear's real severity scale tops out at SEVERITY_HIGH ("blocks
      // operation"); sim/import data may say CRITICAL. Both count.
      const critical = latestErrors.find((e) => e.severity === "CRITICAL" || e.severity === "HIGH");
      if (critical) return { severity: "crit", evidence: { code: critical.code } };
      const errorSnapshots = ctx.window24h.filter((s) => parseErrors(s.errors).length > 0).length;
      if (errorSnapshots >= p.recur_count_24h) {
        return { severity: "warn", evidence: { error_snapshots_24h: errorSnapshots } };
      }
      return null;
    },
  },
  {
    id: "stuck_state",
    dimension: "pd",
    scope: "robot",
    defaults: { continuous_min: 10, episodes_24h: 6 },
    eval(ctx, p) {
      // Continuous: latest is stuck and has been since >= continuous_min ago.
      if (truthy(ctx.latest?.stuck)) {
        let since = ctx.latest.at;
        for (let i = ctx.window24h.length - 1; i >= 0; i--) {
          const s = ctx.window24h[i];
          if (!truthy(s.stuck)) break;
          since = s.at;
        }
        const stuckMin = (ctx.nowMs - since) / MIN;
        if (stuckMin >= p.continuous_min) {
          return { severity: "crit", evidence: { stuck_continuous_min: Math.round(stuckMin) } };
        }
      }
      let episodes = 0;
      let prevStuck = false;
      for (const s of ctx.window24h) {
        const cur = truthy(s.stuck);
        if (cur && !prevStuck) episodes += 1;
        prevStuck = cur;
      }
      if (episodes >= p.episodes_24h) return { severity: "warn", evidence: { stuck_episodes_24h: episodes } };
      return null;
    },
  },
  {
    id: "utilization_drop",
    dimension: "pd",
    scope: "robot",
    defaults: { drop_pct: 40, crit_drop_pct: 70, baseline_floor_active_ms_per_day: 3_600_000 },
    eval(ctx, p) {
      const recentStart = ctx.nowMs - DAY;
      const baselineStart = ctx.nowMs - 8 * DAY;
      let recentActive = 0;
      let baselineActive = 0;
      let baselineMinAt = null;
      let baselineMaxAt = null;
      for (const r of ctx.rollups) {
        if (r.bucket_start_at >= recentStart) {
          recentActive += r.active_ms;
        } else if (r.bucket_start_at >= baselineStart) {
          baselineActive += r.active_ms;
          baselineMinAt = baselineMinAt === null ? r.bucket_start_at : Math.min(baselineMinAt, r.bucket_start_at);
          baselineMaxAt = baselineMaxAt === null ? r.bucket_start_at : Math.max(baselineMaxAt, r.bucket_start_at);
        }
      }
      if (baselineMinAt === null) return null;
      const baselineDays = Math.max(1, (baselineMaxAt - baselineMinAt + (ctx.rollups[0]?.bucket_ms ?? 0)) / DAY);
      const baselinePerDay = baselineActive / baselineDays;
      // Never flag a robot that was always idle — no baseline, no signal.
      if (baselinePerDay < p.baseline_floor_active_ms_per_day) return null;
      const dropPct = ((baselinePerDay - recentActive) / baselinePerDay) * 100;
      const evidence = {
        baseline_active_min_per_day: Math.round(baselinePerDay / MIN),
        recent_active_min_24h: Math.round(recentActive / MIN),
        drop_pct: Math.round(dropPct),
      };
      if (dropPct >= p.crit_drop_pct) return { severity: "crit", evidence };
      if (dropPct >= p.drop_pct) return { severity: "warn", evidence };
      return null;
    },
  },
  {
    id: "battery_degradation",
    dimension: "lgd",
    scope: "robot",
    defaults: { fade_pct: 15 },
    eval(ctx, p) {
      // Daily max battery is the full-charge proxy; fading max = degrading pack.
      const byDay = new Map();
      for (const r of ctx.rollups) {
        if (r.battery_max_pct === null || r.battery_max_pct === undefined) continue;
        const day = Math.floor(r.bucket_start_at / DAY);
        byDay.set(day, Math.max(byDay.get(day) ?? 0, r.battery_max_pct));
      }
      const days = [...byDay.keys()].sort((a, b) => a - b);
      if (days.length < 3) return null;
      const earlyMax = Math.max(byDay.get(days[0]), byDay.get(days[1]));
      const recentMax = byDay.get(days[days.length - 1]);
      const fade = earlyMax - recentMax;
      if (fade >= p.fade_pct) {
        return { severity: "warn", evidence: { early_max_pct: earlyMax, recent_max_pct: recentMax, fade_pct: Math.round(fade * 10) / 10 } };
      }
      return null;
    },
  },
  {
    id: "consumable_exhaustion",
    dimension: "lgd",
    scope: "robot",
    defaults: { warn_remaining_pct: 15 },
    eval(ctx, p) {
      // Collateral condition, measured directly. A scrubber whose squeegee and
      // filter are spent is not worth its book value at repossession: it is
      // worth that minus the parts and the labour to fit them.
      const rated = (ctx.wear ?? []).filter((w) => w.remaining_pct !== null && w.remaining_pct !== undefined);
      if (rated.length === 0) return null;
      const worst = rated.reduce((a, b) => (b.remaining_pct < a.remaining_pct ? b : a));
      const evidence = {
        component: worst.component,
        remaining_pct: Math.round(worst.remaining_pct),
        parts_tracked: rated.length,
      };
      // Past rated life is not "nearly worn" — it is a part running on borrowed
      // time that can take the surface it cleans with it when it fails.
      if (worst.remaining_pct <= 0) return { severity: "crit", evidence };
      if (worst.remaining_pct <= p.warn_remaining_pct) return { severity: "warn", evidence };
      return null;
    },
  },
  {
    id: "deferred_maintenance",
    dimension: "pd",
    scope: "robot",
    defaults: { spent_parts: 2, crit_spent_parts: 3, min_active_ms_24h: 1_800_000 },
    eval(ctx, p) {
      // Distinct from consumable_exhaustion, and deliberately so. That rule asks
      // "what is this machine worth." This one asks "what does the owner's
      // spending say about the owner." An operator who keeps running a machine
      // on several dead parts has chosen output over upkeep, which is what
      // happens when the parts budget is gone — and it shows up months before a
      // payment is missed. The still-running condition is load-bearing: a parked
      // robot with spent parts is a storage decision, not distress.
      const spent = (ctx.wear ?? []).filter((w) => w.remaining_pct !== null && w.remaining_pct <= 0);
      if (spent.length < p.spent_parts) return null;
      const recentActive = ctx.rollups
        .filter((r) => r.bucket_start_at >= ctx.nowMs - DAY)
        .reduce((sum, r) => sum + r.active_ms, 0);
      if (recentActive < p.min_active_ms_24h) return null;
      const evidence = {
        spent_parts: spent.length,
        components: spent.map((w) => w.component).join(","),
        active_min_24h: Math.round(recentActive / MIN),
      };
      if (spent.length >= p.crit_spent_parts) return { severity: "crit", evidence };
      return { severity: "warn", evidence };
    },
  },
  {
    id: "manual_operation",
    dimension: "pd",
    scope: "robot",
    defaults: { share_pct: 30, crit_share_pct: 60, min_samples: 20 },
    eval(ctx, p) {
      // A robot being driven by hand is not replacing labour, it is consuming
      // it. Utilization looks healthy either way, so without this the coverage
      // statement prices work that no robot actually did.
      const samples = (ctx.conditions24h ?? []).filter(
        (c) => c.manual_controlling !== null && c.manual_controlling !== undefined
      );
      if (samples.length < p.min_samples) return null;
      const manual = samples.filter((c) => c.manual_controlling === 1).length;
      const sharePct = (manual / samples.length) * 100;
      const evidence = { manual_share_pct: Math.round(sharePct), samples: samples.length };
      if (sharePct >= p.crit_share_pct) return { severity: "crit", evidence };
      if (sharePct >= p.share_pct) return { severity: "warn", evidence };
      return null;
    },
  },
  {
    id: "connector_down",
    dimension: "infra",
    scope: "connector",
    defaults: { warn_min: 5, crit_min: 30 },
    eval(ctx, p) {
      const hbs = ctx.heartbeats;
      if (hbs.length === 0) return null;
      const latest = hbs[hbs.length - 1];
      if (latest.state === "ok") return null;
      let downSince = latest.at;
      for (let i = hbs.length - 1; i >= 0; i--) {
        if (hbs[i].state === "ok") break;
        downSince = hbs[i].at;
      }
      const downMin = (ctx.nowMs - downSince) / MIN;
      const evidence = { down_min: Math.round(downMin), state: latest.state };
      if (downMin >= p.crit_min) return { severity: "crit", evidence };
      if (downMin >= p.warn_min) return { severity: "warn", evidence };
      return null;
    },
  },
];

export function ruleParams(rule, config, category) {
  const conf = config?.rules?.[rule.id] ?? {};
  const byCat = category && conf.byCategory ? conf.byCategory[category] ?? {} : {};
  return { ...rule.defaults, ...conf, ...byCat };
}

export function clearAfterMs(rule, config) {
  const conf = config?.rules?.[rule.id] ?? {};
  return (conf.clear_after_min ?? 30) * MIN;
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
