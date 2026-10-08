// Stops in Botlien's own dashboard and chat, before any integration. The
// Stop Watcher polls the feed every few seconds; people acknowledge a stop
// (on it, looking, or snooze) and say what fixed it, and everyone else sees
// it on their next poll. Slack, text and email are later delivery options on
// these same records.
//
// A stop's cost is the arm's own hourly cost times the minutes it stood, the
// arithmetic the Slack alert and the agents' API already use. partsLost stays
// null until the owner enters a profit per part. Both live under fields the
// role rules know as money, so a technician never receives either.
import { incidentView, KINDS, ESCALATE_AFTER_MS } from "./incidents.mjs";
import { lineEventOut, timeline, stopImpacts, STEP_MS, MAX_GAP_MS } from "./line.mjs";
import { loadInputs } from "./inputs.mjs";

export class StopError extends Error {}

export const ACK_KINDS = ["on", "look", "snooze"];
export const SNOOZE_DEFAULT_MIN = 15;
const SNOOZE_MAX_MIN = 240;
const FIX_MAX = 500;
const MIN = 60_000;
const DAY = 86_400_000;
// A first load with no cursor gets the last week's stops.
export const FIRST_LOAD_MS = 7 * DAY;
export const FEED_LIMIT = 200;

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const label = { on: "on it", look: "looking", snooze: "snoozed" };

/** Snoozed until when, from the stop's acknowledgements. */
function snoozedUntil(acks, nowMs) {
  const live = acks.filter((a) => a.kind === "snooze" && a.until > nowMs);
  return live.length ? Math.max(...live.map((a) => a.until)) : null;
}

/** Which escalation is due on the dashboard: an open stop nobody is on, not
 *  snoozed, unanswered for ten minutes since it started (1, the lead) and ten
 *  more since that (2, the manager). Slack's own escalation counts from when
 *  its message posted; this counts from the stop, since the dashboard shows
 *  it the moment it starts. */
export function dashEscalationDue(inc, acks, nowMs) {
  if (!inc || inc.status !== "open" || inc.claimed_at) return 0;
  const until = snoozedUntil(acks, nowMs);
  if (until) return 0;
  const lastSnoozeEnd = Math.max(0, ...acks.filter((a) => a.kind === "snooze" && a.until <= nowMs).map((a) => a.until));
  const from = Math.max(inc.started_at, lastSnoozeEnd);
  if (inc.escalated === 0 && nowMs - from >= ESCALATE_AFTER_MS) return 1;
  if (inc.escalated === 1 && nowMs - Math.max(inc.escalated_at ?? from, lastSnoozeEnd) >= ESCALATE_AFTER_MS) return 2;
  return 0;
}

/** Escalate an account's open stops that are due. Run on every job tick for
 *  accounts without Slack; with Slack, the Slack job escalates and posts. */
export function escalateStops(store, nowMs) {
  const out = [];
  for (const inc of store.openIncidents()) {
    const due = dashEscalationDue(inc, store.stopAcks(inc.id), nowMs);
    if (due) out.push(store.updateIncident(inc.id, { escalated: due, escalatedAt: nowMs }, nowMs));
  }
  return out;
}

/** The robots a stop left waiting. While it is open, worked out now from the
 *  line's own timeline with the line job's rule (never a twin, never a wait
 *  shorter than a cycle's), so it fills in as the stop goes on instead of on
 *  the line job's next two-minute tick. Once it is over, the line job's
 *  record of it. Empty with no line map, or a robot on no line. */
function leftWaiting(store, inc, nameOf, nowMs) {
  const shape = (idle) => Object.entries(idle).map(([id, ms]) => ({ robotId: Number(id), name: nameOf(Number(id)), minutes: Math.round(ms / 60_000) })).filter((w) => w.minutes > 0);
  if (inc.status === "open") {
    const map = loadInputs(store).account.lineMap ?? null;
    const line = map?.lines?.find((l) => l.stations.some((st) => st.kind === "robot" && st.robotId === inc.robot_id));
    if (!line) return [];
    const ids = line.stations.filter((st) => st.kind === "robot").map((st) => st.robotId);
    const from = Math.floor(inc.started_at / STEP_MS) * STEP_MS;
    const to = Math.max(from, Math.floor(nowMs / STEP_MS) * STEP_MS);
    const tl = timeline(Object.fromEntries(ids.map((id) => [id, store.snapshotsBetween(id, from - MAX_GAP_MS, to)])), from, to);
    const [impact] = stopImpacts(line, tl, [{ robotId: inc.robot_id, startedAt: from, endedAt: null }]);
    return impact ? shape(impact.idle) : [];
  }
  const near = store.listLineEvents({ sinceMs: inc.started_at - 2 * STEP_MS, untilMs: inc.started_at + 2 * STEP_MS + 1, limit: 50 });
  const own = near.find((e) => e.kind === "stop" && e.robot_id === inc.robot_id);
  return own ? lineEventOut(own, nameOf, nowMs).idle.filter((w) => w.minutes > 0) : [];
}

