// The line job: every two minutes, for every account that has confirmed a
// line map, read each line's recent samples as a timeline and record what
// the map lets Botlien say (line.mjs): machine jams, and what each robot
// stop left waiting. Rows live in line_events, open while the episode goes
// on. A jam is posted to the account's Slack channel the way a stop is: one
// message, brought up to date, closed when the machine is going again.
// Stop impacts are not posted on their own; the stop already is.
//
// The window each tick covers runs from the earliest still-open episode or
// fifteen minutes back, whichever is earlier, so an episode keeps its
// start time from tick to tick and is updated, not duplicated.
import { fleetContract, KV_TZ } from "./contract.mjs";
import { loadInputs } from "./inputs.mjs";
import { timeline, findJams, stopImpacts, idleCost, KV_LINE_CURSOR, STEP_MS, MAX_GAP_MS } from "./line.mjs";
import { slackSettings, slackToken, createSlackClient } from "./slack.mjs";
import { fmtMin, clock } from "./incidents.mjs";

const DEFAULT_TZ = "America/Los_Angeles";
export const LOOKBACK_MS = 15 * 60_000;
export const REFRESH_MS = 5 * 60_000;
const MAX_WINDOW_MS = 24 * 3_600_000;

const money = (cents) => (cents < 10_000 ? `$${(cents / 100).toFixed(2)}` : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The stopped stretches in a timeline, per robot. */
export function stopsIn(tl, robotIds) {
  const out = [];
  for (const id of robotIds) {
    const st = tl.states[id] ?? [];
    let start = null;
    for (let k = 0; k <= st.length; k++) {
      const stopped = k < st.length && st[k] === "stopped";
      if (stopped && start === null) start = k;
      else if (!stopped && start !== null) {
        out.push({ robotId: id, startedAt: tl.times[start], endedAt: k < st.length ? tl.times[k] : null });
        start = null;
      }
    }
  }
  return out;
}

/** The words for a jam, open or over. */
export function jamText(ev, { line, names, tz, nowMs, estimated, dollars = true }) {
  const minutes = Math.max(1, Math.round(((ev.ended_at ?? nowMs) - ev.started_at) / 60_000));
  const who = names.length ? list(names) : "the robots around it";
  const cost = ev.priced && dollars ? `, ${money(ev.cost_cents)} in robot time${estimated ? " (estimated)" : ""}` : "";
  const side = ev.confidence === "one side" ? " Only one robot is next to it, so this is read from one side." : "";
  if (ev.status === "open") return `${ev.station} is likely holding ${line}: ${who} ${names.length === 1 ? "has" : "have"} been waiting on it since ${clock(ev.started_at, tz)}, ${fmtMin(minutes)} so far, and no robot has stopped. ${ev.idle_minutes} robot-minutes idle${cost}.${side}`;
  return `${ev.station} held ${line} for ${fmtMin(minutes)}, from ${clock(ev.started_at, tz)}: ${who} waited. ${ev.idle_minutes} robot-minutes idle${cost}.${side}`;
}

export function createLineJob({ control, tenants, vault, config = {}, fetchImpl = fetch, send = false, log = () => {} }) {
  async function post(client, store, account, settings, ev, text, nowMs) {
    if (!ev.message_ts) {
      if (ev.notified_at) return ev;
      if (!send) {
        log(`line alert (not sent, BOTLIEN_SLACK_SEND is off) account ${account.id}: ${text}`);
        return store.updateLineEvent(ev.id, { notifiedAt: nowMs, renderedAt: nowMs }, nowMs);
      }
      const r = await client.post(settings.channel, { text });
      if (!r.ok) {
        log(`account ${account.id} slack post failed: ${r.error}`, "needs_user");
        return ev;
      }
      return store.updateLineEvent(ev.id, { channel: r.channel ?? settings.channel, messageTs: r.ts, notifiedAt: nowMs, renderedAt: nowMs }, nowMs);
    }
    const r = await client.update(ev.channel, ev.message_ts, { text });
    if (!r.ok) log(`account ${account.id} slack update failed: ${r.error}`, "warning");
    return store.updateLineEvent(ev.id, { renderedAt: nowMs }, nowMs);
  }

  async function tick(nowMs) {
    const results = [];
    for (const account of control.listAccounts()) {
      try {
        const store = tenants.get(account.id);
        const map = loadInputs(store).account.lineMap ?? null;
        if (!map) continue;
        const robots = store.listRobots();
        const nameOf = (id) => robots.find((r) => r.id === id)?.display_name ?? robots.find((r) => r.id === id)?.external_id ?? `Robot ${id}`;
        const to = Math.floor(nowMs / STEP_MS) * STEP_MS;
        const openEvents = store.openLineEvents();
        const earliestOpen = openEvents.reduce((m, e) => Math.min(m, e.started_at), Infinity);
        const from = Math.floor(Math.max(nowMs - MAX_WINDOW_MS, Math.min(to - LOOKBACK_MS, earliestOpen)) / STEP_MS) * STEP_MS;
        const contract = fleetContract(store, nowMs, config);
        const perHour = Object.fromEntries(contract.robots.map((r) => [r.id, r.cost?.perHourCents ?? null]));
        const estimated = new Set(contract.robots.filter((r) => r.cost?.estimated).map((r) => r.id));
        const tz = store.getKV(KV_TZ) || config.owner?.tz || DEFAULT_TZ;
        const settings = slackSettings(store);
        const token = settings ? slackToken(store, vault) : null;
        const client = token ? createSlackClient({ token, fetchImpl }) : null;
        const seen = new Set();
        for (const line of map.lines) {
          const ids = line.stations.filter((s) => s.kind === "robot").map((s) => s.robotId);
          const samples = Object.fromEntries(ids.map((id) => [id, store.snapshotsBetween(id, from - MAX_GAP_MS, to)]));
          const tl = timeline(samples, from, to);
          const found = [
            ...findJams(line, tl).map((j) => ({ kind: "jam", station: j.station, robotId: null, confidence: j.confidence, startedAt: j.startedAt, endedAt: j.open ? null : j.endedAt, idle: j.idle })),
            ...stopImpacts(line, tl, stopsIn(tl, ids)).map((s) => ({ kind: "stop", station: nameOf(s.robotId), robotId: s.robotId, confidence: null, startedAt: s.startedAt, endedAt: s.endedAt, idle: s.idle })),
          ];
          for (const f of found) {
            const c = idleCost(f.idle, perHour);
            const row = store.upsertLineEvent({ line: line.name, kind: f.kind, station: f.station, robotId: f.robotId, confidence: f.confidence, startedAt: f.startedAt, endedAt: f.endedAt, idle: f.idle, idleMinutes: c.minutes, costCents: c.cents, priced: c.priced, status: f.endedAt === null ? "open" : "closed" }, nowMs);
            seen.add(row.id);
            results.push({ accountId: account.id, line: line.name, kind: f.kind, station: f.station, id: row.id, open: f.endedAt === null });
            if (f.kind === "jam" && client) {
              const names = Object.keys(f.idle).map((id) => nameOf(Number(id)));
              const text = jamText(row, { line: line.name, names, tz, nowMs, estimated: Object.keys(f.idle).some((id) => estimated.has(Number(id))), dollars: settings.dollars !== false });
              const stale = row.rendered_at != null && nowMs - row.rendered_at >= REFRESH_MS;
              // Post once, refresh while it goes on, and once more when it
              // ends (the last render predates the end).
              const ended = f.endedAt !== null && row.message_ts && (row.rendered_at ?? 0) < f.endedAt;
              if (!row.notified_at || stale || ended) await post(client, store, account, settings, row, text, nowMs);
            }
          }
        }
        // An episode that was open and is no longer found ended before the
        // window could see its end: close it at the last time it was seen.
        for (const e of openEvents) {
          if (seen.has(e.id)) continue;
          store.updateLineEvent(e.id, { status: "closed", endedAt: e.ended_at ?? Math.max(e.started_at + STEP_MS, from) }, nowMs);
        }
        store.setKV(KV_LINE_CURSOR, String(to));
      } catch (err) {
        log(`account ${account.id} line job failed: ${String(err?.message ?? err).slice(0, 200)}`, "warning");
        results.push({ accountId: account.id, error: String(err?.message ?? err) });
      }
    }
    return results;
  }

  return { tick };
}
