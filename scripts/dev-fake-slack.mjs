#!/usr/bin/env node
// A stand-in for Slack's Web API on 127.0.0.1:3298, for trying the stop
// alerts on a laptop. It accepts auth.test, chat.postMessage and chat.update
// and prints what a channel would show. Point the server at it with
// BOTLIEN_SLACK_BASE=http://127.0.0.1:3298.
//
//   node scripts/dev-fake-slack.mjs                      the fake
//   node scripts/dev-fake-slack.mjs --press claim 1:3    press a button on
//                                                       account 1, incident 3
// The press is signed with BOTLIEN_SLACK_SIGNING_SECRET (default "dev") and
// posted to BOTLIEN_BASE_URL (default http://127.0.0.1:3240).
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const PORT = Number(process.env.FAKE_SLACK_PORT ?? 3298);
const args = process.argv.slice(2);

if (args[0] === "--press") {
  const [, actionId, value] = args;
  if (!actionId || !value) {
    console.error("usage: --press <claim|escalate> <account>:<incident>");
    process.exit(2);
  }
  const secret = process.env.BOTLIEN_SLACK_SIGNING_SECRET ?? "dev";
  const base = process.env.BOTLIEN_BASE_URL ?? "http://127.0.0.1:3240";
  const body = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", user: { id: "U0DEV", username: "dev" }, channel: { id: "C0FAKE" }, message: { ts: "1.1" }, actions: [{ action_id: actionId, value }] }) }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const res = await fetch(`${base}/api/slack/interactions`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, body });
  console.log(res.status, await res.text());
  process.exit(0);
}

let n = 0;
const messages = new Map(); // ts -> text
const server = createServer(async (req, res) => {
  const method = (req.url ?? "/").split("/").pop();
  let body = "";
  for await (const chunk of req) body += chunk;
  let payload = {};
  try {
    payload = JSON.parse(body || "{}");
  } catch {}
  const reply = (o) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(o));
  };
  const stamp = new Date().toISOString().slice(11, 19);
  if (method === "auth.test") {
    console.log(`${stamp} auth.test ok (${(req.headers.authorization ?? "").slice(0, 16)}…)`);
    return reply({ ok: true, team: "Fake Slack", user_id: "UFAKEBOT" });
  }
  if (method === "chat.postMessage") {
    const ts = `1.${++n}`;
    messages.set(ts, payload.text);
    const where = payload.thread_ts ? `  ↳ in thread ${payload.thread_ts}${payload.reply_broadcast ? " (also in channel)" : ""}` : `#${payload.channel} [${ts}]`;
    console.log(`${stamp} POST ${where}\n    ${payload.text}`);
    return reply({ ok: true, ts, channel: "C0FAKE" });
  }
  if (method === "chat.update") {
    messages.set(payload.ts, payload.text);
    console.log(`${stamp} EDIT [${payload.ts}]\n    ${payload.text}${payload.blocks?.some((b) => b.type === "actions") ? "\n    [buttons]" : ""}`);
    return reply({ ok: true });
  }
  console.log(`${stamp} ${method}: not faked`);
  reply({ ok: false, error: "unknown_method" });
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake Slack on http://127.0.0.1:${PORT}  (BOTLIEN_SLACK_BASE=http://127.0.0.1:${PORT})`));
