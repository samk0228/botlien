// What the agents read. Mara, the robot watchers and the Stop Watcher ask one
// question per call, and every answer is built from the layer the dashboard
// already reads (fleetContract, incidents.mjs, line.mjs), so the page and the
// agents can never give two different numbers for the same thing. Read only:
// nothing here writes, and nothing anywhere in Botlien sends a robot a command.
//
// A figure is { value, unit, basis, math }. basis is "measured" (counted from
// the robots' own samples), "owner" (rests on a number the owner entered) or
// "estimated" (rests on list prices and defaults); math says how it was worked
// out, so an agent can show its work instead of inventing it. Dollar figures
// only ever appear as fields named *Cents or inside a `cost` object, so the
// role rules can take every one of them out in one place.
import { fleetContract, dateKey, localMidnightMs } from "./contract.mjs";
import { incidentView, KINDS } from "./incidents.mjs";
import { stateOf, lineEventOut, STEP_MS } from "./line.mjs";
import { COST_DEFAULTS } from "./robot-cost.mjs";

export class AgentQueryError extends Error {}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// Fresh enough to call live: two of the gateway's 15-second heartbeats.
export const LIVE_LAG_MS = 2 * STEP_MS;
// A machine jam this close before a stop is worth naming next to it.
export const JAM_LOOKBACK_MS = 10 * MIN;
export const MAX_HISTORY_DAYS = 92;
export const MAX_STOPS = 500;

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const figure = (value, unit, basis, math) => ({ value, unit, basis, math });

/** The question's window and filters, from a URL's query. Throws
 *  AgentQueryError on anything it cannot read. */
export function parseQuery(params, nowMs, { defaultDays = 7 } = {}) {
  const num = (name) => {
    const raw = params.get(name);
    if (raw === null || raw === "") return null;
    const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(n)) throw new AgentQueryError(`${name} must be a time (milliseconds or an ISO date).`);
    return n;
  };
  const untilMs = num("until") ?? nowMs;
  const sinceMs = num("since") ?? untilMs - defaultDays * DAY;
  if (sinceMs >= untilMs) throw new AgentQueryError("since must be before until.");
  const robotRaw = params.get("robot");
  const robotId = robotRaw === null || robotRaw === "" ? null : Number(robotRaw);
  if (robotId !== null && !Number.isInteger(robotId)) throw new AgentQueryError("robot must be a robot id.");
  const limitRaw = params.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_STOPS) throw new AgentQueryError(`limit is 1 to ${MAX_STOPS}.`);
  const afterRaw = params.get("after");
  let after = null;
  if (afterRaw !== null && afterRaw !== "") {
    const m = /^(\d+)-(\d+)$/.exec(afterRaw);
    if (!m) throw new AgentQueryError("after is the cursor a previous answer gave.");
    after = { updatedAt: Number(m[1]), id: Number(m[2]) };
  }
  const bucket = params.get("bucket") ?? "hour";
  if (!["hour", "day"].includes(bucket)) throw new AgentQueryError("bucket is hour or day.");
  return { sinceMs, untilMs, robotId, limit, after, bucket };
}

function robotsById(contract) {
  return new Map(contract.robots.map((r) => [r.id, r]));
}

function knownRobot(contract, robotId) {
  const r = robotsById(contract).get(robotId);
  if (!r) throw new AgentQueryError(`Robot ${robotId} is not on this account.`);
  return r;
}

const costBasis = (cost) => (cost?.estimated ? "estimated" : "owner");

/** Line status: what each robot is doing right now, how fresh that is, any
 *  stop or machine jam going on, and each line's tally for the period. */
