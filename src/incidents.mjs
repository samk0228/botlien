// A robot's stops as records. One opens when a sample says the robot is not
// working (a protective stop, an emergency stop, a fault that stops it, or
// the link to it lost), stays open while the samples keep saying so, and
// closes on the first sample that says it is back. A stop that returns
// within REOPEN_MS of ending is the same incident with one more repeat, so a
// robot that trips every few minutes is one alert that says so, not a
// stream (Antonio's coworker brief, rule 7.5).
//
// The words come from here too. Every number is computed from stored data
// and says whether it rests on the owner's own figures or on a default
// (rules 7.1 and 7.2). The cost of a stop is the arm's own hourly cost times
// the minutes it stood, so a short stop reads small, as it should: the big
// number is idle time over a year, and that lives on the dashboard. Cycles
// not made use the robot's measured pace only once it has its two-week
// baseline (rule 7.3); before that the message says minutes, not cycles.

export const KINDS = {
  "e-stop": { label: "emergency stop", verb: "hit an emergency stop" },
  stop: { label: "protective stop", verb: "hit a protective stop" },
  fault: { label: "fault", verb: "stopped on a fault" },
  offline: { label: "offline", verb: "went offline" },
};
// When two kinds show at once, the worse one names the incident.
const RANK = { "e-stop": 3, fault: 2, stop: 1, offline: 0 };
// A stop that comes back within this of the last one ending is a repeat of
// the same incident, not a new alert.
export const REOPEN_MS = 10 * 60_000;
// Unclaimed for this long: the lead is told; this long again: the manager.
export const ESCALATE_AFTER_MS = 10 * 60_000;
// A pushed robot that was up and has sent nothing for this long is offline:
// the gateway box died, or lost its uplink. A vendor sync is not held to
// this (it may poll hourly), and an arm last seen powered off is not either.
export const SILENT_MS = 10 * 60_000;
const MIN = 60_000;
const DAY = 86_400_000;
const BASELINE_DAYS = 14;

