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
import { createVault } from "../src/vault.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { KV_BILLING_DAY } from "../src/contract.mjs";
import { saveSlackSettings, publicSlackSettings, slackToken, verifySlackSignature, signSlackRequest, parseInteraction, incidentBlocks, SlackError, KV_SLACK } from "../src/slack.mjs";
import { createSlackAlertsJob } from "../src/slack-job.mjs";
import { ESCALATE_AFTER_MS } from "../src/incidents.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);
const T0 = at("2026-10-01T21:14:00Z"); // 2:14 pm Pacific
const vault = createVault({ keyB64: Buffer.alloc(32, 7).toString("base64") });
const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

/** A stand-in for Slack's Web API that remembers every call. */
function fakeSlack({ tokenOk = true } = {}) {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    const method = url.split("/").pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload, auth: init.headers.Authorization });
    const body = method === "auth.test"
      ? tokenOk ? { ok: true, team: "Line Lab", user_id: "UBOT" } : { ok: false, error: "invalid_auth" }
      : method === "chat.postMessage" ? { ok: true, ts: `1712.${++n}`, channel: "C0ALERTS" } : { ok: true };
    return { status: 200, json: async () => body };
  };
  return { calls, fetchImpl, of: (m) => calls.filter((c) => c.method === m) };
}

// ---- settings ----

test("connecting Slack checks the token, seals it, and shows everything but the token", async () => {
  const s = openStore(":memory:");
  const slack = fakeSlack();
  await assert.rejects(saveSlackSettings(s, vault, { botToken: "xoxp-not-a-bot-token-tests-only", channel: "x" }, T0, { fetchImpl: slack.fetchImpl }), /bot token/);
  await assert.rejects(saveSlackSettings(s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: " " }, T0, { fetchImpl: slack.fetchImpl }), /channel/);
  await assert.rejects(saveSlackSettings(s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: "alerts", lead: "dana" }, T0, { fetchImpl: slack.fetchImpl }), /member ID/);
  await assert.rejects(saveSlackSettings(s, { ready: false }, { botToken: "xoxb-not-a-real-token-tests-only", channel: "alerts" }, T0, { fetchImpl: slack.fetchImpl }), SlackError);
  assert.equal(slack.calls.length, 0, "nothing reaches Slack until the fields are right");
  assert.equal(publicSlackSettings(s), null);

  const bad = fakeSlack({ tokenOk: false });
  await assert.rejects(saveSlackSettings(s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: "alerts" }, T0, { fetchImpl: bad.fetchImpl }), /invalid_auth/);
  assert.equal(publicSlackSettings(s), null, "a refused token is not saved");

  const out = await saveSlackSettings(s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: "#botlien-alerts-test", lead: "<@U0LEAD01>", manager: "U0BOSS01" }, T0, { fetchImpl: slack.fetchImpl });
  assert.deepEqual(out, { channel: "botlien-alerts-test", lead: "U0LEAD01", manager: "U0BOSS01", dollars: true, team: "Line Lab", botUserId: "UBOT", connectedAt: T0 });
  assert.equal(slack.calls[0].auth, "Bearer xoxb-not-a-real-token-tests-only");
  assert.ok(!s.getKV(KV_SLACK).includes("xoxb-"), "the token is sealed, not stored in the clear");
  assert.equal(slackToken(s, vault), "xoxb-not-a-real-token-tests-only");
  assert.equal(slackToken(s, { ready: false }), null);
});

// ---- Slack's signature and what a button press looks like ----

test("a request is only Slack's when the signature matches and it is fresh", () => {
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
  const timestamp = String(Math.floor(T0 / 1000));
  const signature = signSlackRequest({ signingSecret: SECRET, timestamp, body });
  assert.equal(verifySlackSignature({ signingSecret: SECRET, timestamp, signature, body, nowMs: T0 }), true);
  assert.equal(verifySlackSignature({ signingSecret: SECRET, timestamp, signature, body: body + "x", nowMs: T0 }), false);
  assert.equal(verifySlackSignature({ signingSecret: "other", timestamp, signature, body, nowMs: T0 }), false);
  assert.equal(verifySlackSignature({ signingSecret: SECRET, timestamp, signature, body, nowMs: T0 + 6 * MIN }), false, "older than five minutes is a replay");
  assert.equal(verifySlackSignature({ signingSecret: SECRET, timestamp, signature: "v0=short", body, nowMs: T0 }), false);
  assert.equal(verifySlackSignature({ signingSecret: null, timestamp, signature, body, nowMs: T0 }), false);
});

