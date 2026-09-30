// Universal Robots RTDE (Real-Time Data Exchange), read side only.
//
// RTDE is the controller's own streaming interface on TCP 30004, protocol
// version 2 (CB3 3.4+ and every e-Series). A client asks for an "output
// recipe" (a list of named fields and a rate) and the controller then streams
// one data package per tick. This client only ever sets up OUTPUTS. It never
// sends SETUP_INPUTS, so it has no way to write a register, move a joint or
// change a setting. That is the whole read-only guarantee, and it is
// structural: the message types that could write are not in this file.
//
// Ports the gateway must never touch (Overnight Line Benchmark v1.1, sec. 6):
// 29999 (dashboard server: load, play, stop, power off) and 30001-30003
// (primary/secondary: accept URScript). connectRtde() refuses anything but
// 30004.
//
// Wire format: every packet is uint16 size (whole packet, header included),
// uint8 type, then the payload. All numbers are big-endian.
import { Socket } from "node:net";
import { EventEmitter } from "node:events";

export const RTDE_PORT = 30004;
export const FORBIDDEN_PORTS = [29999, 30001, 30002, 30003];

export const TYPE = {
  REQUEST_PROTOCOL_VERSION: 86, // 'V'
  GET_URCONTROL_VERSION: 118, // 'v'
  TEXT_MESSAGE: 77, // 'M'
  DATA_PACKAGE: 85, // 'U'
  SETUP_OUTPUTS: 79, // 'O'
  SETUP_INPUTS: 73, // 'I' (never sent by this client; listed so a test can say so)
  START: 83, // 'S'
  PAUSE: 80, // 'P'
};

// Byte size and reader for each RTDE data type.
const TYPES = {
  BOOL: [1, (b, o) => b.readUInt8(o) !== 0],
  UINT8: [1, (b, o) => b.readUInt8(o)],
  UINT32: [4, (b, o) => b.readUInt32BE(o)],
  UINT64: [8, (b, o) => Number(b.readBigUInt64BE(o))],
  INT32: [4, (b, o) => b.readInt32BE(o)],
  DOUBLE: [8, (b, o) => b.readDoubleBE(o)],
  VECTOR3D: [24, (b, o) => [0, 1, 2].map((i) => b.readDoubleBE(o + i * 8))],
  VECTOR6D: [48, (b, o) => [0, 1, 2, 3, 4, 5].map((i) => b.readDoubleBE(o + i * 8))],
  VECTOR6INT32: [24, (b, o) => [0, 1, 2, 3, 4, 5].map((i) => b.readInt32BE(o + i * 4))],
  VECTOR6UINT32: [24, (b, o) => [0, 1, 2, 3, 4, 5].map((i) => b.readUInt32BE(o + i * 4))],
};

// What the gateway reads by default. All exist on CB3 3.4+ and e-Series.
export const DEFAULT_FIELDS = [
  "timestamp", // controller uptime, seconds
  "robot_mode", // -1..8, 7 = running
  "safety_mode", // 1 normal, 3 protective stop, 5 safeguard stop, 6/7 e-stop, 8/9 violation/fault
  "runtime_state", // 1 stopped, 2 playing, 4 paused
  "speed_scaling", // what the controller is actually applying, 0..1
  "target_speed_fraction", // the speed slider, 0..1
  "actual_qd", // joint speeds, rad/s
  "actual_current", // joint motor currents, A
  "joint_temperatures", // deg C
];

/** One packet: size, type, payload. */
export function packet(type, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(3);
  head.writeUInt16BE(payload.length + 3, 0);
  head.writeUInt8(type, 2);
  return Buffer.concat([head, payload]);
}

/** Splits a byte stream into whole packets; keeps the partial tail. */
export function createFramer(onPacket) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 3) {
      const size = buf.readUInt16BE(0);
      if (size < 3) throw new Error(`RTDE packet with impossible size ${size}`);
      if (buf.length < size) break;
      onPacket(buf.readUInt8(2), buf.subarray(3, size));
      buf = buf.subarray(size);
    }
  };
}

export function setupOutputsPayload(fields, frequency) {
  const f = Buffer.alloc(8);
  f.writeDoubleBE(frequency, 0);
  return Buffer.concat([f, Buffer.from(fields.join(","), "ascii")]);
}

/** The controller's answer to SETUP_OUTPUTS: recipe id and one type per field. */
export function parseSetupReply(payload) {
  return { recipeId: payload.readUInt8(0), types: payload.subarray(1).toString("ascii").split(",") };
}

/** A data package's values, by field name, per the recipe's types. */
export function decodeData(payload, fields, types) {
  const out = {};
  let o = 1; // byte 0 is the recipe id
  for (let i = 0; i < fields.length; i++) {
    const t = TYPES[types[i]];
    if (!t) throw new Error(`RTDE type ${types[i]} for ${fields[i]} is not one this client reads`);
    out[fields[i]] = t[1](payload, o);
    o += t[0];
  }
  return out;
}