export function lineStatus(store, contract, nowMs) {
  const robots = contract.robots.map((r) => {
    const latest = store.latestSnapshot(r.id);
    const lagMs = latest ? Math.max(0, nowMs - latest.at) : null;
    const open = store.openIncidentFor(r.id);
    return {
      id: r.id,
      name: r.name,
      model: r.model,
      state: latest ? stateOf(latest) : "unknown",
      lastSeenAt: latest?.at ?? null,
      lagSeconds: lagMs === null ? null : Math.round(lagMs / 1000),
      live: lagMs !== null && lagMs <= LIVE_LAG_MS,
      openStopId: open?.id ?? null,
    };
  });
  return {
    asOf: nowMs,
    live: robots.length > 0 && robots.every((r) => r.live),
    robots,
    lines: contract.lineMap?.lines?.map((l) => ({ name: l.name, stations: l.stations.map((s) => ({ kind: s.kind, name: s.kind === "robot" ? robots.find((r) => r.id === s.robotId)?.name ?? `Robot ${s.robotId}` : s.name, robotId: s.robotId ?? null })) })) ?? [],
    lineMapSaved: contract.provenance?.lineMap === "owner",
    goingOn: contract.lineEvents.filter((e) => e.open),
    period: contract.lineSummary,
  };
}

/** What the line knew around one stop: the other robots it left waiting,
 *  and any machine jam on the same line just before it. A pattern from the
 *  logged history, not a diagnosis; a person decides. */
function lineContext(store, inc, endMs, nameOf, nowMs) {
  const near = store
    .listLineEvents({ sinceMs: inc.started_at - JAM_LOOKBACK_MS - DAY, untilMs: endMs + 1, limit: 500 })
    .map((e) => lineEventOut(e, nameOf, nowMs));
  const own = near.find((e) => e.kind === "stop" && e.robotId === inc.robot_id && Math.abs(e.startedAt - inc.started_at) <= 2 * STEP_MS) ?? null;
  const line = own?.line ?? null;
  const jamsBefore = near.filter(
    (e) => e.kind === "jam" && (line === null || e.line === line) && e.startedAt <= inc.started_at && (e.endedAt ?? nowMs) >= inc.started_at - JAM_LOOKBACK_MS,
  );
  return {
    line,
    leftWaiting: own?.idle ?? [],
    machineJamsBefore: jamsBefore.map((j) => ({ station: j.station, startedAt: j.startedAt, endedAt: j.endedAt, confidence: j.confidence })),
    note: "A pattern from the logged history, not a diagnosis.",
  };
}

/** One stop, as the agents see it. */
export function stopOut(store, contract, inc, nowMs) {
  const byId = robotsById(contract);
  const cr = byId.get(inc.robot_id) ?? null;
  const robot = store.listRobots().find((r) => r.id === inc.robot_id) ?? null;
  const v = incidentView(inc, { robot, contractRobot: cr, tz: contract.tz, nowMs });
  const open = inc.status === "open";
  const endMs = open ? nowMs : inc.ended_at;
  const nameOf = (id) => byId.get(id)?.name ?? `Robot ${id}`;
  return {
    id: inc.id,
    robot: { id: inc.robot_id, name: cr?.name ?? robot?.display_name ?? robot?.external_id ?? `Robot ${inc.robot_id}`, model: cr?.model ?? robot?.model ?? null },
    kind: inc.kind,
    label: (KINDS[inc.kind] ?? KINDS.fault).label,
    code: inc.code,
    description: inc.description,
    startedAt: inc.started_at,
    endedAt: inc.ended_at,
    open,
    minutes: figure(v.minutes, "minutes", "measured", open ? "now minus the sample that showed the stop" : "the first good sample minus the sample that showed the stop"),
    repeats: inc.repeats,
    claimedBy: inc.claimed_by,
    claimedAt: inc.claimed_at,
    escalated: inc.escalated,
    cost:
      v.costCents === null
        ? null
        : {
            stopCents: figure(v.costCents, "cents", costBasis(cr.cost), `${dollars(cr.cost.perHourCents)} an hour to own and run x ${v.minutes} min / 60`),
          },
    context: lineContext(store, inc, endMs, nameOf, nowMs),
    updatedAt: inc.updated_at,
    cursor: `${inc.updated_at}-${inc.id}`,
  };
}

