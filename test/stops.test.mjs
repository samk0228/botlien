import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { startBoard, readBody } from "../src/board.mjs";
import { fleetContract } from "../src/contract.mjs";
import { createLineJob } from "../src/line-job.mjs";
import { stopFeed, ackStop, fixStop, escalateStops, dashEscalationDue } from "../src/stops.mjs";
import { stopStory, rewind, advance, replayStatus, loadRecording } from "../src/replay.mjs";

const SEC = 1000;
const MIN = 60 * SEC;
// Fixed, and in the past, so a replayed sample is never "in the future".
const T0 = Date.parse("2026-10-07T15:00:00Z");

/** Play the stop story on a fake clock the way the server does: the replay
 *  every second, escalation every 30, the line job every two minutes. Stops
 *  at `untilMs` (default the end of the story). Returns the store. */
async function play(store, { untilMs = T0 + 41 * MIN, onTick = () => {} } = {}) {
  const control = { listAccounts: () => [{ id: 1, email: "demo@botlien.com" }] };
  const line = createLineJob({ control, tenants: { get: () => store }, vault: { ready: false } });
  for (let t = T0; t <= untilMs; t += SEC) {
    advance(store, t);
    if ((t - T0) % (30 * SEC) === 0) escalateStops(store, t);
    if ((t - T0) % (2 * MIN) === 0) await line.tick(t);
    await onTick(t);
  }
  return store;
}

/** The feed's stops, with times made relative to the start, for comparing runs. */
function relative(feed) {
  return feed.stops.map((s) => ({ ...s, startedAt: s.startedAt - T0, endedAt: s.endedAt && s.endedAt - T0, updatedAt: undefined, cursor: undefined, escalation: { ...s.escalation, at: s.escalation.at && s.escalation.at - T0 }, acks: s.acks.map((a) => ({ ...a, at: a.at - T0, until: a.until && a.until - T0 })), fix: s.fix && { ...s.fix, at: s.fix.at - T0 } }));
}

test("the stop story is the same every time it is built", () => {
  const a = stopStory(), b = stopStory();
  assert.deepEqual(a, b);
  assert.equal(a.durationMs, 40 * MIN);
  assert.ok(a.events.every((e, i) => i === 0 || e.offsetMs >= a.events[i - 1].offsetMs));
});

test("a replayed stop is a stop record the moment its sample lands, marked replay, never live", async () => {
  const s = openStore(":memory:");
  rewind(s, {}, T0);
  await play(s, { untilMs: T0 + 2 * MIN - SEC });
  assert.equal(s.queryIncidents().length, 0);
  advance(s, T0 + 2 * MIN);
  const feed = stopFeed(s, fleetContract(s, T0 + 2 * MIN, {}), T0 + 2 * MIN, null);
  assert.equal(feed.stops.length, 1, "on the same call that played the sample, not the next job tick");
  const st = feed.stops[0];
  assert.deepEqual([st.robot.name, st.state, st.source, st.type, st.errorCode, st.description, st.repeatCount], ["Loader 2", "open", "replay", "stop", "C153", "Protective stop: position deviation", 1]);
  assert.equal(st.startedAt, T0 + 2 * MIN);
  assert.equal(replayStatus(s, T0 + 2 * MIN).source, "replay");
});

