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
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { fleetContract, KV_BILLING_DAY } from "../src/contract.mjs";
import { createSlackAlertsJob } from "../src/slack-job.mjs";
import { lineStatus, stops, costs, robotHistory, parseQuery, createAgentApi, AgentQueryError } from "../src/agent-api.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-10-07T21:14:00Z"); // 2:14 pm Pacific, a Wednesday

/** A manufacturing account with two UR arms on push: Loader 2 (UR10e) and
 *  Deburr (UR5e), working two weeks on a two-minute cycle up to six days
 *  ago, then switched off, and no Slack. Stops are recorded from each
 *  robot's latest sample, so later samples have to come in time order. */
function shop() {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "1");
  s.setKV("owner.tz", TZ);
  setBusinessType(s, "manufacturing");
  const add = (ext, name, model) => s.upsertRobot({ connector: "push", externalId: ext, displayName: name, brand: "Universal Robots", model, category: "machine_tending" }, T0 - 15 * DAY);
  const loader = add("loader-2", "Loader 2", "UR10e");
  const deburr = add("deburr", "Deburr", "UR5e");
  const push = (id, t, o = {}) => s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: true, stuck: false, ...o });
  for (const id of [loader, deburr]) {
    for (let t = T0 - 20 * DAY; t < T0 - 6 * DAY; t += 2 * MIN) push(id, t, { missionId: `c${id}::${t}` });
    push(id, T0 - 6 * DAY, { missionState: "off", moving: false });
    rebuildRollupsForRobot(s, id);
  }
  s.setKV(KV_CONFIRMED, "1");
  return { s, loader, deburr, push };
}

/** Two closed stops for Loader 2 earlier this month, one open now. */
function withStops() {
  const lab = shop();
  const { s, loader, push } = lab;
  const control = openControl(":memory:");
  control.upsertAccount("dana@linelab.io", T0 - DAY);
  const job = createSlackAlertsJob({ control, tenants: { get: () => s }, vault: { ready: false } });
  const stopAt = async (t, minutes) => {
    push(loader, t, { stuck: true, moving: false, errors: [{ code: "C153", severity: "ERROR", description: "protective stop" }] });
    await job.tick(t + 1000);
    if (minutes !== null) {
      // Back, then switched off for the night, so the quiet after it is not
      // read as a lost gateway.
      push(loader, t + minutes * MIN, { missionState: "off", moving: false });
      await job.tick(t + minutes * MIN + 1000);
    }
  };
  return { ...lab, control, job, stopAt };
}

test("stops are recorded for an account that never connected Slack", async () => {
  const lab = withStops();
  await lab.stopAt(T0 - 3 * DAY, 12);
  const rows = lab.s.queryIncidents();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].code, rows[0].status, rows[0].ended_at - rows[0].started_at], ["stop", "C153", "closed", 12 * MIN]);
  assert.equal(rows[0].notified_at, null, "nothing was posted anywhere");
});

test("stops: a window, one robot, measured minutes, a priced cost that says it is estimated and how", async () => {
  const lab = withStops();
  await lab.stopAt(T0 - 5 * DAY, 12);
  await lab.stopAt(T0 - 2 * DAY, 8);
  await lab.stopAt(T0 - 2 * MIN, null);
  const c = fleetContract(lab.s, T0, {});
  const out = stops(lab.s, c, T0, parseQuery(new URLSearchParams(`robot=${lab.loader}`), T0));
  assert.equal(out.stops.length, 3);
  const [open, second, first] = out.stops;
  assert.deepEqual([open.open, open.minutes.value, open.robot.name, open.label], [true, 2, "Loader 2", "protective stop"]);
  assert.deepEqual([second.minutes.value, first.minutes.value], [8, 12]);
  assert.equal(first.minutes.basis, "measured");
  const perHour = c.robots.find((r) => r.id === lab.loader).cost.perHourCents;
  assert.equal(first.cost.stopCents.value, Math.round((perHour * 12) / 60), "the same arithmetic the Slack alert uses");
  assert.equal(first.cost.stopCents.basis, "estimated");
  assert.match(first.cost.stopCents.math, /an hour to own and run x 12 min \/ 60/);
  assert.equal(out.totals.minutes.value, 22);
  assert.equal(out.totals.cost.stopsCents.value, out.stops.reduce((n, s) => n + s.cost.stopCents.value, 0));

  const lastTwoDays = stops(lab.s, c, T0, parseQuery(new URLSearchParams(`since=${T0 - 3 * DAY}`), T0));
  assert.equal(lastTwoDays.stops.length, 2);
  assert.equal(stops(lab.s, c, T0, parseQuery(new URLSearchParams(`robot=${lab.deburr}`), T0)).stops.length, 0);
  assert.throws(() => stops(lab.s, c, T0, parseQuery(new URLSearchParams("robot=999"), T0)), AgentQueryError);
});