/** Stops in a window, or with `after` every stop changed since a cursor
 *  (the Stop Watcher's feed). Totals cover the stops returned. */
export function stops(store, contract, nowMs, q) {
  if (q.robotId !== null) knownRobot(contract, q.robotId);
  const rows = q.after
    ? store.queryIncidents({ robotId: q.robotId, after: q.after, limit: q.limit })
    : store.queryIncidents({ robotId: q.robotId, sinceMs: q.sinceMs, untilMs: q.untilMs, limit: q.limit });
  const list = rows.map((inc) => stopOut(store, contract, inc, nowMs));
  const priced = list.filter((s) => s.cost);
  const minutes = list.reduce((n, s) => n + s.minutes.value, 0);
  const cents = priced.reduce((n, s) => n + s.cost.stopCents.value, 0);
  const basis = priced.some((s) => s.cost.stopCents.basis === "estimated") ? "estimated" : "owner";
  return {
    asOf: nowMs,
    window: q.after ? null : { sinceMs: q.sinceMs, untilMs: q.untilMs },
    robotId: q.robotId,
    stops: list,
    totals: {
      count: list.length,
      minutes: figure(minutes, "minutes", "measured", "the stops' minutes added up"),
      cost: priced.length ? { stopsCents: figure(cents, "cents", basis, `the ${priced.length} priced stops added up`) } : null,
      unpriced: list.length - priced.length,
    },
    cursor: list.length ? list[list.length - 1].cursor : null,
    more: list.length === q.limit,
  };
}

/** Cost and working time per robot for the open period, from the contract's
 *  own cost block. Robots with no cost model (service robots) carry none. */
export function costs(store, contract, nowMs) {
  const period = contract.periods[0] ?? null;
  const robots = contract.robots.map((r) => {
    const c = r.cost;
    const share = c?.workingPct ?? r.dutyPct ?? null;
    return {
      id: r.id,
      name: r.name,
      model: r.model,
      workingShare: share === null ? null : figure(share, "percent", "measured", "hours the robot was working / its scheduled hours, this period"),
      activeHours: r.activeHours === null ? null : figure(r.activeHours, "hours", "measured", "working time counted from the robot's samples"),
      cost: c
        ? {
            perHourCents: figure(
              c.perHourCents,
              "cents/hour",
              costBasis(c),
              `ownership ${dollars(c.ownershipCents)} + maintenance ${dollars(c.maintenanceCents)} + energy ${dollars(c.energyCents)}, ${c.armLabel} at ${dollars(c.armPriceCents)}, ${c.hoursPerYear} hours a year`,
            ),
            perWorkingHourCents: c.perWorkingHourCents === null ? null : figure(c.perWorkingHourCents, "cents/hour", costBasis(c), `${dollars(c.perHourCents)} / ${c.workingPct}% working`),
            idleYearCents:
              c.idleCostYearCents === null
                ? null
                : figure(c.idleCostYearCents, "cents/year", costBasis(c), `${dollars(c.perHourCents)} x ${c.hoursPerYear} hours x ${Math.round((100 - c.workingPct) * 10) / 10}% not working. The most that could be won back, not a promise.`),
          }
        : null,
    };
  });
  const priced = robots.filter((r) => r.cost);
  const sum = (k) => priced.reduce((n, r) => n + (r.cost[k]?.value ?? 0), 0);
  const basis = priced.some((r) => r.cost.perHourCents.basis === "estimated") ? "estimated" : "owner";
  return {
    asOf: nowMs,
    period: period ? { start: period.start, end: period.end, label: period.label, partial: period.partial } : null,
    defaults: { hoursPerYear: COST_DEFAULTS.hoursPerYear, lifetimeYears: COST_DEFAULTS.lifetimeYears, resaleShare: COST_DEFAULTS.resaleShare },
    robots,
    fleet: priced.length
      ? { cost: { perHourCents: figure(sum("perHourCents"), "cents/hour", basis, `the ${priced.length} robots' hourly costs added up`), idleYearCents: figure(sum("idleYearCents"), "cents/year", basis, "the robots' idle costs added up") } }
      : null,
  };
}

