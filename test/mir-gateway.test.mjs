import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openStore } from "../src/store.mjs";
import { pushEvents } from "../src/push.mjs";
import { createSender } from "../gateway/ur/sender.mjs";
import { loadConfig, runGateway } from "../gateway/ur/gateway.mjs";
import { readMirStatus, createMir, mirAuthHeader, mirBase, pollMir, isMirHeartbeat } from "../gateway/ur/mir.mjs";
import { startFakeMir, fakeMirStatus } from "../gateway/ur/fake-mir.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (state_id, extra = {}) => ({ state_id, velocity: { linear: 0, angular: 0 }, battery_percentage: 80, position: { x: 1, y: 2 }, errors: [], ...extra });
const listening = (server) => new Promise((r) => (server.listening ? r() : server.once("listening", r)));
const closing = (server) => new Promise((r) => server.close(r));

test("MiR states map to Botlien's terms", () => {
  assert.equal(readMirStatus(status(5, { velocity: { linear: 0.8 } })).missionState, "executing");
  assert.equal(readMirStatus(status(3)).missionState, "idle");
  assert.equal(readMirStatus(status(8)).missionState, "idle", "docked and charging is not work");
  assert.equal(readMirStatus(status(4)).missionState, "paused");
  assert.equal(readMirStatus(status(1)).missionState, "off");
  const e = readMirStatus(status(10));
  assert.equal(e.missionState, "stopped");
  assert.equal(e.eStop, true);
  assert.equal(e.errors.at(-1).code, "MIR-STATE-10");
  const err = readMirStatus(status(12, { errors: [{ code: 10301, module: "Planner", description: "Path blocked" }] }));
  assert.equal(err.missionState, "stopped");
  assert.deepEqual(err.errors, [{ code: "MIR-10301", severity: "ERROR", description: "Planner: Path blocked" }]);
  assert.equal(readMirStatus(status(12)).errors[0].code, "MIR-STATE-12", "an Error state with no list is still downtime");
  assert.equal(readMirStatus(status(11)).manual, true);
  assert.equal(readMirStatus(status(5, { mission_queue_id: 77 })).missionId, "mir-queue:77");
  assert.equal(readMirStatus(status(3, { mission_queue_id: 77 })).missionId, null, "a finished mission is not a new one");
  assert.equal(readMirStatus(status(3, { battery_percentage: 140 })).battery, 100);
});

test("MiR's login header is Basic user:sha256(password), and the API address is built from a bare IP", () => {
  const h = mirAuthHeader("distributor:distributor");
  const want = Buffer.from(`distributor:${createHash("sha256").update("distributor").digest("hex")}`).toString("base64");
  assert.equal(h, `Basic ${want}`);
  assert.throws(() => mirAuthHeader("nopassword"), /user:password/);
  assert.equal(mirBase("192.168.12.20"), "http://192.168.12.20/api/v2.0.0");
  assert.equal(mirBase("10.0.0.5", 8080), "http://10.0.0.5:8080/api/v2.0.0");
  assert.equal(mirBase("https://fleet.local/"), "https://fleet.local/api/v2.0.0");
});

test("executing and parked is waiting only after the hold, dated from when it stopped; a short stop is work", () => {
  const mir = createMir({ id: "m1", name: "Tugger" }, { heartbeatMs: 60_000, holdMs: 5_000 });
  const t0 = Date.parse("2026-10-10T10:00:00Z");
  const drive = (at) => mir.feed(status(5, { velocity: { linear: 0.9 }, mission_queue_id: 1 }), at);
  const park = (at) => mir.feed(status(5, { mission_queue_id: 1 }), at);
  const [first] = drive(t0);
  assert.equal(first.mission_state, "active");
  assert.equal(first.mission_id, "mir-queue:1");
  assert.equal(first.brand, "MiR");
  assert.equal(first.category, "putaway");
  assert.equal(first.battery_pct, 80);
  // Someone walks in front of it for 3 s: still work, nothing sent.
  assert.deepEqual(park(t0 + 1000), []);
  assert.deepEqual(park(t0 + 4000), []);
  assert.deepEqual(drive(t0 + 4500), []);
  // Parked at the cell for the operator: waiting, dated at the first still poll.
  assert.deepEqual(park(t0 + 10_000), []);
  assert.deepEqual(mir.tick(t0 + 14_000), [], "no heartbeat while the stop is undecided");
  const [wait] = park(t0 + 15_500);
  assert.equal(wait.mission_state, "waiting");
  assert.equal(wait.at, new Date(t0 + 10_000).toISOString());
  assert.deepEqual(park(t0 + 16_000), [], "no repeat");
  // The next mission counts as a new unit of work.
  const [next] = mir.feed(status(5, { velocity: { linear: 0.9 }, mission_queue_id: 2 }), t0 + 20_000);
  assert.equal(next.mission_id, "mir-queue:2");
  assert.equal(next.mission_state, "active");
});

test("an e-stop goes out at once, heartbeats fill the gaps, and a lost link is offline without an error", () => {
  const mir = createMir({ id: "m1" }, { heartbeatMs: 15_000, holdMs: 5_000 });
  const t0 = 1_800_000_000_000;
  mir.feed(status(3), t0);
  const [stop] = mir.feed(status(10), t0 + 1000);
  assert.equal(stop.e_stop, true);
  assert.equal(stop.mission_state, "stopped");
  assert.deepEqual(mir.tick(t0 + 10_000), []);
  const [beat] = mir.tick(t0 + 16_500);
  assert.ok(isMirHeartbeat(beat));
  assert.equal(beat.e_stop, true, "a heartbeat repeats the state");
  const [off] = mir.down(t0 + 20_000, "ETIMEDOUT");
  assert.equal(off.connection_state, "offline");
  assert.equal(off.errors, undefined, "a dropped link is not the robot failing");
  assert.deepEqual(mir.down(t0 + 21_000, "ETIMEDOUT"), [], "said once per outage");
});