test("a button press is read from the form-encoded payload", () => {
  const payload = { type: "block_actions", user: { id: "U0DANA", username: "dana" }, channel: { id: "C0ALERTS" }, message: { ts: "1712.1" }, actions: [{ action_id: "claim", value: "3:7" }] };
  const i = parseInteraction(new URLSearchParams({ payload: JSON.stringify(payload) }).toString());
  assert.deepEqual(i, { type: "block_actions", actionId: "claim", value: "3:7", user: { id: "U0DANA", name: "dana" }, channel: "C0ALERTS", ts: "1712.1" });
  assert.equal(parseInteraction("payload=notjson"), null);
  assert.equal(parseInteraction(""), null);
});

test("the message has buttons only while the stop is open and unclaimed", () => {
  const v = { headline: "Cell 2 hit a protective stop at 2:14 pm", cause: "Protective stop", downLine: "Down 3 min so far", outputLine: null, costLine: "$0.22 in robot time (estimated, from list prices)", repeatsLine: null, claimLine: "Not claimed yet. It escalates in 7 min", open: true, claimed: false, escalated: 0 };
  const blocks = incidentBlocks(v, "3:7");
  assert.deepEqual(blocks.map((b) => b.type), ["header", "section", "context", "actions"]);
  assert.deepEqual(blocks[3].elements.map((e) => [e.action_id, e.value]), [["claim", "3:7"], ["escalate", "3:7"]]);
  assert.equal(blocks[3].elements[1].text.text, "Escalate to the lead");
  assert.equal(incidentBlocks({ ...v, escalated: 1 }, "3:7")[3].elements[1].text.text, "Escalate to the manager");
  assert.equal(incidentBlocks({ ...v, escalated: 2 }, "3:7")[3].elements.length, 1, "past the manager there is nobody left to escalate to");
  assert.deepEqual(incidentBlocks({ ...v, claimed: true, claimLine: "Claimed by <@U0DANA> at 2:20 pm" }, "3:7").map((b) => b.type), ["header", "section", "context"]);
  assert.deepEqual(incidentBlocks({ ...v, open: false, claimLine: null }, "3:7").map((b) => b.type), ["header", "section"]);
  assert.ok(incidentBlocks({ ...v, open: false }, "3:7")[0].text.text.startsWith("🟢"));
});

// ---- the job, end to end against the fake ----

/** A manufacturing account with one UR10e loader that has worked two weeks
 *  and a day, so its pace baseline is in. */
function lineLab() {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "1");
  s.setKV("owner.tz", TZ);
  setBusinessType(s, "manufacturing");
  const id = s.upsertRobot({ connector: "push", externalId: "cell-2", displayName: "Cell 2 UR10e", brand: "Universal Robots", model: "UR10e", category: "machine_tending" }, T0 - 15 * 86_400_000);
  const push = (t, o = {}) => s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: true, stuck: false, ...o });
  for (let t = T0 - 15 * 86_400_000; t < T0; t += 2 * MIN) push(t, { missionId: `cycle::${Math.floor((t - T0) / (2 * MIN))}` });
  rebuildRollupsForRobot(s, id);
  s.setKV(KV_CONFIRMED, "1");
  return { s, id, push };
}

async function connected({ send = true, signingSecret = SECRET } = {}) {
  const lab = lineLab();
  const slack = fakeSlack();
  const control = openControl(":memory:");
  const { account } = control.upsertAccount("dana@linelab.io", T0 - 86_400_000);
  await saveSlackSettings(lab.s, vault, { botToken: "xoxb-not-a-real-token-tests-only", channel: "botlien-alerts-test", lead: "U0LEAD01", manager: "U0BOSS01" }, T0 - 86_400_000, { fetchImpl: slack.fetchImpl });
  slack.calls.length = 0;
  const logs = [];
  const job = createSlackAlertsJob({ control, tenants: { get: () => lab.s }, vault, fetchImpl: slack.fetchImpl, send, signingSecret, log: (l) => logs.push(l) });
  return { ...lab, slack, control, account, job, logs };
}

const press = (actionId, value, user = { id: "U0DANA", username: "dana" }) =>
  new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", user, channel: { id: "C0ALERTS" }, message: { ts: "1712.1" }, actions: [{ action_id: actionId, value }] }) }).toString();
const signed = (body, nowMs, secret = SECRET) => {
  const timestamp = String(Math.floor(nowMs / 1000));
  return { headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signSlackRequest({ signingSecret: secret, timestamp, body }) }, body };
};

