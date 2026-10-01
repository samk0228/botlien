// One arm's RTDE samples, turned into Botlien events.
//
// The controller streams ten samples a second. Botlien needs far fewer: an
// event whenever something that matters changes (running or not, stopped by
// a safety function, a new cycle, a fault) and a heartbeat in between, so
// the server's active-time accounting (which never extends a sample more
// than 5 minutes) stays exact. Between events the gateway keeps a small
// window of motor current, temperature and speed, and sends it along; the
// server archives it raw for joint drift later.

// UR's own enumerations (RTDE guide; Client Interfaces manual).
export const SAFETY = {
  1: "normal", 2: "reduced", 3: "protective stop", 4: "recovery", 5: "safeguard stop",
  6: "system emergency stop", 7: "robot emergency stop", 8: "safety violation", 9: "safety fault",
  10: "validating joint id", 11: "undefined safety mode", 12: "automatic mode safeguard stop",
  13: "three-position enabling stop",
};
export const ROBOT_MODE = {
  "-1": "no controller", 0: "disconnected", 1: "confirm safety", 2: "booting", 3: "power off",
  4: "power on", 5: "idle", 6: "backdrive", 7: "running", 8: "updating firmware",
};
export const RUNTIME = { 0: "stopping", 1: "stopped", 2: "playing", 3: "pausing", 4: "paused", 5: "resuming" };

// Stopped by a safety function: waits for a person to clear it or for a
// guard to close. This is what Botlien calls stuck.
const STOPPED = new Set([3, 5, 12, 13]);
const ESTOP = new Set([6, 7]);
const FAULT = new Set([8, 9]);
const MOVING_RAD_S = 0.01;

/** What a single sample means, in Botlien's terms. */
export function readSample(s, { cycleRegister = null } = {}) {
  const safety = s.safety_mode ?? null;
  const mode = s.robot_mode ?? null;
  const runtime = s.runtime_state ?? null;
  const running = mode === 7;
  // "playing" is not "working": a CNC loader spends most of its cycle with
  // the program running and the arm still, waiting on the mill. Working is
  // decided in feed(), from playing AND recent motion.
  const missionState =
    mode !== null && mode <= 4 ? "off"
    : STOPPED.has(safety) || ESTOP.has(safety) || FAULT.has(safety) ? "stopped"
    : running && (runtime === 2 || runtime === 5) ? "playing"
    : runtime === 3 || runtime === 4 ? "paused"
    : "idle";
  const errors = [];
  if (STOPPED.has(safety) || ESTOP.has(safety) || FAULT.has(safety)) {
    errors.push({ code: `UR-SAFETY-${safety}`, severity: FAULT.has(safety) || ESTOP.has(safety) ? "ERROR" : "WARNING", description: SAFETY[safety] });
  }
  const reg = cycleRegister === null ? null : s[`output_int_register_${cycleRegister}`];
  return {
    missionState,
    stuck: STOPPED.has(safety),
    eStop: ESTOP.has(safety),
    errors,
    moving: Array.isArray(s.actual_qd) ? s.actual_qd.some((v) => Math.abs(v) > MOVING_RAD_S) : null,
    cycle: Number.isInteger(reg) ? reg : null,
  };
}

const keyOf = (r) => [r.missionState, r.stuck, r.eStop, r.errors.map((e) => e.code).join("+"), r.cycle].join("|");

/**
 * Tracks one arm. feed(sample) and down(reason) return the events to send
 * (zero or one); tick(now) returns a heartbeat when one is due.
 */
