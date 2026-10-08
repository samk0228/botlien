// A recorded run of Universal Robots arms, played into a demo account with
// today's timestamps so its stops happen now: a stop opens, nobody answers,
// it escalates, someone acknowledges, the arm comes back, someone logs what
// fixed it. Rewind wipes the demo account's robots and stops, ids and all,
// and plays the same recording again, so the same stop story comes out every
// time. That makes it a demo and a test fixture at once.
//
// Every sample lands through pushEvents, the path a real gateway's samples
// take, marked source "replay", and every stop it opens is marked replay for
// good, so nothing replayed is ever shown as live.
//
// Recordings: "stop-story" is built in (below). A gateway recording
// (`gateway.mjs --record run.jsonl`) can be loaded with loadRecording; its
// timestamps are rebased to offsets from its first sample.
import { pushEvents } from "./push.mjs";
import { saveInputs } from "./inputs.mjs";
import { setBusinessType, KV_CONFIRMED } from "./owner.mjs";
import { parseRecording } from "./benchmark.mjs";

export class ReplayError extends Error {}
export const KV_REPLAY = "replay.state"; // { recording, startedAt, next, speed, finishedAt }

const SEC = 1000;
const MIN = 60 * SEC;
const HEARTBEAT = 15 * SEC;

const ARMS = [
  { robot_id: "loader-1", name: "Loader 1", model: "UR10e" },
  { robot_id: "loader-2", name: "Loader 2", model: "UR10e" },
  { robot_id: "deburr", name: "Deburr", model: "UR5e" },
  { robot_id: "inspection", name: "Inspection", model: "UR3e" },
];

/** The built-in story, 40 minutes of four arms on a CNC line:
 *   2:00  Loader 2 protective stop C153. Deburr and Inspection starve.
 *  12:00  ten minutes unanswered: the dashboard escalates to the lead.
 *  16:00  Loader 2 is back.
 *  19:00  Loader 2 stops again, C153, within ten minutes: the same stop, 2nd in a row.
 *  22:00  back.
 *  30:00  Inspection faults, C207 vacuum lost, 4 minutes.
 *  40:00  the shift ends and every arm is switched off.
 *  Every arm sends a heartbeat each 15 seconds and a sample at each change,
 *  so the timeline is exact and the same every run. */
export function stopStory() {
  const END = 40 * MIN;
  const loader2Down = [[2 * MIN, 16 * MIN], [19 * MIN, 22 * MIN]];
  const inspectionDown = [[30 * MIN, 34 * MIN]];
  const within = (spans, t) => spans.some(([a, b]) => t >= a && t < b);
  const starved = (t) => within(loader2Down, t); // nothing reaches Deburr or Inspection while Loader 2 stands
  const C153 = { code: "C153", severity: "ERROR", description: "Protective stop: position deviation" };
  const C207 = { code: "C207", severity: "ERROR", description: "Gripper vacuum lost" };
  const sample = (arm, t) => {
    const base = { ...arm, category: "machine_tending", connection_state: "online", program: "cell1" };
    if (t >= END) return { ...base, mission_state: "off", moving: false, stuck: false, errors: [] };
    const cycle = Math.floor(t / (2 * MIN));
    if (arm.robot_id === "loader-2" && within(loader2Down, t)) return { ...base, mission_state: "paused", moving: false, stuck: true, errors: [C153], cycle_count: cycle };
    if (arm.robot_id === "inspection" && within(inspectionDown, t)) return { ...base, mission_state: "paused", moving: false, stuck: false, errors: [C207], cycle_count: cycle };
    if ((arm.robot_id === "deburr" || arm.robot_id === "inspection") && starved(t)) return { ...base, mission_state: "waiting", moving: false, stuck: false, errors: [], cycle_count: cycle };
    // 90 seconds of work, 30 waiting on the mill, each two-minute cycle.
    const working = t % (2 * MIN) < 90 * SEC;
    return { ...base, mission_state: working ? "active" : "waiting", moving: working, stuck: false, errors: [], cycle_count: cycle };
  };
  const changes = [0, END, ...loader2Down.flat(), ...inspectionDown.flat()];
  for (let t = 0; t < END; t += 2 * MIN) changes.push(t, t + 90 * SEC);
  const times = new Set(changes);
  for (let t = 0; t <= END; t += HEARTBEAT) times.add(t);
  const events = [];
  for (const t of [...times].filter((x) => x >= 0 && x <= END).sort((a, b) => a - b)) {
    for (const arm of ARMS) events.push({ offsetMs: t, event: sample(arm, t) });
  }
  // The two loaders do the same job side by side, so they are twins: one
  // stopping never counts as holding the other.
  return { name: "stop-story", durationMs: END, events, lineMap: { stations: [{ robot: "loader-1", twin: "loaders" }, { robot: "loader-2", twin: "loaders" }, { machine: "CNC mill A" }, { machine: "CNC mill B" }, "deburr", "inspection"] } };
}