test("the poller only ever sends GET, reads every robot on a Fleet server, and says when the login is wrong", async () => {
  const fleet = startFakeMir({ port: 0, fleet: 2 });
  await listening(fleet.server);
  const port = fleet.server.address().port;
  const seen = new Map();
  const p = pollMir({ host: "127.0.0.1", port, fleet: true, auth: mirAuthHeader("distributor:distributor"), intervalMs: 50, onStatus: (key, st) => seen.set(key, st), onDown: () => {}, log: () => {} });
  await sleep(400);
  p.stop();
  assert.deepEqual([...seen.keys()].sort(), ["1", "2"]);
  assert.equal(seen.get("2").robot_name, "MiR250 2");
  assert.ok(fleet.requests.length > 3);
  assert.ok(fleet.requests.every((r) => r.method === "GET"), "read only");

  const logs = [];
  const downs = [];
  const bad = pollMir({ host: "127.0.0.1", port, fleet: true, auth: mirAuthHeader("distributor:wrong"), intervalMs: 50, onStatus: () => {}, onDown: (k, reason) => downs.push(reason), log: (m) => logs.push(m) });
  await sleep(300);
  bad.stop();
  await closing(fleet.server);
  assert.equal(logs.length, 1, "said once, not every poll");
  assert.match(logs[0], /refused the login \(401\)/);
});

test("the gateway config takes MiRs alone or next to arms, and an id is never shared", () => {
  const c = loadConfig(JSON.stringify({ botlien: "https://app.botlien.com", mir: [{ id: "mir-1", host: "192.168.12.20" }] }));
  assert.deepEqual(c.arms, []);
  assert.equal(c.mirHoldSeconds, 10);
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://app.botlien.com" })), /at least one robot/);
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://app.botlien.com", mir: [{ id: "x" }] })), /needs a "host"/);
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://app.botlien.com", arms: [{ id: "x", host: "1.1.1.1" }], mir: [{ id: "x", host: "1.1.1.2" }] })), /share the id x/);
});

test("a simulated MiR delivery loop reaches Botlien with missions counted, waiting kept out of work, and the e-stop as downtime", async () => {
  const store = openStore(":memory:");
  store.setKV("owner.business_type", "manufacturing");
  // Drive 1 s, wait at the cell 1.5 s, drive back 1 s, rest 1 s; every second
  // loop the rest is an e-stop.
  const sim = startFakeMir({ port: 0, drive: 1, wait: 1.5, rest: 1, stopEvery: 2, stop: 1 });
  await listening(sim.server);
  const sender = createSender({
    url: "https://app.botlien.test",
    key: "blk_test",
    post: async (url, key, body) => ({ status: 200, body: pushEvents(store, body, Date.now()) }),
    flushMs: 500,
    log: () => {},
  });
  const config = loadConfig(JSON.stringify({ botlien: "https://app.botlien.test", heartbeatSeconds: 1, mirPollSeconds: 0.1, mirHoldSeconds: 0.5, mir: [{ id: "mir-1", host: "127.0.0.1", port: sim.server.address().port, name: "Tugger 1", model: "MiR250" }] }));
  const gw = runGateway(config, { sender, log: () => {}, mirAuth: "distributor:distributor" });
  try {
    await sleep(9500);
  } finally {
    await gw.stop();
    await closing(sim.server);
  }
  assert.ok(sim.requests.every((r) => r.method === "GET"), "read only");
  const [robot] = store.listRobots();
  assert.equal(robot.display_name, "Tugger 1");
  assert.equal(robot.brand, "MiR");
  assert.equal(robot.category, "putaway", "a MiR is priced as moving material, not as a robot arm");
  const rows = store.rollupsBetweenAll(0, Date.now() + 3_600_000);
  const active = rows.reduce((a, r) => a + r.active_ms, 0);
  const online = rows.reduce((a, r) => a + r.online_ms, 0);
  const share = active / online;
  // Each 4.5 s loop: 2 s of driving, the 1.5 s wait counts as work only for
  // the 0.5 s hold, so about 2.5 s of 4.5 s (55%), never the 78% of "executing".
  assert.ok(share > 0.4 && share < 0.7, `working share ${share}`);
  assert.ok(rows.reduce((a, r) => a + r.mission_count, 0) >= 2, "one mission per queue id");
  const stops = store.listIncidents({ sinceMs: 0 });
  assert.ok(stops.some((i) => i.kind === "e-stop" && i.code === "MIR-1100"), `the e-stop is a stop record: ${JSON.stringify(stops.map((i) => i.kind))}`);
});

test("the fake loop is what the docs say it is", () => {
  assert.equal(fakeMirStatus(500, { drive: 1, wait: 1, rest: 1 }).velocity.linear, 0.9);
  assert.equal(fakeMirStatus(1500, { drive: 1, wait: 1, rest: 1 }).velocity.linear, 0);
  assert.equal(fakeMirStatus(1500, { drive: 1, wait: 1, rest: 1 }).state_id, 5);
  assert.equal(fakeMirStatus(3500, { drive: 1, wait: 1, rest: 1 }).state_id, 3);
  assert.equal(fakeMirStatus(3500, { drive: 1, wait: 1, rest: 1, stopEvery: 1, stop: 1 }).state_id, 10);
});
