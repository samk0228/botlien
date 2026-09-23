// The data contract: everything the dashboard needs, for one customer, in one
// JSON document. The published Demo computes every screen in the browser from
// about twenty tables (ROBOTS, CONFIRM, DAILY, DOWNTIME, KEEPING, CONTRACT,
// PERIODS, ...). This module builds those same tables from the customer's own
// store, so the Demo's code runs unchanged on real data and a new customer's
// dashboard fills in as soon as their telemetry lands.
//
// Rules this file keeps:
// - No arithmetic of its own where one already exists. Coverage, duty and
//   tasks come from finance.mjs; stalls and hand-driving from
//   interventions.mjs; economics from rates.mjs. The API and the old server
//   pages cannot disagree because they call the same functions.
// - Absent is absent. A table the customer's data cannot fill yet is an empty
//   array with its provenance marked "missing", never a row of zeros.
// - Pure with respect to the injected clock, like every other read path.
import { robotFinancials, taskCount } from "./finance.mjs";
import { BENCHMARKS, economicsFor, taskLabelFor } from "./rates.mjs";
import { robotInterventions, MINUTES_PER_CLEAR } from "./interventions.mjs";

export const CONTRACT_VERSION = 1;
const DEFAULT_SITE = "Main site";
const DEFAULT_TZ = "America/Los_Angeles";
const PERIODS_BACK = 6;
// Two abnormal samples further apart than this are two episodes, not one,
// unless the robot only reports every few minutes: then the gap is one and a
// half of its own sample intervals, so an export sampled every 10 minutes does
// not split one long stall into a stall per row.
const EPISODE_GAP_MS = 3 * 60_000;
// Credited to a one-sample episode, and added to every episode's span so a
// robot stuck across 4 samples at 15s reads as a minute, not 45 seconds.
const DEFAULT_SAMPLE_MS = 15_000;

export const KV_BILLING_DAY = "billing.anchor_day";
export const KV_TZ = "owner.tz";

/** YYYY-MM-DD in the customer's time zone. Days, periods and shifts are the
 *  floor's local days: a stall at 11pm Pacific belongs to that night, not to
 *  the next UTC date. */