/** Encoder for the same types, used by the fake controller in tests. */
export function encodeData(recipeId, values, types) {
  const parts = [Buffer.from([recipeId])];
  values.forEach((v, i) => {
    const [size] = TYPES[types[i]];
    const b = Buffer.alloc(size);
    switch (types[i]) {
      case "BOOL": case "UINT8": b.writeUInt8(Number(v)); break;
      case "UINT32": b.writeUInt32BE(v); break;
      case "UINT64": b.writeBigUInt64BE(BigInt(v)); break;
      case "INT32": b.writeInt32BE(v); break;
      case "DOUBLE": b.writeDoubleBE(v); break;
      case "VECTOR3D": case "VECTOR6D": v.forEach((x, k) => b.writeDoubleBE(x, k * 8)); break;
      case "VECTOR6INT32": v.forEach((x, k) => b.writeInt32BE(x, k * 4)); break;
      case "VECTOR6UINT32": v.forEach((x, k) => b.writeUInt32BE(x, k * 4)); break;
    }
    parts.push(b);
  });
  return Buffer.concat(parts);
}

/**
 * One arm's RTDE stream. Emits:
 *   'connected' { version }        after the handshake and START
 *   'sample'    { at, ...fields }  once per data package
 *   'message'   text               a controller text message
 *   'down'      reason             the socket closed or the handshake failed
 * Reconnects on its own with backoff until stop().
 */
export function connectRtde({ host, port = RTDE_PORT, fields = DEFAULT_FIELDS, frequency = 10, now = Date.now, retryMs = [1000, 2000, 5000, 10000, 30000] }) {
  // Another port is allowed only for a simulator or a port forward; the
  // controller's writable interfaces are refused outright.
  if (FORBIDDEN_PORTS.includes(Number(port)) || !(Number(port) > 1023)) {
    throw new Error(`Port ${port} is not allowed. The gateway reads RTDE on ${RTDE_PORT} and never connects to 29999 or 30001-30003.`);
  }
  const ev = new EventEmitter();
  let sock = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;

  function open() {
    let want = fields.slice();
    let types = null;
    let version = null;
    let stage = "version";
    let triedTrim = false;
    sock = new Socket();
    sock.setNoDelay(true);
    sock.setTimeout(15_000); // a live stream is never quiet this long
    const send = (type, payload) => sock.write(packet(type, payload));
    const fail = (reason) => {
      stage = "failed"; // so the close that follows does not report twice
      if (sock) sock.destroy();
      ev.emit("down", reason);
    };
    const framer = createFramer((type, payload) => {
      if (type === TYPE.TEXT_MESSAGE) {
        // v2: len, message, len, source, level
        const n = payload.readUInt8(0);
        ev.emit("message", payload.subarray(1, 1 + n).toString("utf8"));
        return;
      }
      if (stage === "version" && type === TYPE.REQUEST_PROTOCOL_VERSION) {
        if (!payload.readUInt8(0)) return fail("controller refused RTDE protocol 2 (firmware older than CB3 3.4?)");
        stage = "urversion";
        send(TYPE.GET_URCONTROL_VERSION);
      } else if (stage === "urversion" && type === TYPE.GET_URCONTROL_VERSION) {
        version = [0, 4, 8, 12].map((o) => payload.readUInt32BE(o)).join(".");
        stage = "setup";
        send(TYPE.SETUP_OUTPUTS, setupOutputsPayload(want, frequency));
      } else if (stage === "setup" && type === TYPE.SETUP_OUTPUTS) {
        const r = parseSetupReply(payload);
        const missing = want.filter((_, i) => r.types[i] === "NOT_FOUND");
        if (missing.length && !triedTrim) {
          // Older firmware lacks a field: drop it and ask once more.
          triedTrim = true;
          ev.emit("message", `not on this controller, skipped: ${missing.join(", ")}`);
          want = want.filter((f) => !missing.includes(f));
          send(TYPE.SETUP_OUTPUTS, setupOutputsPayload(want, frequency));
          return;
        }
        if (r.types.some((t) => t === "NOT_FOUND" || t === "IN_USE" || !TYPES[t])) return fail(`output recipe refused: ${r.types.join(",")}`);
        types = r.types;
        stage = "start";
        send(TYPE.START);
      } else if (stage === "start" && type === TYPE.START) {
        if (!payload.readUInt8(0)) return fail("controller refused START");
        stage = "streaming";
        attempt = 0;
        ev.emit("connected", { version, fields: want });
      } else if (stage === "streaming" && type === TYPE.DATA_PACKAGE) {
        ev.emit("sample", { at: now(), ...decodeData(payload, want, types) });
      }
    });
    sock.on("data", (chunk) => {
      try {
        framer(chunk);
      } catch (err) {
        fail(String(err.message ?? err));
      }
    });
    sock.on("timeout", () => fail("no data for 15 s"));
    sock.on("error", (err) => fail(err.code ?? err.message));
    sock.on("close", () => {
      sock = null;
      if (stage === "streaming") ev.emit("down", "connection closed");
      if (!stopped) {
        const wait = retryMs[Math.min(attempt++, retryMs.length - 1)];
        timer = setTimeout(open, wait);
      }
    });
    sock.connect(Number(port), host, () => {
      const v = Buffer.alloc(2);
      v.writeUInt16BE(2, 0);
      send(TYPE.REQUEST_PROTOCOL_VERSION, v);
    });
  }

  open();
  ev.stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (sock) {
      try {
        sock.write(packet(TYPE.PAUSE));
      } catch {
        /* closing anyway */
      }
      sock.destroy();
    }
  };
  return ev;
}