test("the stop feed: a cursor returns only what changed since, so a stop that ends comes round again", async () => {
  const lab = withStops();
  await lab.stopAt(T0 - 2 * DAY, 8);
  await lab.stopAt(T0 - 10 * MIN, null);
  const api = createAgentApi({ store: lab.s, now: () => T0 });
  const all = api.stops(new URLSearchParams("after=0-0"));
  assert.equal(all.stops.length, 2);
  assert.deepEqual(all.stops.map((s) => s.open), [false, true], "oldest change first");
  assert.equal(api.stops(new URLSearchParams(`after=${all.cursor}`)).stops.length, 0, "nothing new");

  lab.push(lab.loader, T0 - MIN);
  await lab.job.tick(T0);
  const next = api.stops(new URLSearchParams(`after=${all.cursor}`));
  assert.equal(next.stops.length, 1);
  assert.deepEqual([next.stops[0].open, next.stops[0].minutes.value], [false, 9]);
});

test("a stop names the robots it left waiting and a machine jam just before it, as a pattern, not a diagnosis", async () => {
  const lab = withStops();
  const t = T0 - DAY;
  lab.s.upsertLineEvent({ line: "Cell 1", kind: "jam", station: "CNC mill A", confidence: "high", startedAt: t - 6 * MIN, endedAt: t - MIN, idle: { [lab.loader]: 5 * MIN }, idleMinutes: 5, costCents: 40, status: "closed" }, t);
  lab.s.upsertLineEvent({ line: "Cell 1", kind: "stop", station: "Loader 2", robotId: lab.loader, startedAt: t, endedAt: t + 12 * MIN, idle: { [lab.deburr]: 10 * MIN }, idleMinutes: 10, costCents: 60, status: "closed" }, t);
  await lab.stopAt(t, 12);
  const out = createAgentApi({ store: lab.s, now: () => T0 }).stops(new URLSearchParams(""));
  const ctx = out.stops[0].context;
  assert.equal(ctx.line, "Cell 1");
  assert.deepEqual(ctx.leftWaiting.map((w) => [w.name, w.minutes]), [["Deburr", 10]]);
  assert.deepEqual(ctx.machineJamsBefore.map((j) => j.station), ["CNC mill A"]);
  assert.match(ctx.note, /not a diagnosis/);
});

test("costs come from the dashboard's own cost block, figure for figure, with the math", () => {
  const lab = shop();
  const c = fleetContract(lab.s, T0, {});
  const out = costs(lab.s, c, T0);
  for (const r of out.robots) {
    const src = c.robots.find((x) => x.id === r.id).cost;
    assert.equal(r.cost.perHourCents.value, src.perHourCents);
    assert.equal(r.cost.idleYearCents.value, src.idleCostYearCents);
    assert.equal(r.workingShare.value, src.workingPct);
    assert.equal(r.cost.perHourCents.basis, "estimated", "list prices until the owner enters their own");
    assert.match(r.cost.perHourCents.math, /^ownership \$[\d.]+ \+ maintenance \$[\d.]+ \+ energy \$[\d.]+, UR(10|5)e at \$/);
    assert.match(r.cost.idleYearCents.math, /not a promise/);
  }
  assert.equal(out.fleet.cost.perHourCents.value, c.robots.reduce((n, r) => n + r.cost.perHourCents, 0));
});

