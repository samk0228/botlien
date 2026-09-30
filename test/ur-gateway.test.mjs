import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { pushEvents } from "../src/push.mjs";
import { fleetContract } from "../src/contract.mjs";
import { packet, createFramer, encodeData, decodeData, connectRtde, TYPE, DEFAULT_FIELDS } from "../gateway/ur/rtde.mjs";
import { readSample, createArm } from "../gateway/ur/arm.mjs";
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
  assert.equal(out[0].robot_id, "l1");
  assert.equal(out[0].brand, "Universal Robots");
  assert.equal(out[0].category, "machine_tending");
  assert.equal(out[1].ur.samples, 30, "the window since the last event rides along");
  assert.equal(out[1].ur.current_mean.length, 6);
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
  // Each 5.5 s block: two cycles of 0.5 s motion (+0.3 s hold each) and a
  // 1.5 s protective stop, so about 1.6 s of work in 5.5 s (29%). The mill
  // wait and the stop must not count as work.
  assert.ok(share > 0.12 && share < 0.45, `working share ${share}`);
  assert.ok(rows.reduce((a, r) => a + r.mission_count, 0) >= 2, "cycles counted from the register");
  assert.ok(rows.reduce((a, r) => a + r.stuck_episodes, 0) >= 1, "the protective stop is downtime");
  const c = fleetContract(store, Date.now());
  assert.equal(c.robots[0].cost.armLabel, "UR10e");
  assert.equal(c.robots[0].cost.perHourCents, 437);
});
