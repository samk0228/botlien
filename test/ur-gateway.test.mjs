import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { pushEvents } from "../src/push.mjs";
import { fleetContract } from "../src/contract.mjs";
import { packet, createFramer, encodeData, decodeData, connectRtde, TYPE, DEFAULT_FIELDS } from "../gateway/ur/rtde.mjs";
import { readSample, createArm, isHeartbeat } from "../gateway/ur/arm.mjs";
import { createSender } from "../gateway/ur/sender.mjs";
import { loadConfig, runGateway } from "../gateway/ur/gateway.mjs";
import { startFakeUrsim, simulateCell } from "../gateway/ur/fake-ursim.mjs";

const once = (ev, name, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${name} in ${ms} ms`)), ms);
    ev.once(name, (x) => {
      clearTimeout(t);
      resolve(x);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the wire ----

test("every RTDE type round-trips, and a packet split across reads is reassembled", () => {
  const types = ["BOOL", "UINT8", "UINT32", "UINT64", "INT32", "DOUBLE", "VECTOR3D", "VECTOR6D", "VECTOR6INT32", "VECTOR6UINT32"];
  const values = [true, 7, 4_000_000_000, 123456789, -42, 3.25, [1, 2, 3], [1, -2, 3, -4, 5, -6], [1, -2, 3, -4, 5, -6], [1, 2, 3, 4, 5, 6]];
  const names = types.map((t) => t.toLowerCase());
  const payload = encodeData(3, values, types);
  assert.deepEqual(Object.values(decodeData(payload, names, types)), values);

  const got = [];
  const frame = createFramer((type, p) => got.push([type, p.length]));
  const whole = Buffer.concat([packet(TYPE.DATA_PACKAGE, payload), packet(TYPE.START, Buffer.from([1]))]);
  frame(whole.subarray(0, 5));
  frame(whole.subarray(5, 40));
  frame(whole.subarray(40));
  assert.deepEqual(got, [[TYPE.DATA_PACKAGE, payload.length], [TYPE.START, 1]]);
});

test("the gateway refuses every port that can command an arm", () => {
  for (const port of [29999, 30001, 30002, 30003, 80]) {
    assert.throws(() => connectRtde({ host: "127.0.0.1", port }), /not allowed/, String(port));
  }
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://x", arms: [{ id: "a", host: "h", port: 30002 }] })), /30002 is not allowed/);
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://x", arms: [{ id: "a", host: "h" }, { id: "a", host: "i" }] })), /share the id/);
  assert.throws(() => loadConfig(JSON.stringify({ botlien: "https://x", arms: [{ id: "a", host: "h", cycleRegister: 99 }] })), /0 to 47/);
  assert.equal(loadConfig(JSON.stringify({ botlien: "https://x", arms: [{ id: "a", host: "h" }] })).heartbeatSeconds, 15);
});

test("the handshake reaches streaming, and the client never asks to write", async () => {
  const notes = [];
  const sim = await startFakeUrsim({ port: 0, cell: simulateCell({ cycleSeconds: 2, moveSeconds: 0.5 }), log: (m) => notes.push(m) });
  const rtde = connectRtde({ host: "127.0.0.1", port: sim.port, fields: [...DEFAULT_FIELDS, "output_int_register_24"], frequency: 50 });
  try {
    const c = await once(rtde, "connected");
    assert.equal(c.version, "5.15.0.0");
    const s = await once(rtde, "sample");
    assert.equal(s.robot_mode, 7);
    assert.equal(s.actual_current.length, 6);
    assert.ok(Number.isInteger(s.output_int_register_24));
    assert.deepEqual(notes, [], "no SETUP_INPUTS, no unexpected packet");
  } finally {
    rtde.stop();
    await sim.close();
  }
});

test("a field the controller does not have is dropped, not fatal", async () => {
  const sim = await startFakeUrsim({ port: 0 });
  const rtde = connectRtde({ host: "127.0.0.1", port: sim.port, fields: ["robot_mode", "joint_torques_on_mars"], frequency: 20 });
  const messages = [];
  rtde.on("message", (m) => messages.push(m));
  try {
    const c = await once(rtde, "connected");
    assert.deepEqual(c.fields, ["robot_mode"]);
    assert.match(messages.join(" "), /joint_torques_on_mars/);
  } finally {
    rtde.stop();
    await sim.close();
  }
});

// ---- what a sample means ----

test("safety and runtime states map to Botlien's terms", () => {
  const base = { robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [0, 0, 0, 0, 0, 0] };
  assert.equal(readSample(base).missionState, "playing");
  const pstop = readSample({ ...base, safety_mode: 3, runtime_state: 4 });
  assert.equal(pstop.missionState, "stopped");
  assert.equal(pstop.stuck, true);
  assert.equal(pstop.eStop, false);
  assert.deepEqual(pstop.errors.map((e) => [e.code, e.description]), [["UR-SAFETY-3", "protective stop"]]);
  const estop = readSample({ ...base, safety_mode: 7 });
  assert.equal(estop.eStop, true);
  assert.equal(estop.stuck, false);
  assert.equal(readSample({ ...base, safety_mode: 9 }).errors[0].severity, "ERROR");
  assert.equal(readSample({ ...base, robot_mode: 3 }).missionState, "off");
  assert.equal(readSample({ ...base, runtime_state: 4 }).missionState, "paused");
  assert.equal(readSample({ ...base, actual_qd: [0, 0.2, 0, 0, 0, 0] }).moving, true);
  assert.equal(readSample({ ...base, output_int_register_24: 17 }, { cycleRegister: 24 }).cycle, 17);
});

test("working means playing and moving: waiting on the mill is not work", () => {
  const arm = createArm({ id: "l1", model: "UR10e" }, { heartbeatMs: 60_000, holdMs: 2000 });
  const s = (at, moving, extra = {}) => ({ at, robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [moving ? 0.5 : 0, 0, 0, 0, 0, 0], ...extra });
  const out = [];
  let t = 1_790_000_000_000;
  for (let i = 0; i < 10; i++) out.push(...arm.feed(s((t += 100), true))); // 1 s moving
  for (let i = 0; i < 10; i++) out.push(...arm.feed(s((t += 100), false))); // a short pause: still work
  for (let i = 0; i < 40; i++) out.push(...arm.feed(s((t += 100), false))); // 4 s still: waiting
  for (let i = 0; i < 5; i++) out.push(...arm.feed(s((t += 100), true)));
  assert.deepEqual(out.map((e) => e.mission_state), ["active", "waiting", "active"]);
  // The wait is dated from the first still sample, not from where the hold ran out.
  assert.equal(Date.parse(out[1].at) - Date.parse(out[0].at), 1000, "one second of motion reads as one second of work");
  assert.equal(out[0].robot_id, "l1");
  assert.equal(out[0].brand, "Universal Robots");
  assert.equal(out[0].category, "machine_tending");
  assert.equal(out[1].ur.samples, 30, "the window since the last event rides along");
  assert.equal(out[1].ur.current_mean.length, 6);
});

test("a pause is judged whole: work if the arm moves again inside the hold, waiting from its first sample if not", () => {
  const playing = (at, moving, reg = 0) => ({ at, robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [moving ? 0.5 : 0, 0, 0, 0, 0, 0], output_int_register_25: reg });
  const t0 = 1_790_000_000_000;
  const run = (holdMs, steps) => {
    const arm = createArm({ id: "a", cycleRegister: 25 }, { heartbeatMs: 60_000, holdMs });
    const out = [];
    for (const [ms, moving, reg] of steps) out.push(...arm.feed(playing(t0 + ms, moving, reg)));
    return out.map((e) => [Date.parse(e.at) - t0, e.mission_state, e.cycle_count]);
  };
  const every = (from, to, moving, reg = 0) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => [from + i * 100, moving, reg]);

  // Ten seconds of motion, then the mill: work ends where the motion ends.
  assert.deepEqual(run(2000, [...every(0, 10_000, true), ...every(10_100, 20_000, false)]), [[0, "active", 0], [10_100, "waiting", 0]]);

  // The part is counted 0.3 s into the pause. Hold run out: the count goes
  // out after the wait began, as waiting, never as work.
  assert.deepEqual(
    run(2000, [...every(0, 1000, true), ...every(1100, 1300, false), ...every(1400, 4000, false, 1)]),
    [[0, "active", 0], [1100, "waiting", 0], [1400, "waiting", 1]],
  );
  // Same count, but the arm moves again inside the hold: all of it was work.
  assert.deepEqual(
    run(2000, [...every(0, 1000, true), ...every(1100, 1300, false), ...every(1400, 1900, false, 1), ...every(2000, 2500, true, 1)]),
    [[0, "active", 0], [1400, "active", 1]],
  );
  // A protective stop inside the hold ends the work at the stop.
  const stopped = { ...playing(t0 + 1500, false), safety_mode: 3 };
  const arm = createArm({ id: "b" }, { heartbeatMs: 60_000, holdMs: 2000 });
  const seen = [...every(0, 1000, true), ...every(1100, 1400, false)].flatMap(([ms, moving]) => arm.feed(playing(t0 + ms, moving)));
  seen.push(...arm.feed(stopped));
  assert.deepEqual(seen.map((e) => [Date.parse(e.at) - t0, e.mission_state]), [[0, "active"], [1500, "stopped"]]);

  // No hold at all: working is exactly moving.
  assert.deepEqual(run(0, [...every(0, 500, true), ...every(600, 800, false), ...every(900, 1000, true)]).map((e) => e.slice(0, 2)), [[0, "active"], [600, "waiting"], [900, "active"]]);
});

test("no heartbeat states work while a pause is undecided, and a stalled stream is judged by the clock", () => {
  const arm = createArm({ id: "a" }, { heartbeatMs: 1000, holdMs: 2000 });
  const t0 = 1_790_000_000_000;
  const s = (at, moving) => ({ at, robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [moving ? 0.5 : 0, 0, 0, 0, 0, 0] });
  assert.equal(arm.feed(s(t0, true)).length, 1);
  assert.equal(arm.feed(s(t0 + 100, false)).length, 0, "still, inside the hold: held");
  assert.equal(arm.tick(t0 + 1500).length, 0, "a heartbeat is due, but the pause is not judged yet");
  // No more samples. Once the hold has run out the clock settles it, and the
  // heartbeat that was held back follows, stating the wait.
  const out = arm.tick(t0 + 2200);
  assert.deepEqual(out.map((e) => [Date.parse(e.at) - t0, e.mission_state]), [[100, "waiting"], [2200, "waiting"]]);
  const [beat] = arm.tick(t0 + 3300);
  assert.equal(beat.mission_state, "waiting", "heartbeats carry on from the settled state");
  // A link that drops mid-pause: the pause was work up to the drop.
  const b = createArm({ id: "b" }, { heartbeatMs: 60_000, holdMs: 2000 });
  b.feed(s(t0, true));
  b.feed(s(t0 + 100, false));
  assert.deepEqual(b.down(t0 + 600, "ECONNRESET").map((e) => e.connection_state), ["offline"]);
});

test("heartbeats between changes, and an offline event that is not downtime", () => {
  const arm = createArm({ id: "l1", cycleRegister: 24, program: "op10" }, { heartbeatMs: 15_000 });
  const t0 = 1_790_000_000_000;
  const s = { at: t0, robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [0.5, 0, 0, 0, 0, 0], output_int_register_24: 4 };
  assert.equal(arm.feed(s).length, 1);
  assert.equal(arm.feed({ ...s, at: t0 + 100 }).length, 0, "nothing changed");
  assert.equal(arm.tick(t0 + 10_000).length, 0);
  const [beat] = arm.tick(t0 + 15_000);
  assert.equal(beat.at, new Date(t0 + 15_000).toISOString());
  const [cycle] = arm.feed({ ...s, at: t0 + 16_000, output_int_register_24: 5 });
  assert.equal(cycle.cycle_count, 5);
  assert.equal(cycle.program, "op10");
  const [off] = arm.down(t0 + 20_000, "ECONNRESET");
  assert.equal(off.connection_state, "offline");
  assert.equal(off.errors, undefined, "a dropped link is not the arm's downtime");
  assert.equal(arm.down(t0 + 21_000, "again").length, 0, "reported once");
  assert.equal(arm.tick(t0 + 60_000).length, 0, "no heartbeat while offline");
});

// ---- sending ----

test("the sender batches, holds through outages in order, and treats 400 and 401 differently", async () => {
  const calls = [];
  let mode = "down";
  const post = async (url, key, body) => {
    calls.push(body.events.length);
    if (mode === "down") throw new Error("ENETUNREACH");
    if (mode === "401") return { status: 401, body: { error: "bad key" } };
    if (mode === "400") return { status: 400, body: { error: "nope" } };
    return { status: 200, body: { accepted: body.events.length, rejected: [{ index: 0, problems: ["missing robot_id"] }] } };
  };
  const logs = [];
  assert.throws(() => createSender({ url: "https://x", key: "nope", post }), /blk_/);
  const s = createSender({ url: "https://x", key: "blk_test", post, log: (m) => logs.push(m), flushMs: 1e9, retryMs: [1e9] });
  try {
    s.enqueue(Array.from({ length: 1500 }, (_, i) => ({ robot_id: "a", n: i })));
    await sleep(10);
    assert.equal(s.queued, 1500, "nothing lost while the link is down");
    mode = "up";
    await s.flush();
    await sleep(10);
    assert.deepEqual(calls.slice(-2), [1000, 500], "drained in batches of the server's limit");
    assert.equal(s.queued, 0);
    assert.equal(s.stats.rejected, 2);
    mode = "400";
    s.enqueue([{ robot_id: "a" }]);
    await s.flush();
    assert.equal(s.queued, 0, "a refused batch is dropped, not retried forever");
    mode = "401";
    s.enqueue([{ robot_id: "a" }]);
    await s.flush();
    await s.flush();
    assert.equal(s.queued, 1, "a bad key holds everything");
    assert.match(logs.join("\n"), /refused the API key/);
  } finally {
    s.stop();
  }
});

test("a change is sent at once and a heartbeat waits for the batch, so a stop reaches Botlien within seconds", async () => {
  const posts = [];
  const post = async (url, key, body) => {
    posts.push(body.events.map((e) => e.kind));
    return { status: 200, body: { accepted: body.events.length, rejected: [] } };
  };
  const s = createSender({ url: "https://x", key: "blk_test", post, flushMs: 1e9 });
  try {
    s.enqueue([{ robot_id: "a", kind: "beat" }]);
    await sleep(10);
    assert.equal(posts.length, 0, "a heartbeat waits for the next batch");
    s.enqueue([{ robot_id: "a", kind: "stop" }], { now: true });
    await sleep(10);
    assert.deepEqual(posts, [["beat", "stop"]], "the change goes now, with what was waiting, in order");
  } finally {
    s.stop();
  }

  // Only the arm's own heartbeats are marked as heartbeats; a protective stop is a change.
  const arm = createArm({ id: "l1" }, { heartbeatMs: 15_000 });
  const t0 = 1_790_000_000_000;
  const run = { at: t0, robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [0.5, 0, 0, 0, 0, 0] };
  const [first] = arm.feed(run);
  assert.equal(isHeartbeat(first), false);
  const [beat] = arm.tick(t0 + 15_000);
  assert.equal(isHeartbeat(beat), true);
  const [stop] = arm.feed({ ...run, at: t0 + 16_000, safety_mode: 3, runtime_state: 3, actual_qd: [0, 0, 0, 0, 0, 0] });
  assert.equal(stop.stuck, true);
  assert.equal(isHeartbeat(stop), false, "a stop is sent at once, with no hold");
});

// ---- end to end ----

test("a simulated CNC cell reaches Botlien as a priced arm with cycles and a working share", async () => {
  const store = openStore(":memory:");
  store.setKV("owner.business_type", "manufacturing");
  // Move 0.5 s of every 2 s cycle (25%), one protective stop after 2 cycles.
  const sim = await startFakeUrsim({ port: 0, cell: simulateCell({ cycleSeconds: 2, moveSeconds: 0.5, stopEvery: 2, stopSeconds: 1.5 }) });
  const sender = createSender({
    url: "https://app.botlien.test",
    key: "blk_test",
    post: async (url, key, body) => ({ status: 200, body: pushEvents(store, body, Date.now()) }),
    flushMs: 500,
    log: () => {},
  });
  const config = loadConfig(JSON.stringify({ botlien: "https://app.botlien.test", frequency: 50, heartbeatSeconds: 1, holdSeconds: 0.3, arms: [{ id: "loader-1", host: "127.0.0.1", port: sim.port, name: "Loader 1", model: "UR10e", cycleRegister: 24, program: "op10" }] }));
  const gw = runGateway(config, { sender, log: () => {} });
  try {
    await sleep(7000);
  } finally {
    await gw.stop();
    await sim.close();
  }
  const [robot] = store.listRobots();
  assert.equal(robot.display_name, "Loader 1");
  assert.equal(robot.model, "UR10e");
  assert.equal(robot.category, "machine_tending", "the business's main work, not tray delivery");
  const rows = store.rollupsBetweenAll(0, Date.now() + 3_600_000);
  const active = rows.reduce((a, r) => a + r.active_ms, 0);
  const online = rows.reduce((a, r) => a + r.online_ms, 0);
  const share = active / online;
  // Each 5.5 s block: two cycles of 0.5 s motion and a 1.5 s protective
  // stop, so about 1 s of work in 5.5 s (18%). The mill wait, the hold and
  // the stop must not count as work.
  assert.ok(share > 0.1 && share < 0.3, `working share ${share}`);
  assert.ok(rows.reduce((a, r) => a + r.mission_count, 0) >= 2, "cycles counted from the register");
  assert.ok(rows.reduce((a, r) => a + r.stuck_episodes, 0) >= 1, "the protective stop is downtime");
  const c = fleetContract(store, Date.now());
  assert.equal(c.robots[0].cost.armLabel, "UR10e");
  assert.equal(c.robots[0].cost.perHourCents, 437);
});

test("--record hands every event to the recorder exactly as it is queued for Botlien", async () => {
  const sim = await startFakeUrsim({ port: 0, cell: simulateCell({ cycleSeconds: 2, moveSeconds: 0.5 }) });
  const queued = [], recorded = [];
  const sender = { enqueue: (ev) => queued.push(...ev), flush: async () => {}, stop() {}, stats: { sent: 0, rejected: 0, dropped: 0 }, queued: 0 };
  const gw = runGateway(loadConfig(JSON.stringify({ botlien: "https://x", heartbeatSeconds: 1, arms: [{ id: "a", host: "127.0.0.1", port: sim.port, cycleRegister: 24 }] })), { sender, record: (ev) => recorded.push(...ev), log: () => {}, connect: (o) => connectRtde({ ...o, frequency: 20 }) });
  try {
    await sleep(2600);
    assert.ok(queued.length >= 2, `queued ${queued.length}`);
    assert.deepEqual(recorded, queued, "the recording is the queue, event for event");
    assert.equal(recorded[0].robot_id, "a");
  } finally {
    await gw.stop();
    await sim.close();
  }
});

test("a cycle register that restarts with the program still gives a count that only climbs", () => {
  const arm = createArm({ id: "a", cycleRegister: 25 }, { heartbeatMs: 1000, holdMs: 2000 });
  const base = { robot_mode: 7, safety_mode: 1, runtime_state: 2, actual_qd: [0.5, 0, 0, 0, 0, 0], actual_current: [1, 1, 1, 1, 1, 1], joint_temperatures: [30, 30, 30, 30, 30, 30], speed_scaling: 1 };
  const sent = [];
  let t = 1_000_000;
  for (const reg of [0, 1, 2, 5, 5, 0, 1, 3]) sent.push(...arm.feed({ ...base, output_int_register_25: reg, at: (t += 1000) }));
  // The restart itself (5 then 0) changes nothing Botlien counts, so no event; the next cycle reads 6.
  assert.deepEqual(sent.map((e) => e.cycle_count), [0, 1, 2, 5, 6, 8], "after the restart the count carries on from 5");
  assert.deepEqual(sent.map((e) => e.ur.cycle_register), [0, 1, 2, 5, 1, 3], "the raw register rides along");
});