/** One stop, in the shape the dashboard's Stop Watcher reads. */
export function stopRecord(store, contract, inc, nowMs) {
  const cr = contract.robots.find((r) => r.id === inc.robot_id) ?? null;
  const robot = store.listRobots().find((r) => r.id === inc.robot_id) ?? null;
  const v = incidentView(inc, { robot, contractRobot: cr, tz: contract.tz, nowMs });
  const nameOf = (id) => contract.robots.find((r) => r.id === id)?.name ?? `Robot ${id}`;
  const acks = store.stopAcks(inc.id);
  const open = inc.status === "open";
  return {
    id: inc.id,
    robot: { id: inc.robot_id, name: cr?.name ?? robot?.display_name ?? robot?.external_id ?? `Robot ${inc.robot_id}`, model: cr?.model ?? robot?.model ?? null },
    state: open ? "open" : "closed",
    source: inc.source === "replay" ? "replay" : "robot",
    type: inc.kind,
    typeLabel: (KINDS[inc.kind] ?? KINDS.fault).label,
    startedAt: inc.started_at,
    endedAt: inc.ended_at,
    minutes: v.minutes,
    errorCode: inc.code,
    description: inc.description,
    repeatCount: inc.repeats,
    leftWaiting: leftWaiting(store, inc, nameOf, nowMs),
    robotTimeCost:
      v.costCents === null
        ? null
        : { cents: v.costCents, basis: cr.cost.estimated ? "estimated" : "owner", math: `${dollars(cr.cost.perHourCents)} an hour to own and run x ${v.minutes} min / 60` },
    // Needs the owner's profit per part, which nothing asks for yet.
    partsLost: null,
    escalation: { level: inc.escalated, at: inc.escalated_at, snoozedUntil: snoozedUntil(acks, nowMs) },
    acks: acks.map((a) => ({ kind: a.kind, label: label[a.kind] ?? a.kind, by: a.by_email, at: a.at, until: a.until })),
    fix: inc.fix_text ? { text: inc.fix_text, by: inc.fixed_by, at: inc.fixed_at } : null,
    updatedAt: inc.updated_at,
    cursor: `${inc.updated_at}-${inc.id}`,
  };
}

export function parseCursor(raw) {
  // "0" is what a client sends before it has a cursor (the team page does).
  if (raw === null || raw === undefined || raw === "" || raw === "0") return null;
  const m = /^(\d+)-(\d+)$/.exec(String(raw));
  if (!m) throw new StopError("since is the cursor a previous answer gave.");
  return { updatedAt: Number(m[1]), id: Number(m[2]) };
}

/** Stops changed since a cursor, oldest change first. With no cursor, the
 *  last week's. A stop that changes again comes round again under the same
 *  id, so a client keyed by id never shows one twice. */
export function stopFeed(store, contract, nowMs, since) {
  const after = since ?? { updatedAt: nowMs - FIRST_LOAD_MS, id: 0 };
  const rows = store.queryIncidents({ after, limit: FEED_LIMIT });
  const stops = rows.map((inc) => stopRecord(store, contract, inc, nowMs));
  return {
    serverTime: nowMs,
    stops,
    cursor: stops.length ? stops[stops.length - 1].cursor : since ? `${since.updatedAt}-${since.id}` : `${after.updatedAt}-0`,
    more: rows.length === FEED_LIMIT,
  };
}

function openStop(store, id) {
  const inc = store.incident(Number(id));
  if (!inc) throw new StopError("No stop with that id on this account.");
  return inc;
}

/** Someone answers a stop. "on" and "look" stop the escalation and name who
 *  has it; "snooze" holds it for `minutes`. */
export function ackStop(store, id, { kind, minutes = null } = {}, who, nowMs) {
  const inc = openStop(store, id);
  if (!ACK_KINDS.includes(kind)) throw new StopError("kind is on, look or snooze.");
  if (inc.status !== "open") throw new StopError("That stop is already over.");
  let until = null;
  if (kind === "snooze") {
    const m = minutes === null || minutes === undefined ? SNOOZE_DEFAULT_MIN : Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > SNOOZE_MAX_MIN) throw new StopError(`Snooze for 1 to ${SNOOZE_MAX_MIN} minutes.`);
    until = nowMs + m * MIN;
  }
  store.transaction(() => {
    store.insertStopAck({ incidentId: inc.id, kind, by: who, until }, nowMs);
    if ((kind === "on" || kind === "look") && !inc.claimed_at) store.updateIncident(inc.id, { claimedBy: who, claimedAt: nowMs }, nowMs);
  });
  return store.incident(inc.id);
}

/** What fixed it, for the logbook. Said once the stop is over, or while it
 *  is still open; said again, it replaces the last answer. */
export function fixStop(store, id, { text, what } = {}, who, nowMs) {
  const inc = openStop(store, id);
  // `what` is the team page's name for it (its one-tap answers).
  const t = String(text ?? what ?? "").trim();
  if (!t) throw new StopError("Say what fixed it.");
  if (t.length > FIX_MAX) throw new StopError(`At most ${FIX_MAX} characters.`);
  return store.updateIncident(inc.id, { fixText: t, fixedBy: who, fixedAt: nowMs }, nowMs);
}