/** One robot's working time and stops by hour or by day, plus how many times
 *  it has stopped this calendar month (for "third time this month"). */
export function robotHistory(store, contract, nowMs, robotId, q) {
  const r = knownRobot(contract, robotId);
  if (q.untilMs - q.sinceMs > MAX_HISTORY_DAYS * DAY) throw new AgentQueryError(`At most ${MAX_HISTORY_DAYS} days per question.`);
  const size = q.bucket === "day" ? DAY : HOUR;
  const keyOf = q.bucket === "day" ? (ms) => localMidnightMs(dateKey(ms, contract.tz), contract.tz) : (ms) => Math.floor(ms / HOUR) * HOUR;
  const buckets = new Map();
  const get = (start) => {
    if (!buckets.has(start)) buckets.set(start, { start, activeMinutes: 0, onlineMinutes: 0, units: 0, errors: 0, stops: 0, downMinutes: 0 });
    return buckets.get(start);
  };
  for (const row of store.rollupsBetween(robotId, q.sinceMs - size, q.untilMs)) {
    if (row.bucket_start_at + row.bucket_ms <= q.sinceMs) continue;
    const b = get(keyOf(row.bucket_start_at));
    b.activeMinutes += row.active_ms / MIN;
    b.onlineMinutes += row.online_ms / MIN;
    b.units += row.mission_count;
    b.errors += row.error_count;
  }
  const inWindow = store.queryIncidents({ robotId, sinceMs: q.sinceMs, untilMs: q.untilMs, limit: MAX_STOPS });
  for (const inc of inWindow) {
    const b = get(keyOf(inc.started_at));
    b.stops += 1;
    b.downMinutes += Math.max(1, Math.round(((inc.ended_at ?? nowMs) - inc.started_at) / MIN));
  }
  const monthStart = localMidnightMs(`${dateKey(nowMs, contract.tz).slice(0, 8)}01`, contract.tz);
  const thisMonth = store.queryIncidents({ robotId, sinceMs: monthStart, untilMs: nowMs + 1, limit: MAX_STOPS });
  return {
    asOf: nowMs,
    robot: { id: r.id, name: r.name, model: r.model },
    bucket: q.bucket,
    window: { sinceMs: q.sinceMs, untilMs: q.untilMs },
    basis: "measured",
    math: "working and online minutes from the robot's samples; units are cycles the robot counted; stops are stop records that started in the bucket",
    buckets: [...buckets.values()]
      .sort((a, b) => a.start - b.start)
      .map((b) => ({ ...b, activeMinutes: Math.round(b.activeMinutes), onlineMinutes: Math.round(b.onlineMinutes) })),
    stopsThisMonth: { count: thisMonth.length, since: monthStart, kinds: thisMonth.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {}) },
  };
}

/** The four questions, bound to one account. The contract is built fresh per
 *  call and without closing periods, so asking never writes anything. */
export function createAgentApi({ store, config = {}, now = () => Date.now() }) {
  const ask = (fn) => {
    const nowMs = now();
    return fn(fleetContract(store, nowMs, config), nowMs);
  };
  return {
    line: () => ask((c, t) => lineStatus(store, c, t)),
    stops: (params) => ask((c, t) => stops(store, c, t, parseQuery(params, t))),
    costs: () => ask((c, t) => costs(store, c, t)),
    history: (robotId, params) => ask((c, t) => robotHistory(store, c, t, robotId, parseQuery(params, t))),
  };
}
