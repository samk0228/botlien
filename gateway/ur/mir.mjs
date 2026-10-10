// MiR mobile robots (MiR100/250/500/600/1350), read over MiR's own REST API
// and turned into Botlien events, next to the UR arms in the same gateway.
//
// MiR serves REST v2.0.0 on the robot itself (http://<robot ip>/api/v2.0.0/)
// and on MiR Fleet, which runs on a server at the customer's site. Neither is
// reachable from the internet, so like the arms this is read on the local
// network and pushed out to Botlien.
//
// Read only: the client below can only send GET. MiR's API can queue
// missions, change the robot's state and write registers, all with PUT, POST
// or DELETE, and none of that is reachable from this file.
//
// What a MiR reports that Botlien uses (GET /status):
//   state_id         1 Starting, 2 ShuttingDown, 3 Ready, 4 Pause, 5 Executing,
//                    6 Aborted, 7 Completed, 8 Docked, 9 Docking,
//                    10 EmergencyStop, 11 ManualControl, 12 Error
//   errors           [{ code, description, module }]
//   battery_percentage, position { x, y, orientation }, velocity { linear, angular }
//   mission_queue_id the mission running now, one unit of work per id
import { createHash } from "node:crypto";

export const MIR_STATE = {
  1: "Starting", 2: "ShuttingDown", 3: "Ready", 4: "Pause", 5: "Executing", 6: "Aborted",
  7: "Completed", 8: "Docked", 9: "Docking", 10: "EmergencyStop", 11: "ManualControl", 12: "Error",
};
const MOVING_M_S = 0.02;
const MOVING_RAD_S = 0.02;

/** MiR's API key: Basic base64(user:sha256(password)), the form its own
 *  help page shows. "user:password" in, the header value out. */
export function mirAuthHeader(userPassword) {
  const i = String(userPassword ?? "").indexOf(":");
  if (i < 1) throw new Error('MiR login must be given as "user:password" (BOTLIEN_MIR_AUTH)');
  const user = userPassword.slice(0, i);
  const hash = createHash("sha256").update(userPassword.slice(i + 1)).digest("hex");
  return `Basic ${Buffer.from(`${user}:${hash}`).toString("base64")}`;
}

/** What one /status reply means, in Botlien's terms. */
export function readMirStatus(st) {
  const state = Number(st?.state_id ?? NaN);
  const v = st?.velocity ?? {};
  const lin = Number(v.linear), ang = Number(v.angular);
  const moving = Number.isFinite(lin) || Number.isFinite(ang) ? Math.abs(lin || 0) > MOVING_M_S || Math.abs(ang || 0) > MOVING_RAD_S : null;
  const eStop = state === 10;
  const errorList = Array.isArray(st?.errors) ? st.errors : [];
  const errors = errorList.slice(0, 20).map((e) => ({
    code: `MIR-${e?.code ?? "error"}`,
    severity: "ERROR",
    ...(e?.description || e?.module ? { description: String([e.module, e.description].filter(Boolean).join(": ")).slice(0, 200) } : {}),
  }));
  if (state === 12 && !errors.length) errors.push({ code: "MIR-STATE-12", severity: "ERROR", description: st?.state_text || "Error" });
  if (eStop) errors.push({ code: "MIR-STATE-10", severity: "ERROR", description: "Emergency stop" });
  const missionState =
    state === 1 || state === 2 ? "off"
    : eStop || state === 12 ? "stopped"
    : state === 5 ? "executing"
    : state === 4 ? "paused"
    : "idle"; // Ready, Aborted, Completed, Docked, Docking, ManualControl
  const p = st?.position;
  const battery = Number(st?.battery_percentage);
  return {
    stateId: Number.isFinite(state) ? state : null,
    missionState,
    stuck: false,
    eStop,
    errors,
    moving,
    manual: state === 11,
    battery: Number.isFinite(battery) ? Math.max(0, Math.min(100, Math.round(battery * 10) / 10)) : null,
    pose: p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null,
    missionId: state === 5 && st?.mission_queue_id != null ? `mir-queue:${st.mission_queue_id}` : null,
  };
}

const keyOf = (r) => [r.missionState, r.eStop, r.errors.map((e) => e.code).join("+"), r.missionId, r.manual].join("|");
const HEARTBEATS = new WeakSet();
export const isMirHeartbeat = (e) => HEARTBEATS.has(e);

/**
 * Tracks one MiR. feed(status, at) and down(at, reason) return the events
 * to send; tick(now) returns a heartbeat when one is due.
 *
 * Executing is not the same as working: a mission that waits for a machine
 * or a person (a "wait for PLC register" step, a load station) has the robot
 * executing and parked. Executing while still for longer than holdMs is
 * waiting, dated from the poll it stopped on, the same rule as the arms.
 * Shorter stops (a person crossing its path) are work.
 */