function parseErrors(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
// A warning does not stop a robot. Anything else, or a fault that says no
// severity at all, is taken at its word.
const stopping = (e) => !/^(WARN|WARNING|INFO)$/i.test(String(e?.severity ?? ""));
const on = (v) => v === 1 || v === true;

/** What a sample says is wrong, or null when the robot is fine. */
export function classify(s) {
  if (!s) return null;
  const errors = parseErrors(s.errors);
  const first = errors.find(stopping) ?? errors[0] ?? null;
  const base = { code: first?.code ?? null, description: first?.description ?? null, severity: "critical" };
  if (on(s.e_stop)) return { kind: "e-stop", ...base };
  if (on(s.stuck)) return { kind: "stop", ...base };
  if (errors.some(stopping)) return { kind: "fault", ...base };
  if (s.connection_state === "offline") return { kind: "offline", code: null, description: null, severity: "critical" };
  return null;
}

/** Bring a robot's incident record in line with its latest sample. Returns
 *  { incident, change } with change one of opened, reopened, closed,
 *  updated, or null when nothing moved. */
export function reconcile(store, robot, nowMs, { silentMs = SILENT_MS } = {}) {
  const latest = store.latestSnapshot(robot.id);
  if (!latest) return { incident: null, change: null };
  let found = classify(latest);
  if (!found && silentMs && robot.connector === "push" && latest.connection_state === "online" && latest.mission_state !== "off" && nowMs - latest.at >= silentMs) {
    found = { kind: "offline", code: null, description: "The gateway stopped sending", severity: "critical" };
  }
  const open = store.openIncidentFor(robot.id);
  if (!open && found) {
    const last = store.lastIncidentFor(robot.id);
    const soon = last && last.status === "closed" && last.kind === found.kind && last.ended_at !== null && latest.at > last.ended_at && latest.at - last.ended_at <= REOPEN_MS;
    if (soon) {
      const inc = store.updateIncident(last.id, { status: "open", endedAt: null, lastSeenAt: latest.at, repeats: last.repeats + 1, code: found.code, description: found.description }, nowMs);
      return { incident: inc, change: "reopened" };
    }
    // A stop read from a replay says so for the rest of its life, so it is
    // never shown as a live robot's.
    const source = latest.source === "replay" ? "replay" : "robot";
    const id = store.insertIncident({ robotId: robot.id, kind: found.kind, code: found.code, description: found.description, severity: found.severity, startedAt: latest.at, lastSeenAt: latest.at, source }, nowMs);
    return { incident: store.incident(id), change: "opened" };
  }
  if (open && !found) {
    if (latest.at <= open.last_seen_at) return { incident: open, change: null };
    return { incident: store.updateIncident(open.id, { status: "closed", endedAt: latest.at }, nowMs), change: "closed" };
  }
  if (open && found) {
    if (latest.at <= open.last_seen_at) return { incident: open, change: null };
    const fields = { lastSeenAt: latest.at };
    // A protective stop that becomes an emergency stop is the worse thing.
    if (RANK[found.kind] > RANK[open.kind]) Object.assign(fields, { kind: found.kind, code: found.code, description: found.description });
    return { incident: store.updateIncident(open.id, fields, nowMs), change: "updated" };
  }
  return { incident: null, change: null };
}

/** Which escalation is due now: 1 (the lead) when an alert has sat
 *  unclaimed for ESCALATE_AFTER_MS since it was posted, 2 (the manager)
 *  that long again after the lead was told, else 0. */
export function escalationDue(inc, nowMs) {
  if (!inc || inc.status !== "open" || inc.claimed_at || !inc.notified_at) return 0;
  if (inc.escalated === 0 && nowMs - inc.notified_at >= ESCALATE_AFTER_MS) return 1;
  if (inc.escalated === 1 && nowMs - (inc.escalated_at ?? inc.notified_at) >= ESCALATE_AFTER_MS) return 2;
  return 0;
}

/** The robot's usual pace over the last two weeks: units per hour of
 *  working time, from its rollups. Null when it has not worked. */
export function usualPace(store, robotId, nowMs) {
  const rollups = store.rollupsBetween(robotId, nowMs - BASELINE_DAYS * DAY, nowMs);
  const units = rollups.reduce((n, r) => n + (r.mission_count ?? 0), 0);
  const hours = rollups.reduce((n, r) => n + (r.active_ms ?? 0), 0) / 3_600_000;
  return hours > 0 && units > 0 ? { perHour: units / hours, units, hours } : null;
}

const isArm = (robot) => /^ur/i.test(String(robot?.model ?? "")) || ["machine_tending", "welding"].includes(String(robot?.category ?? ""));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
export const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
export const clock = (ms, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms).toLowerCase();
const money = (cents) => (cents < 10_000 ? `$${(cents / 100).toFixed(2)}` : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const mention = (id) => (id ? (/^[UW][A-Z0-9]{6,12}$/.test(id) ? `<@${id}>` : id) : null);

/** Everything the alert says, as lines. `contractRobot` is the robot as the
 *  contract carries it (name, cost block, baseline flag); `pace` is
 *  usualPace() and is only passed once the baseline is ready. */
export function incidentView(inc, { robot, contractRobot = null, tz = "America/Los_Angeles", nowMs, lead = null, manager = null, pace = null, dollars = true }) {
  const name = contractRobot?.name ?? robot?.display_name ?? robot?.external_id ?? `Robot ${inc.robot_id}`;
  const open = inc.status === "open";
  const endMs = open ? nowMs : inc.ended_at;
  const minutes = Math.max(1, Math.round((endMs - inc.started_at) / MIN));
  const kind = KINDS[inc.kind] ?? KINDS.fault;
  const verb = inc.kind === "stop" && !isArm(robot) ? "got stuck" : kind.verb;
  const headline = open ? `${name} ${verb} at ${clock(inc.started_at, tz)}` : `${name} is back after ${fmtMin(minutes)}`;
  const cause = inc.description
    ? cap(inc.description) + (inc.code && !inc.description.includes(inc.code) ? ` (${inc.code})` : "")
    : inc.code
      ? `Code ${inc.code}`
      : inc.kind === "offline"
        ? "The gateway lost its link to the robot"
        : null;
  const downLine = open ? `Down ${fmtMin(minutes)} so far` : `Was down ${fmtMin(minutes)}, back at ${clock(inc.ended_at, tz)}`;
  const cost = contractRobot?.cost ?? null;
  const costCents = cost?.perHourCents != null ? Math.round((cost.perHourCents * minutes) / 60) : null;
  const costLine = costCents === null || !dollars ? null : `${money(costCents)} in robot time${cost.estimated ? " (estimated, from list prices)" : " (from your numbers)"}`;
  const unit = contractRobot?.unitLabel ?? "units";
  const outputLine = pace && pace.perHour > 0 ? `About ${Math.max(1, Math.round((pace.perHour * minutes) / 60))} ${unit} not made (its usual pace is ${Math.round(pace.perHour)} an hour)` : null;
  const repeatsLine = inc.repeats > 1 ? `${ordinal(inc.repeats)} stop in a row, each within ${REOPEN_MS / MIN} minutes of the last` : null;
  const claimed = inc.claimed_at != null;
  let claimLine = null;
  if (claimed) claimLine = `Claimed by ${inc.claimed_by}${open ? ` at ${clock(inc.claimed_at, tz)}` : ""}`;
  else if (open) {
    const wait = ESCALATE_AFTER_MS / MIN;
    if (inc.escalated >= 2) claimLine = `Nobody has claimed this. ${mention(manager) ?? "The manager"} was told at ${clock(inc.escalated_at, tz)}`;
    else if (inc.escalated === 1) {
      const left = Math.max(1, Math.ceil((ESCALATE_AFTER_MS - (nowMs - (inc.escalated_at ?? nowMs))) / MIN));
      claimLine = `Not claimed yet. ${mention(lead) ?? "The lead"} was told at ${clock(inc.escalated_at, tz)}; ${mention(manager) ?? "the manager"} is next in ${left} min`;
    } else {
      // Rendered before the post lands, the clock starts now.
      const left = Math.min(wait, Math.max(1, Math.ceil((ESCALATE_AFTER_MS - (nowMs - (inc.notified_at ?? nowMs))) / MIN)));
      claimLine = `Not claimed yet. ${mention(lead) ? `${mention(lead)} gets it` : "It escalates"} in ${left} min`;
    }
  }
  return { headline, cause, downLine, outputLine, costLine, repeatsLine, claimLine, open, claimed, escalated: inc.escalated, minutes, costCents };
}

/** The shape the API carries. */
export const incidentOut = (r) => ({
  id: r.id, robotId: r.robot_id, kind: r.kind, code: r.code, description: r.description, severity: r.severity,
  startedAt: r.started_at, lastSeenAt: r.last_seen_at, endedAt: r.ended_at, repeats: r.repeats, status: r.status,
  claimedBy: r.claimed_by, claimedAt: r.claimed_at, escalated: r.escalated, escalatedAt: r.escalated_at, notifiedAt: r.notified_at,
});
