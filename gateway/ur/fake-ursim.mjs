#!/usr/bin/env node
// A stand-in for a UR controller's RTDE server, for testing the gateway on a
// laptop with no robot and no URSim. It speaks the real RTDE v2 handshake
// and streams a simulated CNC tending cell:
//
//   move for moveSeconds (joints turning, current up), then wait on the mill
//   for the rest of cycleSeconds (program still playing, arm still), then
//   bump output_int_register_24; every stopEvery cycles, a protective stop
//   for stopSeconds.
//
//   node gateway/ur/fake-ursim.mjs --port 30004 --cycle 40 --move 10
//
// It is not URSim: no kinematics, no safety system. The real check is the
// gateway against URSim or a real arm (Line Lab), which this does not replace.
import { createServer } from "node:net";
import { TYPE, packet, createFramer, encodeData } from "./rtde.mjs";

// Fields this controller knows, with their RTDE types.
const KNOWN = {
  timestamp: "DOUBLE",
  robot_mode: "INT32",
  safety_mode: "INT32",
  runtime_state: "UINT32",
  speed_scaling: "DOUBLE",
  target_speed_fraction: "DOUBLE",
  actual_qd: "VECTOR6D",
  actual_current: "VECTOR6D",
  joint_temperatures: "VECTOR6D",
  output_int_register_24: "INT32",
};

export function simulateCell({ cycleSeconds = 40, moveSeconds = 10, stopEvery = 0, stopSeconds = 60, speed = 1 } = {}) {
  const start = Date.now();
  return (nowMs = Date.now()) => {
    const t = (nowMs - start) / 1000;
    // Time is laid out as cycles, with a stop inserted after every stopEvery-th.
    const block = stopEvery ? stopEvery * cycleSeconds + stopSeconds : Infinity;
    const inBlock = stopEvery ? t % block : t;
    const blocksDone = stopEvery ? Math.floor(t / block) : 0;
    const stopped = stopEvery && inBlock >= stopEvery * cycleSeconds;
    const cyclesInBlock = stopped ? stopEvery : Math.floor(inBlock / cycleSeconds);
    const phase = stopped ? 0 : inBlock % cycleSeconds;
    const moving = !stopped && phase < moveSeconds;
    const w = moving ? 0.6 * speed : 0;
    return {
      timestamp: t,
      robot_mode: 7,
      safety_mode: stopped ? 3 : 1,
      runtime_state: stopped ? 4 : 2,
      speed_scaling: speed,
      target_speed_fraction: speed,
      actual_qd: [w, -w, w * 0.5, 0, w * 0.2, 0],
      actual_current: moving ? [1.8, 2.6, 1.4, 0.5, 0.4, 0.3] : [0.4, 1.1, 0.6, 0.1, 0.1, 0.05],
      joint_temperatures: [31, 33, 32, 29, 29, 28].map((x) => x + Math.min(8, t / 600)),
      output_int_register_24: blocksDone * stopEvery + cyclesInBlock,
    };
  };
}

export function startFakeUrsim({ port = 30004, host = "127.0.0.1", cell = simulateCell(), log = () => {} } = {}) {
  const sockets = new Set();
  const server = createServer((sock) => {
    sockets.add(sock);
    let recipe = null;
    let timer = null;
    const send = (type, payload) => sock.write(packet(type, payload));
    const reply8 = (type, v) => send(type, Buffer.from([v]));
    const framer = createFramer((type, payload) => {
      if (type === TYPE.REQUEST_PROTOCOL_VERSION) return reply8(type, payload.readUInt16BE(0) === 2 ? 1 : 0);
      if (type === TYPE.GET_URCONTROL_VERSION) {
        const b = Buffer.alloc(16);
        [5, 15, 0, 0].forEach((v, i) => b.writeUInt32BE(v, i * 4));
        return send(type, b);
      }
      if (type === TYPE.SETUP_OUTPUTS) {
        const hz = payload.readDoubleBE(0);
        const names = payload.subarray(8).toString("ascii").split(",");
        const types = names.map((n) => KNOWN[n] ?? "NOT_FOUND");
        recipe = types.includes("NOT_FOUND") ? null : { id: 1, names, types, hz };
        return send(type, Buffer.concat([Buffer.from([recipe ? 1 : 0]), Buffer.from(types.join(","), "ascii")]));
      }
      if (type === TYPE.SETUP_INPUTS) {
        log("a client asked to set up INPUTS");
        return send(type, Buffer.concat([Buffer.from([0]), Buffer.from("IN_USE", "ascii")]));
      }
      if (type === TYPE.START) {
        if (!recipe) return reply8(type, 0);
        reply8(type, 1);
        clearInterval(timer);
        timer = setInterval(() => {
          const s = cell();
          sock.write(packet(TYPE.DATA_PACKAGE, encodeData(recipe.id, recipe.names.map((n) => s[n]), recipe.types)));
        }, 1000 / recipe.hz);
        return;
      }
      if (type === TYPE.PAUSE) {
        clearInterval(timer);
        return reply8(type, 1);
      }
      log(`unexpected packet type ${type}`);
    });
    sock.on("data", (d) => {
      try {
        framer(d);
      } catch {
        sock.destroy();
      }
    });
    sock.on("close", () => {
      clearInterval(timer);
      sockets.delete(sock);
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(port, host, () =>
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => {
          for (const s of sockets) s.destroy();
          server.close(r);
        }),
      })
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, d) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? Number(process.argv[i + 1]) : d;
  };
  const port = arg("port", 30004);
  startFakeUrsim({
    port,
    cell: simulateCell({ cycleSeconds: arg("cycle", 40), moveSeconds: arg("move", 10), stopEvery: arg("stop-every", 5), stopSeconds: arg("stop-seconds", 60), speed: arg("speed", 1) }),
    log: console.log,
  }).then(() => console.log(`fake UR controller (RTDE) on 127.0.0.1:${port}`));
}
