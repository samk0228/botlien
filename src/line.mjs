// The line map, and what it lets Botlien say. A customer's line is stations
// in order: robots, the machines between them that are not robots (a CNC
// mill, a sealer, another make's palletizer), and buffers (a conveyor that
// holds about ten boxes). Twins are robots doing the same job.
//
// With the order known, waiting has a direction. A robot waiting with the
// machine before it is starved; a robot waiting with the machine after it is
// blocked. When the robot on each side of a machine waits at once and no
// robot on the line has stopped, the machine between them is what is holding
// the line (Overnight Line Benchmark v1.1: 31 of 31 jams caught, the cause
// named right 25 times; every miss was a jam that began within seconds of a
// robot stop, which a stop always outranks here). A robot's stop, read the
// same way, says which other robots it left waiting, and the cost of a stop
// is every robot's own hourly cost times the minutes it stood.
export class LineMapError extends Error {}

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

/** What a stored sample says the robot was doing, in the benchmark's words:
 *  working, waiting, stopped, paused, idle, off or offline. */
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
export const KV_LINE_CURSOR = "line.cursor";
export const STATION_KINDS = ["robot", "machine", "buffer"];
export const STEP_MS = 15_000; // the gateway's heartbeat: the finest a state is known
export const JAM_MIN_MS = 90_000; // shorter than this is a cycle's normal wait, not a jam
export const MAX_GAP_MS = 5 * 60_000; // past this a robot's last sample says nothing
const MAX_LINES = 20;
const MAX_STATIONS = 60;

const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

/** Check a map the page saved and return it tidied. Throws LineMapError. */
export function validateLineMap(map, robotIds = new Set()) {
  if (map === null || map === undefined) return null;
  if (typeof map !== "object" || Array.isArray(map) || !Array.isArray(map.lines)) throw new LineMapError("A line map is { lines: [ { name, stations } ] }.");
  if (map.lines.length > MAX_LINES) throw new LineMapError(`At most ${MAX_LINES} lines.`);
  const seenRobots = new Set();
  const names = new Set();
  const lines = map.lines.map((l, li) => {
    if (!l || typeof l !== "object" || !text(l.name, 80)) throw new LineMapError(`Line ${li + 1} needs a name.`);
    const name = l.name.trim();
    if (names.has(name.toLowerCase())) throw new LineMapError(`Two lines are called ${name}.`);
    names.add(name.toLowerCase());
    if (!Array.isArray(l.stations) || l.stations.length > MAX_STATIONS) throw new LineMapError(`${name}: stations must be a list of at most ${MAX_STATIONS}.`);
    const stations = l.stations.map((s, si) => {
      if (!s || typeof s !== "object" || !STATION_KINDS.includes(s.kind)) throw new LineMapError(`${name}, station ${si + 1}: kind must be robot, machine or buffer.`);
      if (s.kind === "robot") {
        const id = Number(s.robotId);
        if (!Number.isInteger(id) || !robotIds.has(id)) throw new LineMapError(`${name}, station ${si + 1}: robot ${s.robotId ?? "?"} is not on this account.`);
        if (seenRobots.has(id)) throw new LineMapError(`${name}: robot ${id} is on the line twice.`);
        seenRobots.add(id);
        const twin = s.twin === undefined || s.twin === null || s.twin === "" ? null : String(s.twin).trim().slice(0, 40);
        return { kind: "robot", robotId: id, ...(twin ? { twin } : {}) };
      }
      if (!text(s.name, 80)) throw new LineMapError(`${name}, station ${si + 1}: a ${s.kind} needs a name.`);
      if (s.kind === "buffer") {
        const holds = s.holds === undefined || s.holds === null || s.holds === "" ? null : Number(s.holds);
        if (holds !== null && !(Number.isInteger(holds) && holds >= 0 && holds <= 100_000)) throw new LineMapError(`${name}: ${s.name} holds must be a whole number.`);
        return { kind: "buffer", name: s.name.trim(), ...(holds !== null ? { holds } : {}) };
      }
      return { kind: "machine", name: s.name.trim() };
    });
    if (!stations.some((s) => s.kind === "robot")) throw new LineMapError(`${name} has no robot on it.`);
    return { name, stations };
  });
  return { lines };
}

/** A first map from what is connected: one line per site, its robots in
 *  the order they were seen, no machines yet. Marked drafted so the page
 *  asks the owner to confirm it rather than treating it as known. */
