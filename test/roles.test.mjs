import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { openControl, MemberError } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { startBoard, readBody } from "../src/board.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { fleetContract, KV_BILLING_DAY } from "../src/contract.mjs";
import { requestLink, redeemLink } from "../src/auth.mjs";
import { redactDollars, HIDDEN } from "../src/roles.mjs";
import { incidentView } from "../src/incidents.mjs";

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.parse("2026-10-07T21:14:00Z");

// What a cost block may keep: what the arm is, its working share, whether it is an estimate.
const NOT_MONEY = new Set(["arm", "armLabel", "workingPct", "hoursPerYear", "estimated"]);
const hasValue = (v) => (Array.isArray(v) ? v.some(hasValue) : v && typeof v === "object" ? Object.entries(v).some(([k, x]) => !NOT_MONEY.has(k) && hasValue(x)) : v !== null && v !== undefined);

/** Every key path and every string in a value, for "is there any money left". */
function leaks(value) {
  const found = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      // A money field may stay, as long as nothing in it has a value.
      if ((/cents/i.test(k) || ["cost", "coverage", "siteCoverage", "payback", "derivation", "inputs", "rateHistory", "contracts"].includes(k)) && hasValue(x)) found.push(`${p}.${k}`);
      walk(x, `${p}.${k}`);
    }
    else if (typeof v === "string" && /\$\s?\d/.test(v)) found.push(`${p} = ${v}`);
  };
  walk(value, "");
  return found;
}

/** A manufacturing shop with a UR10e that worked two weeks, a closed stop,
 *  and a stop impact on its line, so every dollar field the contract has is
 *  filled. */
function fillShop(s) {
  s.setKV(KV_BILLING_DAY, "1");
  s.setKV("owner.tz", "America/Los_Angeles");
  setBusinessType(s, "manufacturing");
  const id = s.upsertRobot({ connector: "push", externalId: "loader-2", displayName: "Loader 2", brand: "Universal Robots", model: "UR10e", category: "machine_tending" }, T0 - 20 * DAY);
  for (let t = T0 - 14 * DAY; t < T0 - DAY; t += 2 * MIN) s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "push", source: "live", connectionState: "online", missionState: "active", moving: true, stuck: false, missionId: `c::${t}` });
  rebuildRollupsForRobot(s, id);
  s.setKV(KV_CONFIRMED, "1");
  const inc = s.insertIncident({ robotId: id, kind: "stop", code: "C153", description: "protective stop", startedAt: T0 - 2 * DAY, lastSeenAt: T0 - 2 * DAY }, T0);
  s.updateIncident(inc, { status: "closed", endedAt: T0 - 2 * DAY + 12 * MIN }, T0);
  s.upsertLineEvent({ line: "Cell 1", kind: "stop", station: "Loader 2", robotId: id, startedAt: T0 - 2 * DAY, endedAt: T0 - 2 * DAY + 12 * MIN, idle: { [id]: 12 * MIN }, idleMinutes: 12, costCents: 87, status: "closed" }, T0);
  return id;
}

test("redaction takes every dollar figure out of the dashboard's contract and keeps the times and causes", () => {
  const s = openStore(":memory:");
  fillShop(s);
  const c = fleetContract(s, T0, {});
  assert.ok(leaks(c).length > 10, "the fixture really does carry dollars");
  const r = redactDollars(c);
  assert.deepEqual(leaks(r), []);
  assert.equal(r.robots[0].name, "Loader 2");
  assert.equal(r.robots[0].activeHours, c.robots[0].activeHours);
  assert.deepEqual([r.robots[0].cost.armLabel, r.robots[0].cost.workingPct], [c.robots[0].cost.armLabel, c.robots[0].cost.workingPct], "working share is time, not money");
  assert.equal(r.lineEvents[0].minutes, 12);
  assert.deepEqual(r.lineEvents[0].idle, c.lineEvents[0].idle);
  assert.equal(redactDollars({ note: "That stop cost $0.87" }).note, HIDDEN, "a dollar amount in words is caught too");
  assert.equal(redactDollars({ note: "Down 12 min" }).note, "Down 12 min");
});

test("members: one account per address, never an owner's, and a removed member's session ends", () => {
  const control = openControl(":memory:");
  const { account } = control.upsertAccount("sam@linelab.io", T0);
  control.upsertAccount("other@owner.io", T0);
  assert.throws(() => control.insertMember({ accountId: account.id, email: "other@owner.io", role: "technician" }, T0), MemberError);
  assert.throws(() => control.insertMember({ accountId: account.id, email: "dana@linelab.io", role: "owner" }, T0), /manager or technician/);
  const m = control.insertMember({ accountId: account.id, email: "Dana@LineLab.io", role: "technician", invitedBy: "sam@linelab.io" }, T0);
  assert.equal(m.email, "dana@linelab.io");
  assert.throws(() => control.insertMember({ accountId: account.id, email: "dana@linelab.io", role: "manager" }, T0), /already on/);

  const link = requestLink(control, "dana@linelab.io", T0);
  const out = redeemLink(control, link.token, T0);
  assert.equal(out.account.id, account.id, "Dana lands in Sam's account");
  assert.equal(control.accountByEmail("dana@linelab.io"), null, "and never gets one of her own");
  assert.deepEqual(control.sessionAccount(out.sessionToken, T0).viewer, { email: "dana@linelab.io", role: "technician" });
  control.setMemberRole(account.id, m.id, "manager");
  assert.equal(control.sessionAccount(out.sessionToken, T0).viewer.role, "manager", "a role change counts at once");
  control.removeMember(account.id, m.id);
  assert.equal(control.sessionAccount(out.sessionToken, T0), null);

  const own = redeemLink(control, requestLink(control, "sam@linelab.io", T0).token, T0);
  assert.deepEqual(control.sessionAccount(own.sessionToken, T0).viewer, { email: "sam@linelab.io", role: "owner" });
});

