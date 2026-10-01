#!/usr/bin/env node
// Botlien UR gateway: reads Universal Robots arms on the local network over
// RTDE (read-only, port 30004) and sends their status to Botlien.
//
//   BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json
//
// The key comes from Settings > Data sources > Make an API key, and only ever
// from the environment, so it is never written into a config file someone
// might share. gateway.json lists the arms (see config.example.json).
//
// Runs on any small box on the shop network with Node 18 or newer and no
// other dependencies. It opens no port of its own; every connection goes out.
import { readFileSync } from "node:fs";
import { connectRtde, DEFAULT_FIELDS, RTDE_PORT, FORBIDDEN_PORTS } from "./rtde.mjs";
import { createArm } from "./arm.mjs";
import { createSender } from "./sender.mjs";

export function loadConfig(text) {
  const c = JSON.parse(text);
  const problems = [];
  if (!c.botlien || !/^https?:\/\//.test(c.botlien)) problems.push('"botlien" must be the Botlien address, like https://app.botlien.com');
  if (!Array.isArray(c.arms) || !c.arms.length) problems.push('"arms" must list at least one arm');
  const ids = new Set();
  for (const [i, a] of (c.arms ?? []).entries()) {
    if (!a.id) problems.push(`arm ${i + 1} needs an "id" (what Botlien calls it, stable forever)`);
    if (!a.host) problems.push(`arm ${i + 1} needs a "host" (its IP on the shop network)`);
    if (a.port !== undefined && (FORBIDDEN_PORTS.includes(Number(a.port)) || !(Number(a.port) > 1023))) problems.push(`arm ${a.id ?? i + 1}: port ${a.port} is not allowed. Leave it out for RTDE (${RTDE_PORT}); 29999 and 30001-30003 can command the arm`);
    if (a.cycleRegister !== undefined && a.cycleRegister !== null && !(Number.isInteger(a.cycleRegister) && a.cycleRegister >= 0 && a.cycleRegister <= 47)) problems.push(`arm ${a.id ?? i + 1}: "cycleRegister" must be an output integer register, 0 to 47`);
    if (ids.has(a.id)) problems.push(`two arms share the id ${a.id}`);
    ids.add(a.id);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { heartbeatSeconds: 15, frequency: 10, holdSeconds: 2, ...c };
}

/** Wires every arm to the sender. Returns stop(). */
export function runGateway(config, { key, connect = connectRtde, sender = null, log = console.log, now = Date.now } = {}) {
  const out = sender ?? createSender({ url: config.botlien, key, log });
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
    stream.on("sample", (s) => out.enqueue(arm.feed(s)));
    stream.on("down", (reason) => {
      if (up !== false) log(up ? `${a.id}: lost ${a.host} (${reason}); reconnecting until it answers` : `${a.id}: cannot reach ${a.host} (${reason}); retrying until it answers`);
      up = false;
      out.enqueue(arm.down(now(), reason));
    });
    return { arm, stream };
  });
  const beat = setInterval(() => {
    const t = now();
    for (const { arm } of arms) out.enqueue(arm.tick(t));
  }, 1000);
  log(`Botlien UR gateway: ${arms.length} arm${arms.length === 1 ? "" : "s"}, read-only RTDE, sending to ${config.botlien}`);
  return {
    sender: out,
    async stop() {
      clearInterval(beat);
      for (const { stream } of arms) stream.stop();
      await out.flush();
      out.stop();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json");
    process.exit(2);
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
    gw = runGateway(config, { key: process.env.BOTLIEN_API_KEY });
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