test("a stop is posted once, escalated in the thread after ten minutes, claimed from the button, and turned green when the robot is back", async () => {
  const c = await connected();
  assert.deepEqual(await c.job.tick(T0 - MIN), [], "a working robot posts nothing");

  c.push(T0, { stuck: true, moving: false, errors: [{ code: "UR-SAFETY-3", severity: "WARNING", description: "protective stop" }] });
  const r1 = await c.job.tick(T0 + 30_000);
  assert.deepEqual(r1, [{ accountId: c.account.id, incident: 1, change: "opened", escalated: undefined }]);
  assert.equal(c.slack.of("chat.postMessage").length, 1);
  const post = c.slack.of("chat.postMessage")[0].payload;
  assert.equal(post.channel, "botlien-alerts-test");
  assert.match(post.text, /^Cell 2 UR10e hit a protective stop at 2:14 pm\. Protective stop \(UR-SAFETY-3\)\. Down 1 min so far\. About \d+ [a-z ]+ not made \(its usual pace is \d+ an hour\)\. \$0\.07 in robot time \(estimated, from list prices\)\. Not claimed yet\. <@U0LEAD01> gets it in 10 min$/);
  assert.equal(post.blocks.at(-1).elements[0].value, `${c.account.id}:1`);
  const inc = c.s.incident(1);
  assert.deepEqual([inc.channel, inc.message_ts, inc.notified_at], ["C0ALERTS", "1712.1", T0 + 30_000]);

  // Still down a minute later: nothing new goes out, the message is not even touched yet.
  c.push(T0 + MIN, { stuck: true, moving: false });
  await c.job.tick(T0 + MIN + 30_000);
  assert.equal(c.slack.calls.length, 1);

  // Five minutes on, the message is refreshed in place, with the same buttons.
  c.push(T0 + 5 * MIN, { stuck: true, moving: false });
  await c.job.tick(T0 + 5 * MIN + 30_000);
  assert.equal(c.slack.of("chat.update").length, 1);
  assert.deepEqual([c.slack.of("chat.update")[0].payload.channel, c.slack.of("chat.update")[0].payload.ts], ["C0ALERTS", "1712.1"]);
  assert.match(c.slack.of("chat.update")[0].payload.text, /Down 6 min so far/);

  // Ten minutes unclaimed: the lead is told in the thread, shown in the channel.
  c.push(T0 + 10 * MIN, { stuck: true, moving: false });
  const r2 = await c.job.tick(T0 + 30_000 + ESCALATE_AFTER_MS);
  assert.equal(r2[0].escalated, 1);
  const thread = c.slack.of("chat.postMessage")[1].payload;
  assert.deepEqual([thread.channel, thread.thread_ts, thread.reply_broadcast, thread.text], ["C0ALERTS", "1712.1", true, "<@U0LEAD01> nobody has claimed this in 10 minutes."]);
  assert.match(c.slack.of("chat.update").at(-1).payload.text, /<@U0LEAD01> was told at 2:24 pm; <@U0BOSS01> is next in 10 min/);
  assert.equal(c.slack.of("chat.update").at(-1).payload.blocks.at(-1).elements[1].text.text, "Escalate to the manager");

  // Dana presses the button. The record and the message say so; the clock stops.
  const before = c.slack.calls.length;
  const out = await c.job.handleInteraction(signed(press("claim", `${c.account.id}:1`), T0 + 12 * MIN), T0 + 12 * MIN);
  assert.deepEqual(out, { code: 200, body: {} });
  assert.deepEqual([c.s.incident(1).claimed_by, c.s.incident(1).claimed_at], ["<@U0DANA>", T0 + 12 * MIN]);
  assert.equal(c.slack.calls.length, before + 1);
  const claimedMsg = c.slack.of("chat.update").at(-1).payload;
  assert.match(claimedMsg.text, /Claimed by <@U0DANA> at 2:26 pm$/);
  assert.equal(claimedMsg.blocks.some((b) => b.type === "actions"), false, "no buttons once claimed");
  c.push(T0 + 20 * MIN, { stuck: true, moving: false });
  const r3 = await c.job.tick(T0 + 30_000 + 2 * ESCALATE_AFTER_MS);
  assert.equal(r3[0].escalated, undefined, "a claimed stop never reaches the manager");
  assert.equal(c.slack.of("chat.postMessage").length, 2);

  // Back at 2:40. The same message turns green and says how long it was.
  c.push(T0 + 26 * MIN);
  const r4 = await c.job.tick(T0 + 26 * MIN + 30_000);
  assert.deepEqual(r4, [{ accountId: c.account.id, incident: 1, change: "closed" }]);
  const done = c.slack.of("chat.update").at(-1).payload;
  assert.equal(done.ts, "1712.1");
  assert.match(done.text, /^Cell 2 UR10e is back after 26 min\. Protective stop \(UR-SAFETY-3\)\. Was down 26 min, back at 2:40 pm\./);
  assert.match(done.text, /Claimed by <@U0DANA>$/);
  assert.ok(done.blocks[0].text.text.startsWith("🟢"));
  assert.equal(done.blocks.some((b) => b.type === "actions"), false);
  assert.deepEqual(await c.job.tick(T0 + 27 * MIN), [], "and then it is quiet");
  assert.match(c.logs.join("\n"), /escalated to the lead/);
  assert.match(c.logs.join("\n"), /claimed by <@U0DANA>/);
});

