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
import { BENCHMARKS, EQUIP_COST_CENTS, economicsFor, taskLabelFor } from "./rates.mjs";
import { robotInterventions, MINUTES_PER_CLEAR } from "./interventions.mjs";
import { loadInputs } from "./inputs.mjs";

export const CONTRACT_VERSION = 1;
const DEFAULT_SITE = "Main site";
const DEFAULT_TZ = "America/Los_Angeles";
const PERIODS_BACK = 6;
const DAY_MS = 86_400_000;
// A period closes a day after it ends, so a late sync or an export that lands
// the next morning is still counted before the figures freeze.
export const CLOSE_GRACE_MS = DAY_MS;
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

/** The 2-metre spot a pose falls in, the same grid the dashboard labels
 *  "near x, y m". The key a place name is saved under. */
export function spotKey(pose) {
  return pose ? `${Math.round(pose.x / 2) * 2},${Math.round(pose.y / 2) * 2}` : null;
}
const siteSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
  // Periods already closed read their frozen figures, never today's math.
  const frozenByStart = new Map(store.listPeriodCloses().map((c) => [c.start, c]));
  const frozenFor = (p) => {
    const f = frozenByStart.get(p.start);
    return f && f.end === p.end ? f : null;
  };

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
  const robotsByPeriod = periods.map(() => ({})); // robotId -> the figures a close freezes
  const pastDowntime = [];
  const inputs = loadInputs(store);
  const placeNames = inputs.account.placeNames ?? {};
  // A stall where the owner has named the spot carries the name.
  const named = (siteName, ep) => {
    const spot = spotKey(ep.pose);
    return { ...ep, spot, place: (spot && placeNames[siteSlug(siteName)]?.[spot]) || ep.place };
  };

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
    const openEpisodes = downtimeEpisodes(store.abnormalSnapshots(r.id, open.fromMs, open.toMs), { tz, sampleMs }).map((e) => named(siteName, e));
    for (const ep of openEpisodes) {
      downtime.push({ robotId: r.id, ...ep });
      if (ep.kind === "e-stop") safety.push({ robotId: r.id, date: ep.date, time: ep.start, kind: "e-stop", note: null });
    }
    // Earlier periods' episodes feed their uptime and credit only. The
    // downtime table stays the open period's, which is what the page reads.
    const samplesAll = all.reduce((n, x) => n + (x.sample_count ?? 0), 0);
    const pastEpisodes = periods.length > 1
      ? downtimeEpisodes(store.abnormalSnapshots(r.id, oldestFrom, open.fromMs), {
          tz,
          sampleMs: samplesAll > 0 ? all.reduce((n, x) => n + (x.bucket_ms ?? 0), 0) / samplesAll : sampleMs,
        }).map((e) => named(siteName, e))
      : [];
    // Listed too, by period, so a closed period's stops can be read back.
    for (const e of pastEpisodes) {
      const p = periods.find((x) => e.at >= x.fromMs && e.at < x.toMs);
      if (p) pastDowntime.push({ robotId: r.id, period: p.start, ...e });
    }

    // What each period comes to for this robot: the figures a close freezes.
    // Uptime is against the hours scheduled on the days telemetry covers, and
    // a credit is only worked out where the owner stated a lease with an
    // uptime promise; none is assumed.
    const lease = contractRows.get(r.id);
    periods.forEach((p, i) => {
      const f = perPeriod[i];
      if (!f) return;
      const eps = i === 0 ? openEpisodes : pastEpisodes.filter((e) => e.at >= p.fromMs && e.at < p.toMs);
      const downMin = eps.reduce((a, e) => a + e.minutes, 0);
      const seenDays = Math.max(0, (Math.min(p.toMs, range.maxAt) - Math.max(p.fromMs, range.minAt)) / DAY_MS);
      const hoursDay = econ?.operatingHoursDay ?? null;
      const scheduledMin = hoursDay ? Math.round(hoursDay * seenDays * 60) : null;
      const delivered = scheduledMin > 0 ? Math.max(0, (1 - downMin / scheduledMin) * 100) : null;
      const promised = lease?.uptime_pct ?? null;
      const gap = delivered !== null && promised !== null ? Math.max(0, Math.round((promised - delivered) * 100) / 100) : null;
      const invoice = f.invoiceProratedCents ?? null;
      robotsByPeriod[i][r.id] = {
        name: r.display_name ?? r.robot_key,
        site: siteName,
        work: bench?.label ?? r.category,
        units: Math.round(f.tasks * 10) / 10,
        workCents: Math.round(f.workServicedCents),
        invoiceCents: invoice === null ? null : Math.round(invoice),
        coverage: f.coverage ?? null,
        activeHours: Math.round((f.activeMs / 3_600_000) * 10) / 10,
        dutyPct: f.utilizationPct ?? null,
        incidents: eps.length,
        downtimeMinutes: downMin,
        scheduledMinutes: scheduledMin,
        deliveredUptimePct: delivered === null ? null : Math.round(delivered * 100) / 100,
        promisedUptimePct: promised,
        creditCents: gap !== null && invoice !== null ? Math.round(gap * 0.01 * invoice) : null,
      };
    });

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
      coverageDelta: (() => {
        // Against last period as it closed, when it has.
        const was = periods[1] && frozenFor(periods[1]) ? frozenFor(periods[1]).robots[r.id]?.coverage ?? null : prev?.coverage ?? null;
        return fin?.coverage != null && was != null ? fin.coverage - was : null;
      })(),
      parts: wear.map((w) => ({
        name: w.component,
        remainingPct: w.remaining_pct,
        usedHours: w.used_life_hours,
        lifeHours: w.life_span_hours,
      })),
    });
  }

  const periodsOut = periods.map((p, i) => {
    const frozen = frozenFor(p);
    const siteCoverage = {};
    const siteUtilization = {};
    for (const s of siteList) {
      if (frozen) {
        // A site added since the close had nothing in that period.
        siteCoverage[s.id] = frozen.sites[s.name]?.coverage ?? null;
        siteUtilization[s.id] = frozen.sites[s.name]?.utilization ?? null;
        continue;
      }
      const a = coverageByPeriod[i].get(s.id);
      siteCoverage[s.id] = a && a.invoice > 0 ? a.work / a.invoice : null;
      siteUtilization[s.id] = a && a.cap > 0 ? (a.active / a.cap) * 100 : null;
    }
    const robotFigures = frozen ? frozen.robots : robotsByPeriod[i];
    const seenFrom = range ? Math.max(p.fromMs, range.minAt) : p.fromMs;
    const seenTo = range ? Math.min(p.toMs, range.maxAt) : p.fromMs;
    const observedDays = Math.max(0, Math.round(((seenTo - seenFrom) / 86_400_000) * 10) / 10);
    const days = Math.round((p.toMs - p.fromMs) / 86_400_000);
    return {
      start: p.start, end: p.end, label: p.label,
      // A period the close has frozen is closed whatever the calendar says.
      status: frozen ? "closed" : p.status,
      days, observedDays, partial: observedDays < days,
      siteCoverage, siteUtilization,
      frozen: Boolean(frozen),
      closedAt: frozen ? frozen.closedAt : null,
      closeable: !frozen && range !== null && range.maxAt >= p.toMs,
      endsAtMs: p.toMs,
      totals: frozen ? frozen.totals : periodTotals(robotFigures),
      robots: Object.entries(robotFigures).map(([robotId, f]) => ({ robotId: Number(robotId), ...f })),
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

  // Payback from what each robot actually earned, period by period: every
  // closed period on record (not only the six shown) plus the ones still
  // open or closing. Months between the lease start and the first data are
  // counted but not guessed at, and a verdict is only given when the data
  // settles it.
  const asOfKey = dateKey(asOfMs, tz);
  const measuredByRobot = new Map();
  const seenStart = new Set();
  for (const close of store.listPeriodCloses()) {
    seenStart.add(close.start);
    for (const [id, f] of Object.entries(close.robots)) {
      if (!measuredByRobot.has(Number(id))) measuredByRobot.set(Number(id), []);
      measuredByRobot.get(Number(id)).push({ start: close.start, end: close.end, workCents: f.workCents, invoiceCents: f.invoiceCents, frozen: true });
    }
  }
  for (const p of periodsOut) {
    if (seenStart.has(p.start)) continue;
    for (const f of p.robots) {
      if (!measuredByRobot.has(f.robotId)) measuredByRobot.set(f.robotId, []);
      measuredByRobot.get(f.robotId).push({ start: p.start, end: p.end, workCents: f.workCents, invoiceCents: f.invoiceCents, frozen: false });
    }
  }
  const payback = robots.map((r) => {
    const lease = contractRows.get(r.id) ?? null;
    const months = (measuredByRobot.get(r.id) ?? []).sort((a, b) => (a.start < b.start ? -1 : 1));
    return { robotId: r.id, ...paybackFor({ lease, category: r.category, months, asOfKey }) };
  });

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
    // Stops in the closed periods shown, each tagged with its period's start.
    pastDowntime,
    // What the owner typed on the dashboard, restored into the page on load.
    inputs,
    // When each alert rule last actually emailed the owner (alerts.mjs).
    alertLog: (() => {
      try {
        return JSON.parse(store.getKV("alerts.log") ?? "{}") ?? {};
      } catch {
        return {};
      }
    })(),
    payback,
    // Every rate the figures have used, newest first, and who set it.
    rateHistory: store.listRateChanges().map((r) => ({ work: r.work, cents: r.cents, unit: r.unit, own: Boolean(r.own), by: r.by_email, at: r.at })),
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

/** Whole months from one date key to another (Jan 15 to Mar 14 is 1). */
export function monthsBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split("-").map(Number);
  const [y2, m2, d2] = toKey.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** One robot's payback from measured months. Statuses:
 *  - paid: what it earned in measured months alone has crossed its price
 *  - on track / behind / missed: every month since the lease began is
 *    measured, so the pace is known (missed = past the promised month and
 *    not paid)
 *  - partly measured: months before the data began are unknown, so no
 *    verdict; the measured pace is still given
 *  - no lease / no price: nothing to measure against */
export function paybackFor({ lease, category, months, asOfKey }) {
  const priceCents = lease?.equip_cost_cents ?? EQUIP_COST_CENTS[category] ?? null;
  const priceSource = lease?.equip_cost_cents != null ? "owner" : priceCents != null ? "benchmark" : null;
  const earnedCents = months.reduce((a, m) => a + (m.workCents ?? 0), 0);
  const base = { priceCents, priceSource, leaseStart: lease?.start_date ?? null, promisedMonths: lease?.payback_months ?? null, months, earnedCents };
  if (!lease?.start_date) return { ...base, status: "no lease", monthsSinceStart: null, monthsUnmeasured: null, paceMonths: null };
  if (!priceCents) return { ...base, status: "no price", monthsSinceStart: null, monthsUnmeasured: null, paceMonths: null };
  const since = monthsBetween(lease.start_date, asOfKey);
  // A period that began before the lease still counts: the robot was working.
  const unmeasured = Math.max(0, since - months.length);
  const recent = months.slice(-3);
  const perMonth = recent.length ? recent.reduce((a, m) => a + (m.workCents ?? 0), 0) / recent.length : 0;
  const paceMonths = earnedCents >= priceCents ? null : perMonth > 0 ? since + Math.ceil((priceCents - earnedCents) / perMonth) : null;
  let status;
  if (earnedCents >= priceCents) status = "paid";
  else if (unmeasured > 0) status = "partly measured";
  else if (lease.payback_months != null && since >= lease.payback_months) status = "missed";
  else status = paceMonths !== null && lease.payback_months != null && paceMonths <= lease.payback_months ? "on track" : "behind";
  return { ...base, status, monthsSinceStart: since, monthsUnmeasured: unmeasured, paceMonths };
}

/** Fleet totals for one period from its robots' figures. A credit total is
 *  null when no robot has a stated uptime promise, not zero. */
function periodTotals(robots) {
  const list = Object.values(robots);
  const sum = (k) => list.reduce((a, f) => a + (f[k] ?? 0), 0);
  const work = sum("workCents");
  const invoice = sum("invoiceCents");
  const credits = list.filter((f) => f.creditCents !== null);
  return {
    robots: list.length,
    units: Math.round(sum("units") * 10) / 10,
    workCents: work,
    invoiceCents: invoice,
    coverage: invoice > 0 ? work / invoice : null,
    downtimeMinutes: sum("downtimeMinutes"),
    incidents: sum("incidents"),
    creditCents: credits.length ? credits.reduce((a, f) => a + f.creditCents, 0) : null,
  };
}

/** Freeze every period that has ended, is a grace day past its end, and whose
 *  telemetry has moved past it (so an export that stops mid-period does not
 *  freeze a half-counted month). Idempotent: a closed period is never
 *  rewritten. The caller decides whether this account may close yet (a fleet
 *  still being set up would freeze benchmark invoices). Returns the starts
 *  of the periods it closed. */
export function closePeriods(store, nowMs, config = {}) {
  const c = fleetContract(store, nowMs, config);
  const nameById = new Map(c.sites.map((s) => [s.id, s.name]));
  const closed = [];
  for (const p of c.periods) {
    if (p.frozen || !p.closeable || !p.robots.length) continue;
    if (nowMs < p.endsAtMs + CLOSE_GRACE_MS) continue;
    const sites = {};
    for (const [id, cov] of Object.entries(p.siteCoverage)) {
      if (cov === null && p.siteUtilization[id] === null) continue;
      sites[nameById.get(id)] = { coverage: cov, utilization: p.siteUtilization[id] };
    }
    const robots = {};
    for (const { robotId, ...f } of p.robots) robots[robotId] = f;
    if (store.closePeriod({ start: p.start, end: p.end, sites, totals: p.totals, robots }, nowMs)) closed.push(p.start);
  }
  return closed;
}

// Exported for tests.
export const _internal = { localMidnightMs, addMonthsKey, addDaysKey };
