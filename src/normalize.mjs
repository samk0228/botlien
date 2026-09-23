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
  // Bear v1: STATE_DEFAULT = no mission running; SUCCEEDED = finished.
  if (v.includes("IDLE") || v.includes("NONE") || v.includes("COMPLETE") || v.includes("SUCCEED") || v.includes("DEFAULT")) return "idle";
  return null;
}

function mapStuck(navState) {
  // Bear v1: navigation_state.stuck_state is a message { state, reason }.
  let s = navState?.stuck_state ?? navState;
  if (s && typeof s === "object") s = s.state;
  if (s === null || s === undefined) return null;
  const v = String(s).toUpperCase();
  if (v.includes("UNKNOWN")) return null;
  // NOT_STUCK before STUCK: the former contains the latter as a substring.
  if (v.includes("NOT_STUCK") || v.includes("NONE") || v.includes("UNSTUCK") || v === "FALSE") return false;
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
    // Negatives FIRST: Bear's EMERGENCY_DISENGAGED contains "ENGAGED", and
    // INACTIVE contains "ACTIVE" — matching positives first misreads both.
    if (s.includes("DISENGAGED") || s.includes("RELEASED") || s.includes("INACTIVE") || s === "FALSE" || s.includes("NONE")) {
      sawKnown = true;
      continue;
    }
    if (s.includes("PRESSED") || s.includes("ENGAGED") || s.includes("ACTIVE") || s === "TRUE") return true;
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
  // Bear v1 wraps the list: error_codes is ErrorCodes { codes: ErrorCode[] }.
  if (!Array.isArray(codes) && Array.isArray(codes.codes)) codes = codes.codes;
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

// ---- Gausium ----
//
// Gausium's status payload carries three things Bear's does not: whether a human
// is driving (manualControlling), pack health beyond charge percent, and the
// wear state of every consumable. The last is the one that matters most here —
// it is the only direct measurement of collateral condition in either vendor's
// API, and it is what a repossessed scrubber's resale value actually turns on.

// Vendor names for the same physical part drift between models and firmware, so
// they are canonicalized here rather than at the call site. Anything unmapped
// passes through as snake_case instead of being dropped: an unknown wearing part
// is still a wearing part.
const WEAR_ALIASES = {
  water_tank: "water_tank",
  clean_water_tank: "clean_water_tank",
  clear_water_tank: "clean_water_tank",
  sewage_tank: "sewage_tank",
  dirty_water_tank: "sewage_tank",
  waste_water_tank: "sewage_tank",
  rolling_brush: "rolling_brush",
  roller_brush: "rolling_brush",
  main_brush: "rolling_brush",
  side_brush: "side_brush",
  brush: "brush",
  squeegee: "squeegee",
  suction_blade: "squeegee",
  scraper: "squeegee",
  filter: "filter",
  dust_filter: "filter",
  vacuum: "vacuum",
  spray: "spray",
  sprayer: "spray",
};

const WEAR_KEYS = ["level", "enabled", "lifespan", "usedlife", "lifeSpan", "usedLife"];

function snake(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function looksLikeComponent(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return WEAR_KEYS.some((k) => keys.includes(k));
}

/**
 * Walks a Gausium `device` block into flat component rows. Tolerant by design:
 * the docs describe the fields but not the exact nesting, and it varies by model
 * family, so this discovers components rather than assuming a fixed shape.
 *
 * remainingPct is deliberately NOT clamped at zero — a squeegee reporting -40
 * means 140% of its rated life has been run, which is a materially worse fact
 * than "spent" and the thing a lender most wants to see.
 */
export function extractWear(device, depth = 0) {
  if (!device || typeof device !== "object" || depth > 2) return [];
  const out = [];
  for (const [rawKey, value] of Object.entries(device)) {
    if (looksLikeComponent(value)) {
      const key = snake(rawKey);
      const lifeSpan = num(value.lifeSpan ?? value.lifespan);
      const usedLife = num(value.usedLife ?? value.usedlife);
      out.push({
        component: WEAR_ALIASES[key] ?? key,
        levelPct: num(value.level),
        enabled: typeof value.enabled === "boolean" ? value.enabled : null,
        // Unit is whatever the vendor reports (hours on the models seen; the
        // docs do not state it). Nothing downstream depends on the unit —
        // every rule reads remainingPct, which is a ratio.
        lifeSpanHours: lifeSpan,
        usedLifeHours: usedLife,
        // Two decimals: this is a ratio of two vendor counters, and carrying it
        // to full float precision would imply an accuracy the source lacks.
        remainingPct: lifeSpan && lifeSpan > 0 && usedLife !== null
          ? Math.round(Math.min(100, (1 - usedLife / lifeSpan) * 100) * 100) / 100
          : null,
      });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...extractWear(value, depth + 1));
    }
  }
  return out;
}

function mapNavStuck(navStatus) {
  if (!navStatus) return null;
  const v = String(navStatus).toUpperCase();
  if (v.includes("STUCK") || v.includes("TRAPPED") || v.includes("BLOCK")) return true;
  // Only the states that positively mean "navigation is fine" clear the flag.
  if (v.includes("IDLE") || v.includes("RUNNING") || v.includes("NAVIGATING") || v.includes("REACHED")) return false;
  return null;
}

/** Gausium GET /v1alpha1/robots/{sn}/status → BotStatus + condition + wear. */
export function normalizeGausiumStatus(msg, { at: fallbackAt = null } = {}) {
  const battery = msg.battery ?? {};
  const loc = msg.localizationInfo ?? msg.localization_info ?? {};
  const task = msg.currentTask ?? msg.current_task ?? {};
  const online = typeof msg.online === "boolean" ? msg.online : null;
  const speed = num(msg.speedKilometerPerHour);

  return {
    externalId: msg.serialNumber ?? msg.serial_number ?? null,
    at: toEpochMs(msg.latestReportTime ?? msg.latest_report_time) ?? fallbackAt,
    seq: null,
    connectionState: online === null ? null : online ? "online" : "offline",
    batteryPct: num(battery.powerPercentage ?? battery.power_percentage),
    charging: typeof battery.charging === "boolean" ? battery.charging : null,
    eStop: typeof msg.emergencyStop?.enabled === "boolean" ? msg.emergencyStop.enabled : null,
    missionState: mapMissionState(msg.taskState ?? msg.task_state),
    missionId: task.taskInstanceId ?? task.task_instance_id ?? null,
    stuck: mapNavStuck(msg.navStatus ?? msg.nav_status),
    moving: speed === null ? null : speed > 0,
    // Gausium's status payload carries no error list; faults arrive on the
    // separate Incident Push channel, so this stays null rather than empty.
    errors: null,
    pose: num(loc.worldX) !== null
      ? { x: loc.worldX, y: num(loc.worldY), theta: num(msg.mapPosition?.angle ?? loc.angle) }
      : null,

    condition: {
      manualControlling: typeof msg.manualControlling === "boolean" ? msg.manualControlling : null,
      navStatus: msg.navStatus ?? msg.nav_status ?? null,
      localizationState: loc.state ?? null,
      batteryVoltageV: num(battery.voltage),
      batteryCurrentA: num(battery.current),
      batteryTempC: num(battery.temperature),
      chargerCurrentA: num(battery.chargerCurrent ?? msg.chargerCurrent),
      vendorReportAt: toEpochMs(msg.latestReportTime ?? msg.latest_report_time),
    },
    wear: extractWear(msg.device),
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

/** One Gausium task report (a finished cleaning job, from the taskReports
 *  history endpoint) as the status samples the live poll would have written
 *  while it ran: active every `stepMs` from its start to its end, then idle.
 *  Landing history this way means rollups, duty, coverage and every screen
 *  read a connected account's past exactly as they read its present, with no
 *  second path through the math. Returns [] for a report with no usable
 *  start or duration rather than guessing one. */
export function gausiumTaskReportToEvents(serialNumber, report, { stepMs = 60_000 } = {}) {
  const start = toEpochMs(report?.startTime ?? report?.start_time);
  const seconds = Number(report?.durationSeconds ?? report?.duration_seconds);
  const endRaw = toEpochMs(report?.endTime ?? report?.end_time);
  if (start === null || !serialNumber) return [];
  const end = endRaw !== null && endRaw > start ? endRaw : Number.isFinite(seconds) && seconds > 0 ? start + seconds * 1000 : null;
  if (end === null) return [];
  const missionId = String(report.taskInstanceId ?? report.task_instance_id ?? report.id ?? `${serialNumber}:${start}`);
  const sample = (at, active) => ({
    externalId: serialNumber,
    at,
    raw: null,
    status: {
      externalId: serialNumber,
      at,
      seq: null,
      connectionState: "online",
      batteryPct: null,
      charging: active ? false : null,
      eStop: null,
      missionState: active ? "active" : "idle",
      missionId: active ? missionId : null,
      stuck: null,
      moving: active ? true : null,
      errors: null,
      pose: null,
    },
  });
  const out = [];
  for (let t = start; t < end; t += stepMs) out.push(sample(t, true));
  out.push(sample(end, false));
  return out;
}