/** A gateway recording, rebased to offsets from its first sample. */
export function loadRecording(name, text, { lineMap = null } = {}) {
  const { events } = parseRecording(text);
  if (!events.length) throw new ReplayError("That recording has no events.");
  const at = (e) => Date.parse(e.at ?? e.timestamp ?? e.time);
  const t0 = Math.min(...events.map(at));
  const list = events.map((e) => ({ offsetMs: at(e) - t0, event: (({ at: _a, timestamp: _t, time: _x, ...rest }) => rest)(e) })).sort((a, b) => a.offsetMs - b.offsetMs);
  return { name, durationMs: list[list.length - 1].offsetMs, events: list, lineMap };
}

const RECORDINGS = { "stop-story": stopStory };

export function recordingFor(name) {
  const make = RECORDINGS[name];
  if (!make) throw new ReplayError(`No recording called ${name}. Known: ${Object.keys(RECORDINGS).join(", ")}.`);
  return make();
}

function readState(store) {
  try {
    return JSON.parse(store.getKV(KV_REPLAY) || "null");
  } catch {
    return null;
  }
}

/** Wipe the demo account's fleet and start the recording from its first
 *  sample, now. The robots are made first, in the recording's order, so
 *  their ids (and so every stop's) are the same every run. */
export function rewind(store, { recording = "stop-story", speed = 1, by = null } = {}, nowMs) {
  const rec = recordingFor(recording);
  if (!(speed >= 1 && speed <= 60)) throw new ReplayError("speed is 1 to 60.");
  store.clearFleetData();
  setBusinessType(store, "manufacturing");
  const ids = new Map();
  for (const { event } of rec.events) {
    if (ids.has(event.robot_id)) continue;
    ids.set(event.robot_id, store.upsertRobot({ connector: "push", externalId: event.robot_id, displayName: event.name ?? null, brand: "Universal Robots", model: event.model ?? null, category: event.category ?? "machine_tending" }, nowMs));
  }
  if (rec.lineMap) {
    const stations = rec.lineMap.stations.map((s) =>
      typeof s === "string" ? { kind: "robot", robotId: ids.get(s) } : s.robot ? { kind: "robot", robotId: ids.get(s.robot), ...(s.twin ? { twin: s.twin } : {}) } : { kind: "machine", name: s.machine },
    );
    saveInputs(store, { account: { lineMap: { lines: [{ name: "Cell 1", stations }] } } }, nowMs, by);
  }
  store.setKV(KV_CONFIRMED, "1");
  const state = { recording: rec.name, startedAt: nowMs, next: 0, speed, finishedAt: null, total: rec.events.length, durationMs: rec.durationMs };
  store.setKV(KV_REPLAY, JSON.stringify(state));
  return state;
}

export function stopReplay(store, nowMs) {
  const s = readState(store);
  if (!s) return null;
  const out = { ...s, finishedAt: s.finishedAt ?? nowMs, stopped: true };
  store.setKV(KV_REPLAY, JSON.stringify(out));
  return out;
}

export function replayStatus(store, nowMs) {
  const s = readState(store);
  if (!s) return { running: false };
  const running = !s.finishedAt && !s.stopped;
  return { ...s, running, elapsedMs: Math.min(s.durationMs / s.speed, nowMs - s.startedAt), source: "replay" };
}

/** Play every sample that is due by now, each through the push path with
 *  its time moved to today. Samples go one at a time so a stop that opens
 *  and closes between two ticks is still seen. Returns how many landed. */
export function advance(store, nowMs, config = {}) {
  const s = readState(store);
  if (!s || s.finishedAt || s.stopped) return 0;
  const rec = recordingFor(s.recording);
  let n = 0;
  let i = s.next;
  for (; i < rec.events.length; i++) {
    const { offsetMs, event } = rec.events[i];
    const at = s.startedAt + Math.round(offsetMs / s.speed);
    if (at > nowMs) break;
    pushEvents(store, { events: [{ ...event, at: new Date(at).toISOString() }] }, nowMs, config, { source: "replay" });
    n++;
  }
  store.setKV(KV_REPLAY, JSON.stringify({ ...s, next: i, finishedAt: i >= rec.events.length ? nowMs : null }));
  return n;
}

/** Plays every account's running replay, every tick. */
export function createReplayJob({ control, tenants, config = {}, log = () => {} }) {
  return {
    tick(nowMs) {
      const out = [];
      for (const account of control.listAccounts()) {
        try {
          const store = tenants.get(account.id);
          if (!store.getKV(KV_REPLAY)) continue;
          const n = advance(store, nowMs, config);
          if (n) out.push({ accountId: account.id, played: n });
        } catch (err) {
          log(`account ${account.id} replay failed: ${String(err?.message ?? err).slice(0, 200)}`, "warning");
        }
      }
      return out;
    },
  };
}