export function draftLineMap(robots, sites = []) {
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const bySite = new Map();
  const seen = [...robots].sort((a, b) => (a.first_seen_at ?? 0) - (b.first_seen_at ?? 0) || a.id - b.id);
  for (const r of seen) {
    const key = r.site_id ?? 0;
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(r);
  }
  const lines = [...bySite.entries()].map(([key, list]) => ({
    name: siteName.get(key) ?? (bySite.size === 1 ? "Main line" : `Line ${key}`),
    stations: list.map((r) => ({ kind: "robot", robotId: r.id })),
  }));
  return { lines, drafted: true };
}

/** The map with each robot station carrying the robot's name and model. */
export function resolveLineMap(map, robots) {
  if (!map) return null;
  const byId = new Map(robots.map((r) => [r.id, r]));
  return {
    ...map,
    lines: map.lines.map((l) => ({
      ...l,
      stations: l.stations.map((s) => (s.kind === "robot" ? { ...s, name: byId.get(s.robotId)?.display_name ?? byId.get(s.robotId)?.external_id ?? `Robot ${s.robotId}`, model: byId.get(s.robotId)?.model ?? null } : s)),
    })),
  };
}

/** Each robot's state at every step from `from` to `to`, read from its
 *  samples: the latest sample at or before the step, as long as it is not
 *  older than the gap cap. Null where nothing is known. */
export function timeline(samplesByRobot, from, to, { stepMs = STEP_MS, maxGapMs = MAX_GAP_MS } = {}) {
  const times = [];
  for (let t = from; t <= to; t += stepMs) times.push(t);
  const states = {};
  for (const [robotId, samples] of Object.entries(samplesByRobot)) {
    const out = new Array(times.length).fill(null);
    let i = 0;
    let cur = null;
    for (let k = 0; k < times.length; k++) {
      while (i < samples.length && samples[i].at <= times[k]) cur = samples[i++];
      out[k] = cur && times[k] - cur.at <= maxGapMs ? stateOf(cur) : null;
    }
    states[robotId] = out;
  }
  return { times, states, stepMs };
}

/** The nearest robot before and after station `i`, skipping buffers. */
function neighbours(stations, i) {
  let up = null, down = null;
  for (let k = i - 1; k >= 0; k--) if (stations[k].kind === "robot") { up = stations[k].robotId; break; }
  for (let k = i + 1; k < stations.length; k++) if (stations[k].kind === "robot") { down = stations[k].robotId; break; }
  return { up, down };
}

/** Machine jams on one line over a timeline: stretches where the robot on
 *  each side of a machine is waiting and no robot on the line is stopped.
 *  A machine with a robot on one side only is judged on that robot, and
 *  says so. Returns one episode per stretch of at least minMs, with every
 *  robot that waited during it and for how long. The last episode has
 *  `open: true` when it ran to the end of the timeline. */
