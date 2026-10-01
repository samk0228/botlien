// Replaying a gateway recording through Botlien, the way the Overnight Line
// Benchmark (Antonio, v1.1, Sep 30 2026) measured a line. Every event the
// gateway sent goes, in order, through the same push path a live account
// takes. Then, for each arm: the share of the recording it spent working,
// waiting, stopped and offline, the stops it had, the cycles it counted,
// and what it costs. The server's own reading (rollups, downtime episodes,
// the contract's cost block) is set beside the harness's count, so a
// disagreement between what the dashboard would show and what the recording
// says is visible in one table. `compare` checks a report against the
// figures Line Lab reported for the same run.
import { openStore } from "./store.mjs";
import { pushEvents, MAX_EVENTS } from "./push.mjs";
import { rebuildRollupsForRobot } from "./rollup.mjs";
import { fleetContract, downtimeEpisodes } from "./contract.mjs";
import { setBusinessType, KV_CONFIRMED } from "./owner.mjs";
import { COST_DEFAULTS, idleCostPerYear, costPerWorkingHour } from "./robot-cost.mjs";

// The same cap the rollups use: a gap longer than this is dark time.
const MAX_GAP_MS = 5 * 60_000;
export const STATES = ["working", "waiting", "stopped", "paused", "idle", "off", "offline"];

function parseErrors(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const l = JSON.parse(raw);
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}
const stopping = (e) => !/^(WARN|WARNING|INFO)$/i.test(String(e?.severity ?? ""));

/** The lines of a recording as events in time order. Bad lines are listed,
 *  not fatal: a recording cut off mid-line still replays. */
export function parseRecording(text) {
  const events = [];
  const bad = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      const e = JSON.parse(t);
      if (e && typeof e === "object" && !Array.isArray(e)) events.push(e);
      else bad.push(i + 1);
    } catch {
      bad.push(i + 1);
    }
  });
  events.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  return { events, bad };
}

/** What a stored sample says the arm was doing, in the benchmark's words. */
export function stateOf(s) {
  if (s.connection_state === "offline") return "offline";
  if (s.e_stop === 1 || s.e_stop === true || s.stuck === 1 || s.stuck === true) return "stopped";
  if (parseErrors(s.errors).some(stopping)) return "stopped";
  switch (s.mission_state) {
    case "active": return "working";
    case "waiting": return "waiting";
    case "paused": return "paused";
    case "off": return "off";
    default: return "idle";
  }
}

/** Integrate one robot's samples: milliseconds in each state, cycles,
 *  stops (a run of stopped samples), over the recording. Each sample holds
 *  until the next, never longer than the gap cap. Cycles from a controller's
 *  counter (`cycle:<program>:<n>`) are the counter's rise over the recording;
 *  any other mission ids are counted distinct. */
export function measure(snapshots, { maxGapMs = MAX_GAP_MS } = {}) {
  const ms = Object.fromEntries(STATES.map((k) => [k, 0]));
  const ids = new Set();
  let lo = Infinity, hi = -Infinity, counted = 0;
  let stops = 0;
  let prevStopped = false;
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const next = snapshots[i + 1];
    const st = stateOf(s);
    if (st === "stopped" && !prevStopped) stops += 1;
    prevStopped = st === "stopped";
    if (s.mission_id) {
      const m = /^cycle:[^:]*:(\d+)$/.exec(s.mission_id);
      if (m) {
        const n = Number(m[1]);
        lo = Math.min(lo, n);
        hi = Math.max(hi, n);
        counted += 1;
      } else ids.add(s.mission_id);
    }
    if (next) ms[st] += Math.max(0, Math.min(next.at - s.at, maxGapMs));
  }
  const span = snapshots.length ? snapshots[snapshots.length - 1].at - snapshots[0].at : 0;
  const covered = Object.values(ms).reduce((a, b) => a + b, 0);
  const cycles = (counted ? hi - lo : 0) + ids.size;
  return { ms, span, covered, cycles, stops, share: Object.fromEntries(STATES.map((k) => [k, covered > 0 ? ms[k] / covered : null])) };
}