test("a stop that comes right back is the same message, and the Escalate button goes straight to the lead", async () => {
  const c = await connected();
  c.push(T0, { stuck: true, moving: false });
  await c.job.tick(T0 + 30_000);
  c.push(T0 + 2 * MIN);
  await c.job.tick(T0 + 2 * MIN + 30_000);
  assert.match(c.slack.of("chat.update").at(-1).payload.text, /is back after 2 min/);
  c.push(T0 + 4 * MIN, { stuck: true, moving: false });
  const r = await c.job.tick(T0 + 4 * MIN + 30_000);
  assert.equal(r[0].change, "reopened");
  assert.equal(c.slack.of("chat.postMessage").length, 1, "no second alert");
  const again = c.slack.of("chat.update").at(-1).payload;
  assert.equal(again.ts, "1712.1");
  assert.match(again.text, /2nd stop in a row, each within 10 minutes of the last/);
  assert.ok(again.blocks[0].text.text.startsWith("🔴"));

  await c.job.handleInteraction(signed(press("escalate", `${c.account.id}:1`), T0 + 5 * MIN), T0 + 5 * MIN);
  assert.deepEqual([c.s.incident(1).escalated, c.s.incident(1).escalated_at], [1, T0 + 5 * MIN]);
  assert.equal(c.slack.of("chat.postMessage").at(-1).payload.text, "<@U0LEAD01> <@U0DANA> escalated this to you.");
  assert.match(c.slack.of("chat.update").at(-1).payload.text, /<@U0LEAD01> was told at 2:19 pm/);
});

test("a press that is not Slack's, or for a stop that is not open, changes nothing", async () => {
  const c = await connected();
  c.push(T0, { stuck: true, moving: false });
  await c.job.tick(T0 + 30_000);
  const n = c.slack.calls.length;
  assert.equal((await c.job.handleInteraction(signed(press("claim", `${c.account.id}:1`), T0 + MIN, "wrong-secret"), T0 + MIN)).code, 401);
  assert.equal((await c.job.handleInteraction(signed(press("claim", `${c.account.id}:1`), T0 - 10 * MIN), T0 + MIN)).code, 401, "stale");
  assert.equal((await c.job.handleInteraction(signed(press("claim", "9:1"), T0 + MIN), T0 + MIN)).code, 200, "an unknown account is ignored quietly");
  assert.equal((await c.job.handleInteraction(signed(press("claim", `${c.account.id}:42`), T0 + MIN), T0 + MIN)).code, 200);
  assert.equal((await c.job.handleInteraction(signed("payload=%7B%22type%22%3A%22view_submission%22%7D", T0 + MIN), T0 + MIN)).code, 200);
  assert.equal(c.s.incident(1).claimed_at, null);
  assert.equal(c.slack.calls.length, n);
  const off = createSlackAlertsJob({ control: c.control, tenants: { get: () => c.s }, vault, fetchImpl: c.slack.fetchImpl, send: true, signingSecret: null });
  assert.equal((await off.handleInteraction(signed(press("claim", `${c.account.id}:1`), T0 + MIN), T0 + MIN)).code, 503);
});

test("with sending off the alert is logged once and Slack is never called", async () => {
  const c = await connected({ send: false });
  c.push(T0, { stuck: true, moving: false });
  await c.job.tick(T0 + 30_000);
  c.push(T0 + MIN, { stuck: true, moving: false });
  await c.job.tick(T0 + 30_000 + ESCALATE_AFTER_MS);
  assert.equal(c.slack.calls.length, 0);
  assert.equal(c.logs.filter((l) => l.includes("not sent")).length, 2, "the alert and the escalation, each once");
  assert.equal(c.s.incident(1).message_ts, null);
  assert.equal(c.s.incident(1).escalated, 1);
});