export function dateKey(ms, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function hhmm(ms, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}

function localMidnightMs(key, tz) {
  // The UTC instant at which `key` begins in tz. Found by correcting a UTC
  // guess by the zone's offset on that date; exact outside DST switch hours,
  // which a billing boundary never falls on.
  const guess = Date.parse(`${key}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(guess);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess - (asLocal - guess);
}

function addMonthsKey(key, n, anchorDay) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(anchorDay, last));
  return d.toISOString().slice(0, 10);
}

function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Billing periods, newest first, the open one containing `asOfMs`. A period
 *  runs from the anchor day to the day before the next anchor day, the way a
 *  monthly lease invoice does (Aug 4 to Sep 3). */
export function billingPeriods(asOfMs, { anchorDay, tz = DEFAULT_TZ, count = PERIODS_BACK } = {}) {
  const today = dateKey(asOfMs, tz);
  const [y, m, d] = today.split("-").map(Number);
  let start = addMonthsKey(`${y}-${String(m).padStart(2, "0")}-01`, 0, anchorDay);
  if (d < Math.min(anchorDay, Number(start.slice(8)))) start = addMonthsKey(start, -1, anchorDay);
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = addMonthsKey(start, -i, anchorDay);
    const e = addDaysKey(addMonthsKey(s, 1, anchorDay), -1);
    const year = e.slice(0, 4);
    out.push({
      start: s,
      end: e,
      label: `${shortDate(s)} to ${shortDate(e)}, ${year}`,
      status: i === 0 ? "open" : "closed",
      fromMs: localMidnightMs(s, tz),
      toMs: localMidnightMs(addDaysKey(e, 1), tz),
    });
  }
  return out;
}

/** Downtime episodes from abnormal samples: stuck, e-stop, or reporting an
 *  error. Consecutive abnormal samples of the same kind within EPISODE_GAP_MS
 *  are one episode. The pose where it began is kept so a place can be named
 *  once the site has a map. */
export function downtimeEpisodes(rows, { tz = DEFAULT_TZ, sampleMs = DEFAULT_SAMPLE_MS } = {}) {
  // A warning does not stop a robot, so it is not downtime. Only an error or
  // critical fault counts, and a fault with no severity is taken at its word.
  const stopping = (raw) => {
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.some((e) => !/^(WARN|WARNING|INFO)$/i.test(String(e?.severity ?? "")));
    } catch {
      return false;
    }
  };
  const kindOf = (r) => (r.e_stop ? "e-stop" : r.stuck ? "stuck" : r.errors && stopping(r.errors) ? "error" : null);
  const gapMs = Math.max(EPISODE_GAP_MS, sampleMs * 1.5);
  const out = [];
  let cur = null;
  for (const r of rows) {
    const kind = kindOf(r);
    if (!kind) continue;
    if (cur && cur.kind === kind && r.at - cur.lastAt <= gapMs) {
      cur.lastAt = r.at;
      continue;
    }
    if (cur) out.push(cur);
    let code = null;
    if (kind === "error") {
      try {
        const e = JSON.parse(r.errors);
        code = Array.isArray(e) ? (e[0]?.code ?? e[0] ?? null) : (e?.code ?? null);
      } catch {
        code = null;
      }
    }
    cur = { kind, firstAt: r.at, lastAt: r.at, code, poseX: r.pose_x ?? null, poseY: r.pose_y ?? null };
  }
  if (cur) out.push(cur);
  return out.map((e) => ({
    kind: e.kind,
    date: dateKey(e.firstAt, tz),
    start: hhmm(e.firstAt, tz),
    at: e.firstAt,
    minutes: Math.max(1, Math.round((e.lastAt - e.firstAt + sampleMs) / 60_000)),
    cause: e.kind === "error" ? `error ${e.code ?? "unknown"}` : e.kind,
    place: null,
    pose: e.poseX === null ? null : { x: e.poseX, y: e.poseY },
  }));
}

function anchorDayFor(store, tz) {
  const stored = Number(store.getKV(KV_BILLING_DAY));
  if (stored >= 1 && stored <= 28) return stored;
  const range = store.rollupTimeRange();
  if (!range) return 1;
  return Math.min(28, Number(dateKey(range.minAt, tz).slice(8)));
}

/** The whole contract for one customer. */
export function fleetContract(store, nowMs, config = {}) {
  const tz = store.getKV(KV_TZ) || config.owner?.tz || DEFAULT_TZ;
  const range = store.rollupTimeRange();
  // As of the end of the telemetry, never past it: an export from July must
  // open on July, not on an empty September.
  const asOfMs = range ? Math.min(nowMs, range.maxAt) : nowMs;
  const periods = billingPeriods(asOfMs, { anchorDay: anchorDayFor(store, tz), tz });
  const open = periods[0];
  const oldestFrom = periods[periods.length - 1].fromMs;

  const excluded = new Set(store.listExclusions());
  const econRows = new Map(store.listRobotEconomics().map((r) => [r.robot_id, r]));
  const contractRows = new Map(store.listRobotContracts().map((r) => [r.robot_id, r]));
  const fleetsById = new Map(store.listFleets().map((f) => [f.id, f]));

  // Sites: the owner's own list first, then any older fleet names, then one
  // default. Ids are strings so the frontend never confuses them with indexes.
  const siteList = [];
  const siteIdByName = new Map();
  const addSite = (name, id) => {
    if (siteIdByName.has(name)) return siteIdByName.get(name);
    // Stored sites are s<id>; sites known only by an older fleet name, or the
    // default, are f<n>, so the two can never collide.
    const sid = id ?? `f${siteList.length + 1}`;
    siteList.push({ id: sid, name });
    siteIdByName.set(name, sid);
    return sid;
  };
  const siteNameById = new Map(store.listSites().map((s) => [s.id, s.name]));
  for (const s of store.listSites()) addSite(s.name, `s${s.id}`);

  const rollupsByRobot = new Map();
  for (const row of store.rollupsBetweenAll(oldestFrom, open.toMs)) {
    if (!rollupsByRobot.has(row.robot_id)) rollupsByRobot.set(row.robot_id, []);
    rollupsByRobot.get(row.robot_id).push(row);
  }
  const within = (rows, a, b) => (rows ?? []).filter((r) => r.bucket_start_at >= a && r.bucket_start_at < b);

  const robots = [];
  const daily = [];
  const downtime = [];
  const keeping = [];
  const safety = [];
  const contracts = [];
  const coverageByPeriod = periods.map(() => new Map()); // siteId -> {work, invoice, active, cap}

  for (const r of store.listRobots()) {
    if (excluded.has(r.id)) continue;
    const siteName = siteNameById.get(r.site_id) ?? fleetsById.get(r.fleet_id)?.name ?? DEFAULT_SITE;
    const siteId = addSite(siteName);
    const econ = economicsFor(r, econRows.get(r.id) ?? null);
    const all = rollupsByRobot.get(r.id) ?? [];
    const bench = BENCHMARKS[r.category] ?? null;

    const perPeriod = periods.map((p, i) => {
      // A period with no telemetry for this robot has no reading, not a zero
      // one. A period the telemetry only partly covers is prorated over the
      // days that exist, the same clamp ownerModel applies, so a new customer's
      // first half-month does not read as a robot earning half its lease.
      const rows = within(all, p.fromMs, p.toMs);
      if (!rows.length) return null;
      const fromMs = Math.max(p.fromMs, range.minAt);
      const toMs = Math.min(p.toMs, range.maxAt);
      const fin = robotFinancials(rows, econ, { fromMs, toMs });
      if (fin) {
        const agg = coverageByPeriod[i].get(siteId) ?? { work: 0, invoice: 0, active: 0, cap: 0 };
        agg.work += fin.workServicedCents;
        agg.invoice += fin.invoiceProratedCents ?? 0;
        agg.active += fin.activeMs;
        agg.cap += fin.capacityMs ?? 0;
        coverageByPeriod[i].set(siteId, agg);
      }
      return fin;
    });
    const fin = perPeriod[0];
    const prev = perPeriod[1];

    const openRows = within(all, open.fromMs, open.toMs);
    // Every day on record across all six periods, not just the open one: the
    // dense coverage line and the period charts read the same days.
    const byDay = new Map();
    for (const row of all) {
      const k = dateKey(row.bucket_start_at, tz);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(row);
    }
    for (const [date, rows] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      daily.push({ robotId: r.id, date, units: Math.round(taskCount(rows, econ?.taskBasis ?? "mission") * 10) / 10 });
    }

    const samples = openRows.reduce((n, x) => n + (x.sample_count ?? 0), 0);
    const sampleMs = samples > 0 ? openRows.reduce((n, x) => n + (x.bucket_ms ?? 0), 0) / samples : undefined;
    for (const ep of downtimeEpisodes(store.abnormalSnapshots(r.id, open.fromMs, open.toMs), { tz, sampleMs })) {
      downtime.push({ robotId: r.id, ...ep });
      if (ep.kind === "e-stop") safety.push({ robotId: r.id, date: ep.date, time: ep.start, kind: "e-stop", note: null });
    }

    if (fin) {
      const samples = store.stuckSampleCount(r.id, open.fromMs, open.toMs);
      const manual = store.manualControlSamples(r.id, open.fromMs, open.toMs);
      const iv = robotInterventions({
        robot: { id: r.id, name: r.display_name ?? r.robot_key },
        rollups: openRows,
        wageCentsHour: fin.wageCentsHour,
        wageIsBenchmark: fin.wageIsBenchmark,
        stuckSamples: samples.stuck,
        totalSamples: samples.total,
        conditionSamples: manual.total,
        activeManualSamples: manual.activeManual,
        activeSamples: manual.activeTotal,
        activeMs: fin.activeMs,
        observedMs: openRows.reduce((n, x) => n + (x.bucket_ms ?? 0), 0),
      });
      keeping.push({
        robotId: r.id,
        stalls: iv.clears,
        handHours: iv.manualHours, // null = this vendor does not report it
        stalledHours: Math.round(iv.stalledHours * 10) / 10,
      });
    }

    const c = contractRows.get(r.id);
    if (c) {
      contracts.push({
        robotId: r.id,
        startDate: c.start_date,
        termMonths: c.term_months,
        paybackMonths: c.payback_months,
        uptimePct: c.uptime_pct,
        equipCostCents: c.equip_cost_cents,
      });
    }

    const wear = store.latestComponentWear(r.id) ?? [];
    const latest = store.latestSnapshot(r.id);
    robots.push({
      id: r.id,
      key: r.robot_key,
      name: r.display_name ?? r.robot_key,
      brand: r.brand,
      model: r.model,
      siteId,
      category: r.category,
      work: bench?.label ?? r.category,
      unitLabel: taskLabelFor(r.category),
      basis: econ?.taskBasis ?? null,
      source: latest?.source ?? null,
      lastSeenAt: r.last_seen_at,
      configured: econRows.has(r.id),
      scheduledHoursDay: econ?.operatingHoursDay ?? null,
      invoiceCentsMonth: econ?.invoiceCentsMonth ?? null,
      rateCents: econ?.rateCents ?? null,
      wageCentsHour: econ?.wageCentsHour ?? null,
      wageIsBenchmark: econ?.wageIsBenchmark ?? null,
      units: fin ? Math.round(fin.tasks * 10) / 10 : null,
      activeHours: fin ? Math.round((fin.activeMs / 3_600_000) * 10) / 10 : null,
      capacityHours: fin?.capacityMs ? Math.round((fin.capacityMs / 3_600_000) * 10) / 10 : null,
      dutyPct: fin?.utilizationPct ?? null,
      coverage: fin?.coverage ?? null,
      coverageDelta: fin?.coverage != null && prev?.coverage != null ? fin.coverage - prev.coverage : null,
      parts: wear.map((w) => ({
        name: w.component,
        remainingPct: w.remaining_pct,
        usedHours: w.used_life_hours,
        lifeHours: w.life_span_hours,
      })),
    });
  }

  const periodsOut = periods.map((p, i) => {
    const siteCoverage = {};
    const siteUtilization = {};
    for (const s of siteList) {
      const a = coverageByPeriod[i].get(s.id);
      siteCoverage[s.id] = a && a.invoice > 0 ? a.work / a.invoice : null;
      siteUtilization[s.id] = a && a.cap > 0 ? (a.active / a.cap) * 100 : null;
    }
    const seenFrom = range ? Math.max(p.fromMs, range.minAt) : p.fromMs;
    const seenTo = range ? Math.min(p.toMs, range.maxAt) : p.fromMs;
    const observedDays = Math.max(0, Math.round(((seenTo - seenFrom) / 86_400_000) * 10) / 10);
    const days = Math.round((p.toMs - p.fromMs) / 86_400_000);
    return {
      start: p.start, end: p.end, label: p.label, status: p.status,
      days, observedDays, partial: observedDays < days,
      siteCoverage, siteUtilization,
    };
  });

  const tickets = store.listTickets().map((t) => ({
    id: t.id,
    ref: t.ref,
    brand: t.brand,
    robotId: t.robot_id,
    title: t.title,
    openedAt: t.opened_at,
    respondedAt: t.responded_at,
    status: t.status,
  }));

  const filled = (arr) => (arr.length ? "present" : "missing");
  return {
    version: CONTRACT_VERSION,
    asOf: asOfMs,
    tz,
    hasTelemetry: range !== null,
    minutesPerClear: MINUTES_PER_CLEAR,
    sites: siteList,
    periods: periodsOut,
    robots,
    daily,
    downtime,
    keeping,
    safety,
    contracts,
    tickets,
    // Where each table came from, so the page can say "from the robot" or
    // "you set this" at the figure, and "not reported" where nothing came.
    provenance: {
      robots: robots.length ? "vendor" : "missing",
      daily: daily.length ? "vendor" : "missing",
      downtime: downtime.length ? "derived" : filled(downtime),
      keeping: keeping.length ? "derived" : "missing",
      safety: safety.length ? "derived" : "missing",
      parts: robots.some((r) => r.parts.length) ? "vendor" : "missing",
      contracts: contracts.length ? "owner" : "missing",
      tickets: tickets.length ? "owner" : "missing",
      economics: robots.some((r) => r.configured) ? "owner" : "benchmark",
    },
  };
}

// Exported for tests.
export const _internal = { localMidnightMs, addMonthsKey, addDaysKey };