export function createMir(cfg, { heartbeatMs = 15_000, holdMs = 10_000 } = {}) {
  const base = {
    robot_id: cfg.id,
    name: cfg.name ?? cfg.id,
    brand: "MiR",
    model: cfg.model ?? null,
    category: cfg.category ?? "putaway",
  };
  let last = null; // { key, r, at, sentAt }
  let online = false;
  let stillSince = null; // executing and not moving since this poll
  let lastBattery = null;

  function event(at, r, state) {
    return {
      ...base,
      at: new Date(at).toISOString(),
      connection_state: "online",
      mission_state: state,
      stuck: false,
      e_stop: r.eStop,
      moving: r.moving,
      errors: r.errors,
      ...(r.battery !== null ? { battery_pct: r.battery } : {}),
      ...(r.pose ? { pose: r.pose } : {}),
      ...(r.missionId ? { mission_id: r.missionId } : {}),
      // Not read by the server yet: archived raw.
      mir: { state_id: r.stateId, manual: r.manual },
    };
  }

  function emit(out, at, r, state) {
    const rr = { ...r, missionState: state };
    const key = keyOf(rr);
    if (online && last && key === last.key) {
      last.r = rr;
      return;
    }
    online = true;
    last = { key, r: rr, sentAt: at };
    out.push(event(at, rr, state));
  }

  return {
    id: cfg.id,
    feed(st, at) {
      const r = readMirStatus(st);
      const out = [];
      if (r.missionState !== "executing") {
        stillSince = null;
        emit(out, at, r, r.missionState);
      } else if (r.moving !== false) {
        stillSince = null;
        emit(out, at, r, "active");
      } else {
        stillSince ??= at;
        if (at - stillSince > holdMs) emit(out, stillSince, r, "waiting");
        // Still undecided: what was last sent stands.
        else if (!last || !online) emit(out, at, r, "active");
      }
      // The battery rides along on the next change or heartbeat, not as one.
      if (last) last.r = { ...last.r, battery: r.battery, pose: r.pose ?? last.r.pose };
      lastBattery = r.battery;
      return out;
    },
    tick(now) {
      if (!online || !last || now - last.sentAt < heartbeatMs) return [];
      // A stop inside the hold has not been judged; a heartbeat now would
      // state work at a time that may yet turn out to be waiting.
      if (stillSince !== null) return [];
      last.sentAt = now;
      const beat = event(now, last.r, last.r.missionState);
      HEARTBEATS.add(beat);
      return [beat];
    },
    down(now, reason) {
      if (!online) return [];
      online = false;
      stillSince = null;
      // No error: a dropped link is not the robot failing.
      return [{ ...base, at: new Date(now).toISOString(), connection_state: "offline", mission_state: "unknown", moving: null, ...(lastBattery !== null ? { battery_pct: lastBattery } : {}), mir: { link_lost: String(reason).slice(0, 120) } }];
    },
  };
}

/** GET only. The one function in this gateway that talks to a MiR. */
async function mirGet(fetchImpl, url, auth, timeoutMs) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", "Accept-Language": "en_US", ...(auth ? { Authorization: auth } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`MiR refused the login (${res.status}). Check BOTLIEN_MIR_AUTH`), { auth: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The base address of a MiR's API, from a host ("192.168.12.20"), a host
 *  and port, or a full http(s) address. */
export function mirBase(host, port = null) {
  const h = String(host);
  const root = /^https?:\/\//.test(h) ? h.replace(/\/+$/, "") : `http://${h}${port ? `:${port}` : ""}`;
  return /\/api\/v2\.0\.0$/.test(root) ? root : `${root}/api/v2.0.0`;
}

/**
 * Polls one MiR (or every robot on one MiR Fleet) and hands each reply to
 * onStatus(robotKey, status, at). onDown(robotKey, reason, at) when a robot
 * cannot be read. Returns stop().
 *
 * Fleet: GET /robots lists the robots, GET /robots/{id} returns each one with
 * its status. Read once a minute for robots added later.
 */
export function pollMir({ host, port = null, fleet = false, auth = null, intervalMs = 1_000, fetch: fetchImpl = globalThis.fetch, onStatus, onDown, onRobots = () => {}, log = console.log, now = Date.now, timeoutMs = 4_000 }) {
  const base = mirBase(host, port);
  let stopped = false;
  let timer = null;
  let fleetRobots = null; // [{ id, name }]
  let listedAt = 0;
  let failing = false;

  async function once() {
    if (fleet) {
      if (!fleetRobots || now() - listedAt > 60_000) {
        const list = await mirGet(fetchImpl, `${base}/robots`, auth, timeoutMs);
        fleetRobots = (Array.isArray(list) ? list : []).filter((r) => r && r.id != null).map((r) => ({ id: String(r.id), name: r.name ?? r.robot_name ?? null }));
        listedAt = now();
        onRobots(fleetRobots);
      }
      await Promise.all(fleetRobots.map(async (r) => {
        try {
          const body = await mirGet(fetchImpl, `${base}/robots/${encodeURIComponent(r.id)}`, auth, timeoutMs);
          onStatus(r.id, body?.status ?? body, now(), body);
        } catch (err) {
          if (err.auth) throw err;
          onDown(r.id, err.message ?? String(err), now());
        }
      }));
    } else {
      const st = await mirGet(fetchImpl, `${base}/status`, auth, timeoutMs);
      onStatus(null, st, now(), st);
    }
  }

  async function loop() {
    if (stopped) return;
    let wait = intervalMs;
    try {
      await once();
      if (failing) log(`MiR at ${host}: reading again`);
      failing = false;
    } catch (err) {
      if (!failing) log(`MiR at ${host}: cannot read (${err.message ?? err}); retrying until it answers`);
      failing = true;
      if (fleet) for (const r of fleetRobots ?? []) onDown(r.id, err.message ?? String(err), now());
      else onDown(null, err.message ?? String(err), now());
      wait = err.auth ? 60_000 : Math.max(intervalMs, 5_000);
    }
    if (!stopped) timer = setTimeout(loop, wait);
  }
  loop();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