test("a Slack that is down is logged and tried again next tick, and the stop is not lost", async () => {
  const c = await connected();
  let down = true;
  const job = createSlackAlertsJob({ control: c.control, tenants: { get: () => c.s }, vault, send: true, signingSecret: SECRET, log: (l) => c.logs.push(l),
    fetchImpl: async (url, init) => (down ? Promise.reject(new Error("ECONNRESET")) : c.slack.fetchImpl(url, init)) });
  c.push(T0, { stuck: true, moving: false });
  await job.tick(T0 + 30_000);
  assert.match(c.logs.at(-1), /slack post failed: ECONNRESET/);
  assert.equal(c.s.incident(1).notified_at, null);
  down = false;
  c.push(T0 + MIN, { stuck: true, moving: false });
  await job.tick(T0 + MIN + 30_000);
  assert.equal(c.s.incident(1).message_ts, "1712.1");
});

// ---- over HTTP ----

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "botlien-slack-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const slack = fakeSlack();
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, vault, now: () => T0, baseUrl: "http://127.0.0.1", readBody, fetchImpl: slack.fetchImpl });
  const job = createSlackAlertsJob({ control, tenants, vault, fetchImpl: slack.fetchImpl, send: true, signingSecret: SECRET });
  tenancy.ctx.slackInteraction = (r) => job.handleInteraction(r, T0);
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function signIn(email) {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    const token = sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1];
    const red = await fetch(`${base}/signin/${token}`, { redirect: "manual" });
    return red.headers.get("set-cookie").split(";")[0];
  }
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" });
  return {
    base, api, signIn, slack, job, control, tenants,
    async close() {
      server.close();
      await new Promise((r) => server.once("close", r));
      tenants.closeAll();
      control.close();
    },
  };
}

test("the owner connects Slack from the app, and a signed button press comes in without a session", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@linelab.io");
    assert.equal((await app.api("/api/v1/slack")).status, 303, "settings need a session");
    assert.deepEqual(await (await app.api("/api/v1/slack", cookie)).json(), { slack: null, incidents: [] });
    const bad = await app.api("/api/v1/slack", cookie, { method: "POST", body: JSON.stringify({ botToken: "nope", channel: "alerts" }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /bot token/);
    const ok = await app.api("/api/v1/slack", cookie, { method: "POST", body: JSON.stringify({ botToken: "xoxb-not-a-real-token-tests-only", channel: "#botlien-alerts-test", lead: "U0LEAD01" }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).slack.channel, "botlien-alerts-test");
    const shown = await (await app.api("/api/v1/slack", cookie)).json();
    assert.equal(shown.slack.team, "Line Lab");
    assert.equal("sealed" in shown.slack, false);

    // A stop on this account, then Dana's press arrives from Slack with no cookie at all.
    const account = app.control.accountByEmail("dana@linelab.io");
    const store = app.tenants.get(account.id);
    const id = store.upsertRobot({ connector: "push", externalId: "cell-2", displayName: "Cell 2", model: "UR10e", category: "machine_tending" }, T0 - MIN);
    store.insertSnapshot({ robotId: id, at: T0 - MIN, receivedAt: T0 - MIN, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: false, stuck: true });
    await app.job.tick(T0);
    assert.equal(store.incident(1).message_ts, "1712.1");
    const body = press("claim", `${account.id}:1`);
    const ts = String(Math.floor(T0 / 1000));
    const headers = { "Content-Type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": signSlackRequest({ signingSecret: SECRET, timestamp: ts, body }) };
    const pressed = await fetch(`${app.base}/api/slack/interactions`, { method: "POST", headers, body });
    assert.equal(pressed.status, 200);
    assert.equal(store.incident(1).claimed_by, "<@U0DANA>");
    const forged = await fetch(`${app.base}/api/slack/interactions`, { method: "POST", headers: { ...headers, "x-slack-signature": "v0=0000" }, body });
    assert.equal(forged.status, 401);
    assert.equal((await fetch(`${app.base}/api/slack/interactions`)).status, 405);
    const listed = await (await app.api("/api/v1/slack", cookie)).json();
    assert.deepEqual([listed.incidents.length, listed.incidents[0].claimedBy, listed.incidents[0].status], [1, "<@U0DANA>", "open"]);

    // Another account sees none of it, and disconnecting clears the token.
    const other = await app.signIn("sam@harborgrill.com");
    assert.deepEqual(await (await app.api("/api/v1/slack", other)).json(), { slack: null, incidents: [] });
    const gone = await app.api("/api/v1/slack", cookie, { method: "DELETE" });
    assert.equal((await gone.json()).slack, null);
  } finally {
    await app.close();
  }
});
