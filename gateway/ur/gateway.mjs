#!/usr/bin/env node
// Botlien gateway: reads Universal Robots arms on the local network over
// RTDE (read-only, port 30004) and MiR mobile robots over MiR's REST API
// (GET only), and sends their status to Botlien.
//
//   BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json
//
// The key comes from Settings > Data sources > Make an API key, and only ever
// from the environment, so it is never written into a config file someone
// might share. gateway.json lists the arms and the MiRs (see
// config.example.json). A MiR's login comes from BOTLIEN_MIR_AUTH
// ("user:password", the same environment-only rule).
//
// Runs on any small box on the shop network with Node 18 or newer and no
// other dependencies. It opens no port of its own; every connection goes out.
import { readFileSync, openSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { connectRtde, DEFAULT_FIELDS, RTDE_PORT, FORBIDDEN_PORTS } from "./rtde.mjs";
import { createArm, isHeartbeat } from "./arm.mjs";
import { createSender } from "./sender.mjs";
import { createMir, isMirHeartbeat, mirAuthHeader, pollMir } from "./mir.mjs";

export function loadConfig(text) {
  const c = JSON.parse(text);
  const problems = [];
  if (!c.botlien || !/^https?:\/\//.test(c.botlien)) problems.push('"botlien" must be the Botlien address, like https://app.botlien.com');
  c.arms ??= [];
  c.mir ??= [];
  if (!Array.isArray(c.arms) || !Array.isArray(c.mir) || !(c.arms.length + c.mir.length)) problems.push('"arms" or "mir" must list at least one robot');
  const ids = new Set();
  for (const [i, m] of (Array.isArray(c.mir) ? c.mir : []).entries()) {
    if (!m.id) problems.push(`MiR ${i + 1} needs an "id" (what Botlien calls it, stable forever${m.fleet ? "; for a Fleet server it prefixes each robot's id" : ""})`);
    if (!m.host) problems.push(`MiR ${m.id ?? i + 1} needs a "host" (its IP on the shop network${m.fleet ? ", here the MiR Fleet server's" : ""})`);
    if (ids.has(m.id)) problems.push(`two robots share the id ${m.id}`);
    ids.add(m.id);
  }
  for (const [i, a] of (c.arms ?? []).entries()) {
    if (!a.id) problems.push(`arm ${i + 1} needs an "id" (what Botlien calls it, stable forever)`);
    if (!a.host) problems.push(`arm ${i + 1} needs a "host" (its IP on the shop network)`);
    if (a.port !== undefined && (FORBIDDEN_PORTS.includes(Number(a.port)) || !(Number(a.port) > 1023))) problems.push(`arm ${a.id ?? i + 1}: port ${a.port} is not allowed. Leave it out for RTDE (${RTDE_PORT}); 29999 and 30001-30003 can command the arm`);
    if (a.cycleRegister !== undefined && a.cycleRegister !== null && !(Number.isInteger(a.cycleRegister) && a.cycleRegister >= 0 && a.cycleRegister <= 47)) problems.push(`arm ${a.id ?? i + 1}: "cycleRegister" must be an output integer register, 0 to 47`);
    if (ids.has(a.id)) problems.push(`two robots share the id ${a.id}`);
    ids.add(a.id);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { heartbeatSeconds: 15, frequency: 10, holdSeconds: 2, mirPollSeconds: 1, mirHoldSeconds: 10, ...c };
}

/** Wires every arm to the sender. Returns stop(). `record`, when given, is
 *  handed every event as it is queued: exactly what Botlien receives, for a
 *  JSONL log that scripts/benchmark-replay.mjs can play back. */
export function runGateway(config, { key, connect = connectRtde, sender = null, log = console.log, now = Date.now, record = null, mirAuth = process.env.BOTLIEN_MIR_AUTH, mirFetch = globalThis.fetch } = {}) {
  const out = sender ?? createSender({ url: config.botlien, key, log });
  // A change goes out at once; a heartbeat waits for the next batch.
  const send = (events) => {
    if (record && events.length) record(events);
    out.enqueue(events, { now: events.some((e) => !isHeartbeat(e) && !isMirHeartbeat(e)) });
  };
  const arms = config.arms.map((a) => {
    const arm = createArm({ ...a, cycleRegister: a.cycleRegister ?? null }, { heartbeatMs: config.heartbeatSeconds * 1000, holdMs: config.holdSeconds * 1000 });
    const fields = a.cycleRegister != null ? [...DEFAULT_FIELDS, `output_int_register_${a.cycleRegister}`] : DEFAULT_FIELDS;
    const stream = connect({ host: a.host, port: a.port ?? RTDE_PORT, fields, frequency: config.frequency });
    // Said once per outage, not on every reconnect attempt.
    let up = null;
    stream.on("connected", ({ version }) => {
      up = true;
      log(`${a.id}: connected to ${a.host}, controller ${version}`);
    });
    stream.on("message", (m) => log(`${a.id}: ${m}`));
    stream.on("sample", (s) => send(arm.feed(s)));
    stream.on("down", (reason) => {
      if (up !== false) log(up ? `${a.id}: lost ${a.host} (${reason}); reconnecting until it answers` : `${a.id}: cannot reach ${a.host} (${reason}); retrying until it answers`);
      up = false;
      send(arm.down(now(), reason));
    });
    return { arm, stream };
  });
  // MiRs: one poller per robot, or per Fleet server for all of its robots.
  const auth = config.mir.length && mirAuth ? mirAuthHeader(mirAuth) : null;
  if (config.mir.length && !auth) log("No BOTLIEN_MIR_AUTH set; MiRs that ask for a login will be refused until it is.");
  const mirs = new Map(); // robot id -> tracker
  const pollers = config.mir.map((m) => {
    const opts = { heartbeatMs: config.heartbeatSeconds * 1000, holdMs: config.mirHoldSeconds * 1000 };
    const trackerFor = (key, name) => {
      const id = key === null ? m.id : `${m.id}-${key}`;
      if (!mirs.has(id)) mirs.set(id, createMir({ ...m, id, name: key === null ? m.name : name ?? `${m.name ?? "MiR"} ${key}` }, opts));
      return mirs.get(id);
    };
    const names = new Map();
    return pollMir({
      host: m.host,
      port: m.port ?? null,
      fleet: !!m.fleet,
      auth,
      intervalMs: config.mirPollSeconds * 1000,
      fetch: mirFetch,
      log,
      now,
      onRobots: (list) => list.forEach((r) => names.set(r.id, r.name)),
      onStatus: (key, st, at) => send(trackerFor(key, names.get(key) ?? st?.robot_name).feed(st, at)),
      onDown: (key, reason, at) => {
        const id = key === null ? m.id : `${m.id}-${key}`;
        if (mirs.has(id)) send(mirs.get(id).down(at, reason));
      },
    });
  });
  const beat = setInterval(() => {
    const t = now();
    for (const { arm } of arms) send(arm.tick(t));
    for (const mir of mirs.values()) send(mir.tick(t));
  }, 1000);
  const parts = [];
  if (arms.length) parts.push(`${arms.length} arm${arms.length === 1 ? "" : "s"} (read-only RTDE)`);
  if (config.mir.length) parts.push(`${config.mir.length} MiR source${config.mir.length === 1 ? "" : "s"} (GET only)`);
  log(`Botlien gateway: ${parts.join(", ")}, sending to ${config.botlien}`);
  return {
    sender: out,
    async stop() {
      clearInterval(beat);
      for (const { stream } of arms) stream.stop();
      for (const p of pollers) p.stop();
      await out.flush();
      out.stop();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path || path.startsWith("--")) {
    console.error("usage: BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json [--record run.jsonl]");
    process.exit(2);
  }
  // --record run.jsonl: append every event sent, one JSON object per line.
  // That file is what a benchmark run hands back (see docs/ops/ursim-handoff.md).
  const ri = process.argv.indexOf("--record");
  let record = null;
  if (ri > 0) {
    const recordPath = process.argv[ri + 1];
    if (!recordPath) {
      console.error("--record needs a file name");
      process.exit(2);
    }
    const fd = openSync(recordPath, "a");
    record = (events) => {
      for (const e of events) writeSync(fd, JSON.stringify(e) + "\n");
    };
    console.log(`recording every event to ${recordPath}`);
  }
  let config;
  try {
    config = loadConfig(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`${path}: ${err.message}`);
    process.exit(2);
  }
  let gw;
  try {
    gw = runGateway(config, { key: process.env.BOTLIEN_API_KEY, record });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const quit = async () => {
    await gw.stop();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  setInterval(() => {
    const s = gw.sender.stats;
    console.log(`sent ${s.sent}, rejected ${s.rejected}, dropped ${s.dropped}, waiting ${gw.sender.queued}`);
  }, 10 * 60_000);
}