test("history by hour and by day, and how many times the robot stopped this month", async () => {
  const lab = withStops();
  await lab.stopAt(T0 - 5 * DAY, 12);
  await lab.stopAt(T0 - 2 * DAY, 8);
  const c = fleetContract(lab.s, T0, {});
  const hourly = robotHistory(lab.s, c, T0, lab.loader, parseQuery(new URLSearchParams(`since=${T0 - 7 * DAY}&until=${T0 - 6 * DAY}`), T0));
  assert.ok(hourly.buckets.length >= 23 && hourly.buckets.length <= 25);
  assert.ok(hourly.buckets.every((b) => b.activeMinutes <= 60));
  assert.ok(hourly.buckets.some((b) => b.units > 0));
  const daily = robotHistory(lab.s, c, T0, lab.loader, parseQuery(new URLSearchParams("bucket=day"), T0));
  assert.equal(daily.buckets.reduce((n, b) => n + b.stops, 0), 2);
  assert.equal(daily.buckets.reduce((n, b) => n + b.downMinutes, 0), 20);
  assert.deepEqual(daily.stopsThisMonth.count, 2);
  assert.deepEqual(daily.stopsThisMonth.kinds, { stop: 2 });
  assert.throws(() => robotHistory(lab.s, c, T0, lab.loader, parseQuery(new URLSearchParams(`since=${T0 - 100 * DAY}`), T0)), /At most 92 days/);
  assert.throws(() => robotHistory(lab.s, c, T0, 999, parseQuery(new URLSearchParams(""), T0)), /not on this account/);
});

test("line status says what each robot is doing now, how fresh that is, and which stop is open", async () => {
  const lab = withStops();
  lab.push(lab.deburr, T0 - 10_000);
  await lab.stopAt(T0 - 20_000, null);
  const out = lineStatus(lab.s, fleetContract(lab.s, T0, {}), T0);
  const by = Object.fromEntries(out.robots.map((r) => [r.name, r]));
  assert.deepEqual([by["Loader 2"].state, by["Loader 2"].live, by["Loader 2"].openStopId], ["stopped", true, 1]);
  assert.deepEqual([by.Deburr.state, by.Deburr.lagSeconds, by.Deburr.openStopId], ["working", 10, null]);
  assert.equal(by["Loader 2"].workingPct10, 0, "stopped the last 20 seconds and silent before: no working time in the last ten minutes");
  assert.equal(by.Deburr.workingPct10, 100);
  const later = lineStatus(lab.s, fleetContract(lab.s, T0 + 5 * MIN, {}), T0 + 5 * MIN);
  assert.equal(later.live, false, "five minutes without a sample is not live");
});

test("a question it cannot read is refused with a reason", () => {
  for (const [q, msg] of [["since=yesterday", /since must be a time/], [`since=${T0}&until=${T0 - 1}`, /before until/], ["robot=abc", /robot id/], ["limit=0", /limit/], ["after=5", /cursor/], ["bucket=week", /hour or day/]]) {
    assert.throws(() => parseQuery(new URLSearchParams(q), T0), msg, q);
  }
  assert.deepEqual(parseQuery(new URLSearchParams(""), T0), { sinceMs: T0 - 7 * DAY, untilMs: T0, robotId: null, limit: 200, after: null, bucket: "hour" });
});

test("over HTTP: signed in, GET only, each account sees only its own robots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "botlien-agent-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => T0, baseUrl: "http://127.0.0.1", readBody });
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const signIn = async (email) => {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    const token = sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1];
    return (await fetch(`${base}/signin/${token}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  };
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  try {
    const dana = await signIn("dana@linelab.io");
    const store = tenants.get(control.accountByEmail("dana@linelab.io").id);
    const id = store.upsertRobot({ connector: "push", externalId: "loader-2", displayName: "Loader 2", model: "UR10e", category: "machine_tending" }, T0 - DAY);
    store.insertSnapshot({ robotId: id, at: T0 - 5_000, receivedAt: T0 - 5_000, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: true, stuck: false });

    assert.equal((await api("/api/v1/agent/line")).status, 303, "a session is needed");
    const line = await (await api("/api/v1/agent/line", dana)).json();
    assert.deepEqual(line.robots.map((r) => [r.name, r.state, r.live]), [["Loader 2", "working", true]]);
    assert.equal((await api("/api/v1/agent/stops", dana)).status, 200);
    assert.equal((await api("/api/v1/agent/costs", dana)).status, 200);
    assert.equal((await api(`/api/v1/agent/robots/${id}/history?bucket=day`, dana)).status, 200);
    const bad = await api("/api/v1/agent/stops?since=nope", dana);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /since/);
    assert.equal((await api("/api/v1/agent/robots/999/history", dana)).status, 400);
    assert.equal((await api("/api/v1/agent/nothing", dana)).status, 404);
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await api("/api/v1/agent/line", dana, { method })).status, 405, method);

    const sam = await signIn("sam@harborgrill.com");
    assert.deepEqual((await (await api("/api/v1/agent/line", sam)).json()).robots, []);
    assert.equal((await api(`/api/v1/agent/robots/${id}/history`, sam)).status, 400, "another account's robot is not on this account");
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
    tenants.closeAll();
    control.close();
  }
});