export function createArm(cfg, { heartbeatMs = 15_000, holdMs = 2_000 } = {}) {
  const base = {
    robot_id: cfg.id,
    name: cfg.name ?? cfg.id,
    brand: "Universal Robots",
    model: cfg.model ?? null,
    category: cfg.category ?? "machine_tending",
  };
  let last = null; // { key, read, sample, sentAt }
  let online = false;
  let win = null;
  let movedAt = -Infinity;
  // The cycle register restarts at 0 with the program (Line Lab's does), so
  // what Botlien gets is a count that only climbs: every earlier run's last
  // value plus the current one. A drop in the register is a restart.
  let cycleBase = 0;
  let lastReg = null;
  function climbing(reg) {
    if (reg === null) return null;
    if (lastReg !== null && reg < lastReg) cycleBase += lastReg;
    lastReg = reg;
    return cycleBase + reg;
  }

  // Working = the program is playing and the arm moved within holdMs. The
  // hold keeps a short pause inside a move (a gripper closing) from splitting
  // one stretch of work into many; a wait longer than that is waiting.
  function working(s, r) {
    if (r.moving) movedAt = s.at;
    if (r.missionState !== "playing") return r;
    return { ...r, missionState: s.at - movedAt <= holdMs ? "active" : "waiting" };
  }

  function addToWindow(s) {
    if (!win) win = { n: 0, cur: [0, 0, 0, 0, 0, 0], curMax: [0, 0, 0, 0, 0, 0], tempMax: [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity], speed: 0 };
    win.n += 1;
    (s.actual_current ?? []).forEach((a, i) => {
      win.cur[i] += Math.abs(a);
      win.curMax[i] = Math.max(win.curMax[i], Math.abs(a));
    });
    (s.joint_temperatures ?? []).forEach((t, i) => (win.tempMax[i] = Math.max(win.tempMax[i], t)));
    win.speed += s.speed_scaling ?? 0;
  }

  function event(s, r, extra = {}) {
    const round = (x) => Math.round(x * 1000) / 1000;
    const e = {
      ...base,
      at: new Date(s.at).toISOString(),
      connection_state: "online",
      mission_state: r.missionState,
      stuck: r.stuck,
      e_stop: r.eStop,
      moving: r.moving,
      errors: r.errors,
      ...(r.cycle !== null ? { cycle_count: r.cycle, program: cfg.program ?? null } : {}),
      // Not read by the server yet: archived raw for joint drift and speed.
      ur: {
        robot_mode: s.robot_mode ?? null,
        safety_mode: s.safety_mode ?? null,
        ...(r.register !== null && r.register !== undefined ? { cycle_register: r.register } : {}),
        runtime_state: s.runtime_state ?? null,
        speed_slider: s.target_speed_fraction ?? null,
        ...(win && win.n
          ? {
              samples: win.n,
              speed_scaling: round(win.speed / win.n),
              current_mean: win.cur.map((c) => round(c / win.n)),
              current_max: win.curMax.map(round),
              temp_max: win.tempMax.map((t) => (Number.isFinite(t) ? round(t) : null)),
            }
          : {}),
      },
      ...extra,
    };
    win = null;
    return e;
  }

  return {
    id: cfg.id,
    feed(s) {
      const read = readSample(s, cfg);
      const r = working(s, { ...read, register: read.cycle, cycle: climbing(read.cycle) });
      addToWindow(s);
      const key = keyOf(r);
      if (!online || !last || key !== last.key) {
        online = true;
        last = { key, read: r, sample: s, sentAt: s.at };
        return [event(s, r)];
      }
      last.sample = s;
      last.read = r;
      return [];
    },
    tick(now) {
      if (!online || !last || now - last.sentAt < heartbeatMs) return [];
      last.sentAt = now;
      return [event({ ...last.sample, at: now }, last.read)];
    },
    down(now, reason) {
      if (!online) return [];
      online = false;
      win = null;
      // No error on this event: any error counts as the robot's downtime, and a
      // dropped network link is not the arm failing. The reason goes in the
      // raw archive only.
      return [{ ...base, at: new Date(now).toISOString(), connection_state: "offline", mission_state: "unknown", moving: null, ur: { link_lost: String(reason).slice(0, 120) } }];
    },
  };
}
