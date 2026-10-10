#!/usr/bin/env node
// A pretend MiR for testing the gateway without one. It answers the parts of
// REST v2.0.0 the gateway reads (GET /status, and GET /robots and
// /robots/{id} as a Fleet server would) and plays a line-side delivery loop:
// drive to a cell, wait at it for the operator, drive back, sit Ready.
// Every --stop-every missions it sits in an emergency stop for up to --stop
// seconds of its rest.
//
// It is not MiR's software: no map, no planner, no safety system. The real
// check is the gateway against a MiR or MiR Fleet.
//
//   node gateway/ur/fake-mir.mjs --port 8080 [--fleet 3] [--drive 20] [--wait 15] [--rest 5] [--stop-every 3] [--stop 20]
//
// It expects BOTLIEN_MIR_AUTH's login, "distributor:distributor" by default.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** The status a robot following the loop reports `ms` after it started. */
export function fakeMirStatus(ms, { drive = 20, wait = 15, rest = 5, stopEvery = 0, stop = 20, name = "MiR250 1" } = {}) {
  const loop = (2 * drive + wait + rest + 0) * 1000;
  const n = Math.floor(ms / loop);
  // An e-stop replaces the rest of every stopEvery-th loop, after its drive back.
  const stopLoop = stopEvery > 0 && n % stopEvery === stopEvery - 1;
  const t = (ms % loop) / 1000;
  const mission = 1000 + n;
  let state = 5, v = 0.9, mq = mission, errors = [];
  if (t < drive) v = 0.9;
  else if (t < drive + wait) v = 0; // parked at the cell, mission waiting on the operator
  else if (t < 2 * drive + wait) v = 0.9;
  else {
    v = 0;
    mq = null;
    state = 3;
    if (stopLoop && t < 2 * drive + wait + Math.min(stop, rest)) {
      state = 10;
      errors = [{ code: 1100, module: "Safety system", description: "Emergency stop button pressed" }];
    }
  }
  return {
    robot_name: name,
    serial_number: "180200000000",
    robot_model: "MiR250",
    state_id: state,
    state_text: { 3: "Ready", 5: "Executing", 10: "EmergencyStop" }[state],
    mode_id: 7,
    mode_text: "Mission",
    battery_percentage: Math.max(20, 95 - ms / 60_000),
    position: { x: 10 + (t % 10), y: 4.5, orientation: 90 },
    velocity: { linear: v, angular: 0 },
    mission_queue_id: mq,
    mission_text: mq ? "Line-side delivery" : "Waiting for new missions...",
    errors,
  };
}

export function startFakeMir({ port = 8080, fleet = 0, login = "distributor:distributor", now = Date.now, ...loop } = {}) {
  const [user, pass] = [login.slice(0, login.indexOf(":")), login.slice(login.indexOf(":") + 1)];
  const want = `Basic ${Buffer.from(`${user}:${createHash("sha256").update(pass).digest("hex")}`).toString("base64")}`;
  const started = now();
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== want) return send(401, { error_human: "Unauthorized" });
    if (req.method !== "GET") return send(405, { error_human: "This fake only answers GET" });
    const ms = now() - started;
    const path = req.url.replace(/\?.*$/, "");
    if (!fleet && path === "/api/v2.0.0/status") return send(200, fakeMirStatus(ms, loop));
    if (fleet && path === "/api/v2.0.0/robots") return send(200, Array.from({ length: fleet }, (_, i) => ({ id: i + 1, name: `MiR250 ${i + 1}`, url: `/v2.0.0/robots/${i + 1}` })));
    const m = /^\/api\/v2\.0\.0\/robots\/(\d+)$/.exec(path);
    if (fleet && m && Number(m[1]) >= 1 && Number(m[1]) <= fleet) {
      const i = Number(m[1]);
      // Robots start 7 seconds apart so they are not in lockstep.
      return send(200, { id: i, fleet_state: 1, status: fakeMirStatus(ms + (i - 1) * 7000, { ...loop, name: `MiR250 ${i}` }) });
    }
    send(404, { error_human: "Not found" });
  });
  server.listen(port);
  return { server, requests };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? Number(process.argv[i + 1]) : d;
  };
  const port = arg("port", 8080);
  const fleet = arg("fleet", 0);
  startFakeMir({ port, fleet, login: process.env.BOTLIEN_MIR_AUTH || "distributor:distributor", drive: arg("drive", 20), wait: arg("wait", 15), rest: arg("rest", 5), stopEvery: arg("stop-every", 0), stop: arg("stop", 20) });
  console.log(`fake MiR${fleet ? ` Fleet with ${fleet} robots` : ""} on http://127.0.0.1:${port}/api/v2.0.0/`);
}