/** Play a recording into a fresh manufacturing account. */
export function replay(events, { config = {}, tz = "America/Los_Angeles", nowMs = null } = {}) {
  const store = openStore(":memory:");
  setBusinessType(store, "manufacturing");
  store.setKV("owner.tz", tz);
  const to = events.length ? Date.parse(events[events.length - 1].at) : Date.now();
  const at = nowMs ?? to + 60_000;
  let accepted = 0;
  const rejected = [];
  for (let i = 0; i < events.length; i += MAX_EVENTS) {
    const out = pushEvents(store, { events: events.slice(i, i + MAX_EVENTS) }, at, config);
    if (out.error) throw new Error(out.error);
    accepted += out.accepted;
    rejected.push(...out.rejected.map((r) => ({ ...r, index: r.index + i })));
  }
  for (const r of store.listRobots()) rebuildRollupsForRobot(store, r.id);
  store.setKV(KV_CONFIRMED, "1");
  return { store, accepted, rejected, from: events.length ? Date.parse(events[0].at) : null, to, nowMs: at };
}

const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);

/** One row per robot: the harness's measurement, the server's reading, and
 *  the benchmark's dollar figures built on the recording's working share. */
export function report(replayed, { config = {} } = {}) {
  const { store, nowMs, from, to } = replayed;
  const contract = fleetContract(store, nowMs, config);
  const robots = store.listRobots().map((r) => {
    const m = measure(store.snapshotsBetween(r.id, 0, nowMs));
    const cr = contract.robots.find((x) => x.id === r.id) ?? null;
    const episodes = downtimeEpisodes(store.abnormalSnapshots(r.id, 0, nowMs));
    const perHour = cr?.cost?.perHourCents ?? null;
    const hoursPerYear = cr?.cost?.hoursPerYear ?? COST_DEFAULTS.hoursPerYear;
    const working = m.share.working;
    return {
      id: r.id,
      name: r.display_name ?? r.external_id,
      model: r.model,
      category: r.category,
      measured: { ...m.share, cycles: m.cycles, stops: m.stops, downMinutes: Math.round(m.ms.stopped / 60_000), offlineMinutes: Math.round(m.ms.offline / 60_000), spanMinutes: Math.round(m.span / 60_000) },
      server: {
        workingPct: cr?.dutyPct ?? null,
        activeHours: cr?.activeHours ?? null,
        units: cr?.units ?? null,
        stops: episodes.length,
        downMinutes: episodes.reduce((n, e) => n + e.minutes, 0),
        armLabel: cr?.cost?.armLabel ?? null,
        perHourCents: perHour,
        perWorkingHourCents: cr?.cost?.perWorkingHourCents ?? null,
        idleCostYearCents: cr?.cost?.idleCostYearCents ?? null,
        estimated: cr?.cost?.estimated ?? null,
      },
      // The benchmark's own arithmetic on this recording: C over the share
      // of the recording the arm worked, and the year's idle cost at that share.
      bench: perHour === null || working === null
        ? null
        : { perHourCents: perHour, perWorkingHourCents: costPerWorkingHour(perHour, working), idleCostYearCents: idleCostPerYear(perHour, working, hoursPerYear), hoursPerYear },
    };
  });
  const perHourCents = sum(robots, (r) => r.server.perHourCents);
  const idleCostYearCents = sum(robots, (r) => r.bench?.idleCostYearCents);
  const yearCents = sum(robots, (r) => (r.bench ? r.bench.perHourCents * r.bench.hoursPerYear : null));
  const hours = from !== null && to > from ? (to - from) / 3_600_000 : null;
  const cycles = sum(robots, (r) => r.measured.cycles);
  return {
    from, to,
    robots,
    line: {
      robots: robots.length,
      perHourCents,
      idleCostYearCents,
      shareIdle: yearCents > 0 ? idleCostYearCents / yearCents : null,
      cycles,
      outputPerHour: hours && hours > 0 ? cycles / hours : null,
      stops: sum(robots, (r) => r.measured.stops),
    },
  };
}

/** Check a report against what Line Lab reported for the same run. Shares
 *  within two points, counts exact unless a tolerance is given, dollars
 *  within three percent. Only the fields the expectation names are checked. */
