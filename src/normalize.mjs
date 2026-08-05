// The cross-brand "Botlien schema". Pure functions only.
// Rule #1 of normalization: unknown stays null, never guessed. The verbatim
// payload is preserved in raw_events; a snapshot links back via raw_event_id,
// so any mapping bug here is recoverable after the fact.
//
// BotStatus (normalized):
//   externalId, at, seq,
//   connectionState: 'online'|'offline'|null
//   batteryPct: number|null, charging: bool|null
//   eStop: bool|null
//   missionState: 'idle'|'active'|'paused'|'failed'|'charging'|null, missionId: string|null
//   stuck: bool|null, moving: bool|null
//   errors: [{code:'bear:E123', severity:'ERROR'}]|null
//   pose: {x,y,theta}|null

const MOVE_EPSILON = 0.01;

export function toEpochMs(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === "number") return ts > 1e12 ? Math.round(ts) : Math.round(ts * 1000);
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof ts === "object" && ts.seconds !== undefined) {
    return Number(ts.seconds) * 1000 + Math.round(Number(ts.nanos ?? 0) / 1e6);
  }
  return null;
}

function mapConnection(state) {
  if (state === "STATE_CONNECTED" || state === 1) return "online";
  if (state === "STATE_DISCONNECTED" || state === 2) return "offline";
  return null;
}

function mapMissionState(s) {
  if (!s) return null;
  const v = String(s).toUpperCase();
  if (v.includes("ACTIVE") || v.includes("RUNNING") || v.includes("IN_PROGRESS")) return "active";
  if (v.includes("PAUSE")) return "paused";
  if (v.includes("FAIL") || v.includes("CANCEL") || v.includes("ABORT")) return "failed";
  if (v.includes("CHARG") || v.includes("DOCK")) return "charging";
  if (v.includes("IDLE") || v.includes("NONE") || v.includes("COMPLETE") || v.includes("SUCCEED")) return "idle";
  return null;
}

function mapStuck(navState) {
  const s = navState?.stuck_state ?? navState;
  if (s === null || s === undefined) return null;
  const v = String(s).toUpperCase();
  if (v.includes("NONE") || v.includes("NOT_STUCK") || v.includes("UNSTUCK") || v === "FALSE") return false;
  if (v.includes("STUCK")) return true;
  return null;
}

function mapEStop(e) {
  if (e === null || e === undefined) return null;
  if (typeof e === "boolean") return e;
  const values = typeof e === "object" ? Object.values(e) : [e];
  if (values.length === 0) return null;
  let sawKnown = false;
  for (const v of values) {
    const s = String(v).toUpperCase();
    if (s.includes("PRESSED") || s.includes("ENGAGED") || s.includes("ACTIVE") || s === "TRUE") return true;
    if (s.includes("RELEASED") || s.includes("DISENGAGED") || s.includes("INACTIVE") || s === "FALSE" || s.includes("NONE")) sawKnown = true;
  }
  return sawKnown ? false : null;
}

function mapMoving(twist) {
  if (!twist) return null;
  const nums = [twist.linear?.x, twist.linear?.y, twist.angular?.z, twist.linear, twist.angular]
    .filter((v) => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.some((v) => Math.abs(v) > MOVE_EPSILON);
}

function mapErrors(codes, brand) {
  if (codes === null || codes === undefined) return null;
  if (!Array.isArray(codes)) return null;
  return codes.map((c) => {
    if (typeof c === "object" && c !== null) {
      return { code: `${brand}:${c.code ?? c.error_code ?? "unknown"}`, severity: c.severity ? String(c.severity).toUpperCase().replace(/^SEVERITY_/, "") : null };
    }
    return { code: `${brand}:${c}`, severity: null };
  });
}

/** Bear SubscribeRobotStatus response → BotStatus. */
export function normalizeBearStatus(msg) {
  const state = msg.robot_state ?? msg.robotState ?? {};
  const battery = state.battery ?? {};
  const batteryState = battery.state ? String(battery.state).toUpperCase() : null;
  const mission = state.mission ?? {};
  const pose = state.pose ?? null;
  return {
    externalId: msg.robot_id ?? msg.robotId ?? null,
    at: toEpochMs(msg.metadata?.timestamp),
    seq: msg.metadata?.sequence_number !== undefined ? Number(msg.metadata.sequence_number) : null,
    connectionState: mapConnection(state.connection?.state),
    batteryPct: typeof battery.charge_percent === "number" ? battery.charge_percent : null,
    charging: batteryState === null ? null : batteryState.includes("CHARGING") && !batteryState.includes("DISCHARGING"),
    eStop: mapEStop(state.emergency_stop),
    missionState: mapMissionState(mission.state ?? mission.mission_state),
    missionId: mission.mission_id ?? mission.id ?? null,
    stuck: mapStuck(state.navigation_state),
    moving: mapMoving(state.twist),
    errors: mapErrors(state.error_codes, "bear"),
    pose: pose && typeof pose.x === "number" ? { x: pose.x, y: pose.y ?? null, theta: pose.theta ?? pose.heading ?? null } : null,
  };
}

/** Returns [] when valid, else a list of human-readable problems. */
export function validateStatus(s) {
  const problems = [];
  if (!s || typeof s !== "object") return ["status is not an object"];
  if (!s.externalId) problems.push("missing externalId");
  if (typeof s.at !== "number" || s.at <= 0) problems.push("missing/invalid at");
  if (s.batteryPct !== null && s.batteryPct !== undefined && (s.batteryPct < 0 || s.batteryPct > 100)) {
    problems.push(`battery_pct out of range: ${s.batteryPct}`);
  }
  if (s.connectionState && !["online", "offline"].includes(s.connectionState)) {
    problems.push(`unknown connectionState: ${s.connectionState}`);
  }
  return problems;
}