export function findJams(line, tl, { minMs = JAM_MIN_MS } = {}) {
  const robotIds = line.stations.filter((s) => s.kind === "robot").map((s) => s.robotId);
  const stoppedAt = (k) => robotIds.some((id) => tl.states[id]?.[k] === "stopped");
  const out = [];
  line.stations.forEach((st, i) => {
    if (st.kind !== "machine") return;
    const { up, down } = neighbours(line.stations, i);
    if (up === null && down === null) return;
    const sides = [up, down].filter((x) => x !== null);
    const jammed = (k) => sides.every((id) => tl.states[id]?.[k] === "waiting") && !stoppedAt(k);
    let start = null;
    const close = (endIdx, open) => {
      const startedAt = tl.times[start];
      const endedAt = open ? tl.times[endIdx] + tl.stepMs : tl.times[endIdx];
      if (endedAt - startedAt < minMs) return;
      const idle = {};
      for (let k = start; k < (open ? endIdx + 1 : endIdx); k++) for (const id of robotIds) if (tl.states[id]?.[k] === "waiting") idle[id] = (idle[id] ?? 0) + tl.stepMs;
      out.push({ station: st.name, index: i, startedAt, endedAt, open, confidence: sides.length === 2 ? "both sides" : "one side", idle });
    };
    for (let k = 0; k < tl.times.length; k++) {
      if (jammed(k)) {
        if (start === null) start = k;
      } else if (start !== null) {
        close(k, false);
        start = null;
      }
    }
    if (start !== null) close(tl.times.length - 1, true);
  });
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/** What each robot stop left waiting: for a stop of robot `robotId` from
 *  startedAt to endedAt (null while open), the other robots on its line in
 *  the waiting state during it, and for how long. */
export function stopImpacts(line, tl, stops) {
  const robotIds = line.stations.filter((s) => s.kind === "robot").map((s) => s.robotId);
  return stops
    .filter((s) => robotIds.includes(s.robotId))
    .map((s) => {
      const end = s.endedAt ?? tl.times[tl.times.length - 1] + tl.stepMs;
      const idle = {};
      for (let k = 0; k < tl.times.length; k++) {
        const t = tl.times[k];
        if (t < s.startedAt || t >= end) continue;
        for (const id of robotIds) if (id !== s.robotId && tl.states[id]?.[k] === "waiting") idle[id] = (idle[id] ?? 0) + tl.stepMs;
      }
      return { robotId: s.robotId, startedAt: s.startedAt, endedAt: s.endedAt ?? null, open: s.endedAt == null, idle };
    });
}

/** Robot-minutes idle, in cents: each robot's own hourly cost times its
 *  minutes. Robots with no cost block add minutes but no money. */
export function idleCost(idle, perHourCentsByRobot) {
  let ms = 0, cents = 0, priced = true;
  for (const [id, t] of Object.entries(idle)) {
    ms += t;
    const c = perHourCentsByRobot[id];
    if (c === null || c === undefined) priced = false;
    else cents += (c * t) / 3_600_000;
  }
  return { minutes: Math.round(ms / 60_000), cents: Math.round(cents), priced };
}

/** A stored line event in the shape the contract carries. */
export function lineEventOut(e, robotName, asOfMs) {
  const idleRaw = (() => {
    try {
      return JSON.parse(e.idle || "{}");
    } catch {
      return {};
    }
  })();
  const endedAt = e.ended_at ?? null;
  return {
    id: e.id,
    line: e.line,
    kind: e.kind,
    station: e.station,
    robotId: e.robot_id,
    confidence: e.confidence,
    startedAt: e.started_at,
    endedAt,
    open: e.status === "open",
    minutes: Math.max(1, Math.round(((endedAt ?? asOfMs) - e.started_at) / 60_000)),
    idle: Object.entries(idleRaw).map(([id, ms]) => ({ robotId: Number(id), name: robotName(Number(id)), minutes: Math.round(ms / 60_000) })),
    idleMinutes: e.idle_minutes,
    costCents: e.cost_cents,
    priced: Boolean(e.priced),
  };
}

/** Per line: robot-minutes and cents idle because of machines against
 *  because of robot stops, and what limited the line most. The benchmark's
 *  "robot idle time caused by non-robot machines" table, from this period. */
export function summarizeLines(map, events) {
  return (map?.lines ?? []).map((l) => {
    const own = events.filter((e) => e.line === l.name);
    const by = (kind) => own.filter((e) => e.kind === kind);
    const minutes = (list) => list.reduce((n, e) => n + e.idleMinutes, 0);
    const cents = (list) => list.reduce((n, e) => n + e.costCents, 0);
    const jams = by("jam"), stops = by("stop");
    const byMachines = minutes(jams), byRobots = minutes(stops);
    const total = byMachines + byRobots;
    const perStation = new Map();
    for (const e of own) perStation.set(`${e.kind}:${e.station}`, { kind: e.kind, station: e.station, idleMinutes: (perStation.get(`${e.kind}:${e.station}`)?.idleMinutes ?? 0) + e.idleMinutes, events: (perStation.get(`${e.kind}:${e.station}`)?.events ?? 0) + 1 });
    const limits = [...perStation.values()].sort((a, b) => b.idleMinutes - a.idleMinutes)[0] ?? null;
    return {
      name: l.name,
      robots: l.stations.filter((s) => s.kind === "robot").length,
      machines: l.stations.filter((s) => s.kind === "machine").length,
      jams: jams.length,
      stops: stops.length,
      idleMinutesByMachines: byMachines,
      idleMinutesByRobots: byRobots,
      costCentsByMachines: cents(jams),
      costCentsByRobots: cents(stops),
      shareByMachines: total > 0 ? byMachines / total : null,
      limits,
    };
  });
}