test("a session from before members existed reads as the owner's", () => {
  const control = openControl(":memory:");
  const { account } = control.upsertAccount("sam@linelab.io", T0);
  control.db.prepare(`INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES ('old', ?, ?, ?)`).run(account.id, T0, T0 + DAY);
  assert.deepEqual(control.sessionAccount("old", T0).viewer, { email: "sam@linelab.io", role: "owner" });
});

test("a Slack channel can be told to leave the dollar line out", () => {
  const inc = { id: 1, robot_id: 1, kind: "stop", code: "C153", description: "protective stop", started_at: T0 - 12 * MIN, ended_at: null, status: "open", repeats: 1, escalated: 0 };
  const contractRobot = { name: "Loader 2", cost: { perHourCents: 437, estimated: true } };
  assert.match(incidentView(inc, { robot: null, contractRobot, nowMs: T0 }).costLine, /\$0\.87 in robot time/);
  assert.equal(incidentView(inc, { robot: null, contractRobot, nowMs: T0, dollars: false }).costLine, null);
});

test("over HTTP: the owner invites a technician, who sees times and causes, no dollars, and changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "botlien-roles-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => T0, baseUrl: "http://127.0.0.1", readBody, opsEmails: "sam@linelab.io" });
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redeem = async (token) => (await fetch(`${base}/signin/${token}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  const signIn = async (email) => {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    return redeem(sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
  };
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual" });
  const json = async (path, cookie, init) => (await api(path, cookie, init)).json();
  try {
    const sam = await signIn("sam@linelab.io");
    const accountId = control.accountByEmail("sam@linelab.io").id;
    fillShop(tenants.get(accountId));
    assert.ok(leaks(await json("/api/v1/fleet", sam)).length > 10, "the owner sees the dollars");

    // Sam invites Dana; the invite email carries her link.
    const before = sent.length;
    const invited = await json("/api/v1/members", sam, { method: "POST", body: JSON.stringify({ email: "dana@linelab.io", role: "technician" }) });
    assert.deepEqual([invited.ok, invited.member.role, invited.emailed], [true, "technician", true]);
    const mail = sent.slice(before).join("\n");
    assert.match(mail, /sam@linelab\.io added you to Botlien/);
    const dana = await redeem(mail.match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);

    // Every way into the data, stripped.
    for (const path of ["/api/v1/fleet", "/api/v1/agent/stops?since=0", "/api/v1/agent/costs", "/api/v1/agent/line", "/api/v1/agent/robots/1/history?bucket=day", "/api/v1/slack", "/api/v1/setup"]) {
      const res = await api(path, dana);
      assert.equal(res.status, 200, path);
      assert.deepEqual(leaks(await res.json()), [], path);
    }
    const stopsSeen = await json("/api/v1/agent/stops?since=0", dana);
    assert.deepEqual([stopsSeen.stops[0].code, stopsSeen.stops[0].minutes.value, stopsSeen.stops[0].cost.stopCents.value], ["C153", 12, null]);
    // A robot-arm shop's technician gets the team page without the dollar
    // dashboard; it carries no account data, only who is looking.
    const page = await (await api("/app", dana)).text();
    assert.match(page, /<title>Botlien · Team<\/title>/);
    assert.match(page, /"dashboard":false/);
    assert.doesNotMatch(page, /BOTLIEN_LIVE/);

    // Looks, never touches.
    for (const [path, method, body] of [["/api/v1/inputs", "POST", "{}"], ["/api/v1/members", "POST", JSON.stringify({ email: "x@linelab.io", role: "manager" })], ["/api/v1/slack", "DELETE"], ["/api/v1/keys", "POST", "{}"]]) {
      assert.equal((await api(path, dana, { method, body })).status, 403, `${method} ${path}`);
    }
    assert.equal((await api("/owner", dana)).headers.get("location"), "/app", "the old statement pages are all dollars");
    assert.equal((await api("/api/state", dana)).status, 404, "an operator's technician is not an operator");
    assert.equal((await api("/api/state", sam)).status, 200);
    assert.equal((await json("/api/v1/members", dana)).members.length, 1, "Dana can see who is on the team");

    // Promoted to manager: dollars, at once. Removed: signed out.
    const id = invited.member.id;
    assert.equal((await api(`/api/v1/members/${id}`, dana, { method: "PATCH", body: JSON.stringify({ role: "manager" }) })).status, 403);
    await api(`/api/v1/members/${id}`, sam, { method: "PATCH", body: JSON.stringify({ role: "manager" }) });
    assert.ok(leaks(await json("/api/v1/fleet", dana)).length > 10);
    assert.equal((await api("/api/v1/members", dana, { method: "POST", body: JSON.stringify({ email: "x@linelab.io", role: "technician" }) })).status, 403, "only the owner manages the team");
    await api(`/api/v1/members/${id}`, sam, { method: "DELETE" });
    assert.equal((await api("/api/v1/fleet", dana)).status, 303);
    assert.equal((await json("/api/v1/fleet", sam)).people.length, 1);
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
    tenants.closeAll();
    control.close();
  }
});