export function compare(rep, expect, { sharePts = 0.02, dollarsPct = 0.03, countTol = 0 } = {}) {
  const checks = [];
  const near = (got, want, tol) => got !== null && got !== undefined && Number.isFinite(got) && Math.abs(got - want) <= tol;
  const cents = (c) => (c === null || c === undefined ? null : c / 100);
  const add = (robot, field, got, want, tol) => {
    if (want === undefined || want === null) return;
    checks.push({ robot, field, got: got ?? null, want, ok: near(got, want, tol) });
  };
  for (const [name, want] of Object.entries(expect.robots ?? {})) {
    const row = rep.robots.find((r) => String(r.name).toLowerCase() === name.toLowerCase()) ?? null;
    if (!row) {
      checks.push({ robot: name, field: "present", got: false, want: true, ok: false });
      continue;
    }
    add(name, "working", row.measured.working, want.working, sharePts);
    add(name, "waiting", row.measured.waiting, want.waiting, sharePts);
    add(name, "stops", row.measured.stops, want.stops, countTol);
    add(name, "cycles", row.measured.cycles, want.cycles, countTol);
    add(name, "costPerHour", cents(row.server.perHourCents), want.costPerHour, (want.costPerHour ?? 0) * dollarsPct);
    add(name, "perWorkingHour", cents(row.bench?.perWorkingHourCents), want.perWorkingHour, (want.perWorkingHour ?? 0) * dollarsPct);
    add(name, "idleCostYear", cents(row.bench?.idleCostYearCents), want.idleCostYear, (want.idleCostYear ?? 0) * dollarsPct);
  }
  const L = expect.line ?? {};
  add("line", "costPerHour", cents(rep.line.perHourCents), L.costPerHour, (L.costPerHour ?? 0) * dollarsPct);
  add("line", "idleCostYear", cents(rep.line.idleCostYearCents), L.idleCostYear, (L.idleCostYear ?? 0) * dollarsPct);
  add("line", "shareIdle", rep.line.shareIdle, L.shareIdle, sharePts);
  add("line", "outputPerHour", rep.line.outputPerHour, L.outputPerHour, (L.outputPerHour ?? 0) * dollarsPct);
  return { checks, ok: checks.every((c) => c.ok) };
}

const pct = (x) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const money = (c) => (c === null || c === undefined ? "–" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: c < 10_000 ? 2 : 0, minimumFractionDigits: c < 10_000 ? 2 : 0 })}`);
const pad = (v, w, right = false) => (right ? String(v).padStart(w) : String(v).padEnd(w));

/** The report as text, for the terminal. */
export function formatReport(rep, cmp = null) {
  const lines = [];
  const span = rep.from !== null ? `${new Date(rep.from).toISOString().slice(0, 16)}Z to ${new Date(rep.to).toISOString().slice(0, 16)}Z (${Math.round((rep.to - rep.from) / 60_000)} min)` : "empty recording";
  lines.push(`Recording: ${span}`);
  lines.push("");
  lines.push("Measured over the recording (harness), and what the server reads back:");
  const head = ["Robot", "Arm", "Working", "Waiting", "Stopped", "Offline", "Stops", "Cycles", "Down", "C/hr", "Per work hr", "Idle/yr", "Server working", "Server stops"];
  const widths = [18, 6, 8, 8, 8, 8, 6, 7, 7, 8, 12, 10, 15, 12];
  lines.push(head.map((h, i) => pad(h, widths[i], i > 1)).join(" "));
  for (const r of rep.robots) {
    const row = [
      r.name, r.server.armLabel ?? r.model ?? "–", pct(r.measured.working), pct(r.measured.waiting), pct(r.measured.stopped), pct(r.measured.offline),
      r.measured.stops, r.measured.cycles || "–", `${r.measured.downMinutes} min`, money(r.server.perHourCents), money(r.bench?.perWorkingHourCents ?? null), money(r.bench?.idleCostYearCents ?? null),
      r.server.workingPct === null ? "–" : `${r.server.workingPct}% (sched)`, `${r.server.stops} (${r.server.downMinutes} min)`,
    ];
    lines.push(row.map((v, i) => pad(v, widths[i], i > 1)).join(" "));
  }
  lines.push("");
  lines.push(`Line: ${rep.line.robots} robots, ${money(rep.line.perHourCents)} an hour to own and run, ${money(rep.line.idleCostYearCents)} idle a year (${pct(rep.line.shareIdle)} of robot cost), ${rep.line.stops} stops, ${rep.line.outputPerHour === null ? "output not counted" : `${Math.round(rep.line.outputPerHour)} cycles an hour`}.`);
  lines.push("Server working is against scheduled hours, not the recording, so it only matches on a full day. Dollars are the arm's list-price cost; 'estimated' until the owner enters a price and hours.");
  if (cmp) {
    lines.push("");
    lines.push(cmp.ok ? "Against Line Lab's figures: every check within tolerance." : "Against Line Lab's figures: differences found.");
    for (const c of cmp.checks) {
      const fmt = (v) => (typeof v === "number" ? (Math.abs(v) < 1 && v !== 0 ? `${Math.round(v * 1000) / 10}%` : Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
      lines.push(`  ${c.ok ? "ok  " : "DIFF"} ${pad(c.robot, 18)} ${pad(c.field, 15)} got ${fmt(c.got)}  want ${fmt(c.want)}`);
    }
  }
  return lines.join("\n");
}