test("the whole story: escalates unanswered, one person acknowledges, it closes, repeats, the fix is logged", async () => {
  const s = openStore(":memory:");
  rewind(s, {}, T0);
  let cursor = null;
  const seen = new Map(); // what a dashboard keyed by id would hold
  const poll = (t) => {
    const f = stopFeed(s, fleetContract(s, t, {}), t, cursor && { updatedAt: Number(cursor.split("-")[0]), id: Number(cursor.split("-")[1]) });
    for (const st of f.stops) seen.set(st.id, st);
    cursor = f.cursor;
    return f;
  };
  await play(s, { untilMs: T0 + 12 * MIN + 30 * SEC, onTick: (t) => (t - T0) % (3 * SEC) === 0 && poll(t) });
  assert.equal(seen.get(1).escalation.level, 1, "ten minutes unanswered: the lead");

  // Dana says she is on it; Sam's dashboard sees it on its next poll.
  ackStop(s, 1, { kind: "on" }, "dana@linelab.io", T0 + 13 * MIN);
  poll(T0 + 13 * MIN + 3 * SEC);
  assert.deepEqual(seen.get(1).acks.map((a) => [a.kind, a.by]), [["on", "dana@linelab.io"]]);
  assert.throws(() => ackStop(s, 1, { kind: "wave" }, "dana@linelab.io", T0 + 13 * MIN), /on, look or snooze/);

  await play(s, { untilMs: T0 + 41 * MIN, onTick: (t) => t > T0 + 13 * MIN && (t - T0) % (3 * SEC) === 0 && poll(t) });
  const loader = seen.get(1);
  assert.equal(loader.state, "closed");
  assert.equal(loader.repeatCount, 2, "it stopped again within ten minutes: the same stop, twice");
  assert.equal(loader.escalation.level, 1, "claimed before the manager was due");
  // Deburr and Inspection starved the whole time. Loader 1 kept cycling and
  // its ordinary half-minute waits count too, as the line rule stands today.
  const waited = Object.fromEntries(loader.leftWaiting.map((w) => [w.name, w.minutes]));
  assert.ok(waited.Deburr >= 13 && waited.Inspection >= 13, JSON.stringify(waited));
  assert.ok(!waited["Loader 1"] || waited["Loader 1"] < 6, JSON.stringify(waited));
  const perHour = fleetContract(s, T0 + 41 * MIN, {}).robots.find((r) => r.name === "Loader 2").cost.perHourCents;
  assert.equal(loader.robotTimeCost.cents, Math.round((perHour * loader.minutes) / 60));
  assert.equal(loader.robotTimeCost.basis, "estimated");
  assert.equal(loader.partsLost, null, "null until the owner enters a profit per part");
  const insp = seen.get(2);
  assert.deepEqual([insp.robot.name, insp.type, insp.errorCode, insp.minutes, insp.state], ["Inspection", "fault", "C207", 4, "closed"]);
  assert.equal(seen.size, 2, "two stops, never a duplicate, however often it was polled");
  assert.equal(s.queryIncidents().filter((i) => i.kind === "offline").length, 0, "the shift ending is not a lost robot");

  fixStop(s, 1, { text: "Re-taught the pick position after the fixture shifted" }, "dana@linelab.io", T0 + 42 * MIN);
  poll(T0 + 42 * MIN + 3 * SEC);
  assert.deepEqual(seen.get(1).fix, { text: "Re-taught the pick position after the fixture shifted", by: "dana@linelab.io", at: T0 + 42 * MIN });
  assert.throws(() => fixStop(s, 1, { text: "  " }, "dana@linelab.io", T0), /what fixed it/);
});

test("a snooze holds the escalation until it runs out", () => {
  const inc = { status: "open", claimed_at: null, started_at: T0, escalated: 0, escalated_at: null };
  const snooze = [{ kind: "snooze", until: T0 + 20 * MIN }];
  assert.equal(dashEscalationDue(inc, [], T0 + 10 * MIN), 1);
  assert.equal(dashEscalationDue(inc, snooze, T0 + 15 * MIN), 0);
  assert.equal(dashEscalationDue(inc, snooze, T0 + 25 * MIN), 0, "ten minutes from the end of the snooze");
  assert.equal(dashEscalationDue(inc, snooze, T0 + 30 * MIN), 1);
  assert.equal(dashEscalationDue({ ...inc, claimed_at: T0 }, [], T0 + 30 * MIN), 0);
});

test("rewind and run again: the same stops, the same ids, the same figures", async () => {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const s = openStore(":memory:");
    // The second run rewinds over the first's data on the same account.
    if (i === 1) {
      rewind(s, {}, T0);
      await play(s);
    }
    rewind(s, {}, T0);
    await play(s);
    runs.push(relative(stopFeed(s, fleetContract(s, T0 + 41 * MIN, {}), T0 + 41 * MIN, { updatedAt: 0, id: 0 })));
  }
  assert.equal(runs[0].length, 2);
  assert.deepEqual(runs[1], runs[0]);
});

test("a gateway recording loads as offsets from its first sample", () => {
  const text = [
    { robot_id: "a", at: "2026-09-30T10:00:15Z", mission_state: "active" },
    { robot_id: "a", at: "2026-09-30T10:00:00Z", mission_state: "waiting" },
  ].map((e) => JSON.stringify(e)).join("\n");
  const rec = loadRecording("ursim", text);
  assert.deepEqual(rec.events.map((e) => [e.offsetMs, e.event.mission_state, "at" in e.event]), [[0, "waiting", false], [15 * SEC, "active", false]]);
});

test("over HTTP: the feed, acknowledge and fix; a technician acts on stops but never receives a dollar figure; rewind is demo-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "botlien-stops-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  let clock = T0;
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => clock, baseUrl: "http://127.0.0.1", readBody, demoEmails: "demo@botlien.com" });
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redeem = async (token) => (await fetch(`${base}/signin/${token}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  const signIn = async (email) => {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    return redeem(sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
  };
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" });
  const json = async (path, cookie, init) => (await api(path, cookie, init)).json();
  const hasMoney = (v) => JSON.stringify(v, (k, x) => (/cents/i.test(k) && x !== null ? "LEAK" : x)).includes("LEAK") || /"(robotTimeCost|partsLost)":\{[^}]*"(basis|math)":"[^"]/.test(JSON.stringify(v)) || /\$\s?\d/.test(JSON.stringify(v));
  try {
    const owner = await signIn("demo@botlien.com");
    const other = await signIn("sam@linelab.io");
    assert.equal((await api("/api/v1/replay", other, { method: "POST", body: JSON.stringify({ action: "rewind" }) })).status, 403, "never on a customer's account");

    assert.equal((await json("/api/v1/replay", owner, { method: "POST", body: JSON.stringify({ action: "rewind" }) })).running, true);
    const b = sent.length;
    await api("/api/v1/members", owner, { method: "POST", body: JSON.stringify({ email: "dana@demo.io", role: "technician" }) });
    const dana = await redeem(sent.slice(b).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
    assert.equal((await api("/api/v1/replay", dana, { method: "POST", body: JSON.stringify({ action: "rewind" }) })).status, 403);

    const store = tenants.get(control.accountByEmail("demo@botlien.com").id);
    await play(store, { untilMs: T0 + 3 * MIN });
    clock = T0 + 3 * MIN;
    const first = await json("/api/v1/stops", owner);
    assert.deepEqual(first.stops.map((s) => [s.id, s.robot.name, s.state, s.source]), [[1, "Loader 2", "open", "replay"]]);
    assert.ok(first.stops[0].robotTimeCost.cents > 0, "the owner sees the cost");
    assert.deepEqual((await json(`/api/v1/stops?since=${first.cursor}`, owner)).stops, [], "nothing new, nothing repeated");

    const techView = await json("/api/v1/stops", dana);
    assert.equal(hasMoney(techView), false, "a technician's feed has no dollar figure");
    assert.equal(techView.stops[0].errorCode, "C153");
    const acked = await api("/api/v1/stops/1/ack", dana, { method: "POST", body: JSON.stringify({ kind: "on" }) });
    assert.equal(acked.status, 200, "a technician may acknowledge");
    assert.equal(hasMoney(await acked.json()), false);
    const seen = await json(`/api/v1/stops?since=${first.cursor}`, owner);
    assert.deepEqual(seen.stops.map((s) => [s.id, s.acks[0].by, s.acks[0].kind]), [[1, "dana@demo.io", "on"]], "and the owner sees it on the next poll");
    assert.equal((await api("/api/v1/stops/1/fix", dana, { method: "POST", body: JSON.stringify({ text: "Cleared the fixture" }) })).status, 200);
    assert.equal((await api("/api/v1/stops/99/ack", owner, { method: "POST", body: JSON.stringify({ kind: "on" }) })).status, 404);
    assert.equal((await api("/api/v1/stops/1/ack", owner, { method: "POST", body: "{nope" })).status, 400);
    assert.equal((await api("/api/v1/inputs", dana, { method: "POST", body: "{}" })).status, 403, "still nothing else");
    assert.deepEqual((await json("/api/v1/stops", other)).stops, [], "another account sees none of it");
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
    tenants.closeAll();
    control.close();
  }
});

test("the Team page's request shapes are accepted: since=0 before a cursor, and `what` for the fix", async () => {
  const s = openStore(":memory:");
  rewind(s, {}, T0);
  await play(s, { untilMs: T0 + 17 * MIN });
  const { parseCursor } = await import("../src/stops.mjs");
  assert.equal(parseCursor("0"), null);
  assert.deepEqual(stopFeed(s, fleetContract(s, T0 + 17 * MIN, {}), T0 + 17 * MIN, parseCursor("0")).stops.map((x) => x.id), [1]);
  fixStop(s, 1, { what: "Reset the machine it waits on" }, "dana@linelab.io", T0 + 17 * MIN);
  assert.equal(s.incident(1).fix_text, "Reset the machine it waits on");
});
