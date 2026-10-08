import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { startBoard, readBody } from "../src/board.mjs";
import { createAgentApi } from "../src/agent-api.mjs";
import { escalateStops } from "../src/stops.mjs";
import { rewind, advance } from "../src/replay.mjs";
import { APP_TEAM_HTML_PATH } from "../src/app.mjs";

const Mara = createRequire(import.meta.url)("../prototype/src/mara.cjs");
const SEC = 1000;
const MIN = 60 * SEC;
const T0 = Date.parse("2026-10-07T15:00:00Z");

/** The stop story played to its end, and the agents' API on it. */
function story() {
  const s = openStore(":memory:");
  rewind(s, {}, T0);
  for (let t = T0; t <= T0 + 41 * MIN; t += SEC) {
    advance(s, t);
    if ((t - T0) % (30 * SEC) === 0) escalateStops(s, t);
  }
  const nowMs = T0 + 41 * MIN;
  const agent = createAgentApi({ store: s, now: () => nowMs });
  // What the page's fetch would get for each path Mara plans.
  const get = (path) => {
    const u = new URL(path, "http://x");
    if (u.pathname === "/api/v1/agent/line") return agent.line();
    if (u.pathname === "/api/v1/agent/stops") return agent.stops(u.searchParams);
    if (u.pathname === "/api/v1/agent/costs") return agent.costs();
    const h = /robots\/(\d+)\/history/.exec(u.pathname);
    return agent.history(Number(h[1]), u.searchParams);
  };
  const robots = agent.line().robots;
  const ask = (q, role = "owner") => {
    const p = Mara.plan(q, { robots, nowMs });
    const data = Object.fromEntries(p.calls.map((c) => [c, get(c)]));
    return { p, a: Mara.answer(p, data, { tz: "America/Los_Angeles", role }), data };
  };
  return { s, ask, robots };
}

test("Mara finds the robot a question names, the longest name first", () => {
  const robots = [{ id: 1, name: "Loader 1" }, { id: 2, name: "Loader 2" }, { id: 3, name: "Deburr" }];
  assert.equal(Mara.findRobot("why did loader 2 stop", robots).id, 2);
  assert.equal(Mara.findRobot("how is Loader2 doing", robots).id, 2);
  assert.equal(Mara.findRobot("what about the deburr cell", robots).id, 3);
  assert.equal(Mara.findRobot("what is going on", robots), null);
});

test("Mara refuses to move a robot, and lists what she can answer when she cannot place a question", () => {
  const ctx = { robots: [{ id: 2, name: "Loader 2" }], nowMs: T0 };
  assert.equal(Mara.plan("stop loader 2 now", ctx).intent, "control");
  assert.equal(Mara.plan("restart the robot", ctx).intent, "control");
  assert.equal(Mara.plan("why did loader 2 stop", ctx).intent, "stops");
  const help = Mara.answer(Mara.plan("tell me a joke", ctx), {}, {});
  assert.deepEqual(help.chips, Mara.SUGGESTED);
  assert.match(Mara.answer({ intent: "control" }, {}, {}).html, /read only/);
});

test("every number Mara says is the agents' API's number", () => {
  const { ask } = story();
  const why = ask("Why did Loader 2 stop this week?");
  const st = why.data[why.p.calls[0]];
  assert.equal(why.p.intent, "stops");
  assert.match(why.a.html, new RegExp(`stopped ${st.totals.count} time`));
  assert.match(why.a.html, new RegExp(`${st.totals.minutes.value} min in all`));
  assert.match(why.a.html, /C153/);
  assert.equal(why.a.view, "incidents");

  const cost = ask("What did the stops cost?");
  const c = cost.data[cost.p.calls[0]];
  assert.match(cost.a.html, new RegExp(`\\$${(c.totals.cost.stopsCents.value / 100).toFixed(2).replace(".", "\\.")}`));
  assert.match(cost.a.html, /estimated from list prices/);
  assert.match(cost.a.html, /not lost parts/);

  const techCost = ask("What did the stops cost?", "technician");
  assert.doesNotMatch(techCost.a.html, /\$\d/);
  assert.match(techCost.a.html, /not shown for your role/);

  const least = ask("Which robot works the least?");
  const k = least.data["/api/v1/agent/costs"].robots.filter((r) => r.workingShare).sort((a, b) => a.workingShare.value - b.workingShare.value)[0];
  assert.match(least.a.html, new RegExp(`<b>${k.name}</b> works the least: ${k.workingShare.value}%`));

  const cause = ask("Was it the robot or the mill?");
  assert.equal(cause.p.intent, "cause");
  assert.match(cause.a.html, /not a diagnosis/);

  const count = ask("How many times has Loader 2 stopped this month?");
  assert.equal(count.p.intent, "count");
  assert.match(count.a.html, /1 stop for Loader 2 since October 1/);

  const now = ask("What is happening right now?");
  assert.match(now.a.html, /Loader 2<\/b> switched off/);
});

test("the stop watcher's one-line notice says what happened and who has it", () => {
  const s = { robot: { name: "Loader 2" }, open: true, kind: "stop", label: "protective stop", startedAt: T0, code: "C153", claimedBy: null, minutes: { value: 3 } };
  assert.match(Mara.stopNotice(s, "America/Los_Angeles"), /Loader 2 hit a protective stop at 8:00 am \(<code>C153<\/code>\)\./);
});

test("the team page is built, and served to operators and the demo account only", async () => {
  assert.ok(existsSync(APP_TEAM_HTML_PATH), "node prototype/src/build.cjs writes it");
  const dir = mkdtempSync(join(tmpdir(), "botlien-team-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => T0, baseUrl: "http://127.0.0.1", readBody, demoEmails: "demo@botlien.com", opsEmails: "ops@botlien.com" });
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redeem = async (token) => (await fetch(`${base}/signin/${token}`, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
  const signIn = async (email) => {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    return redeem(sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
  };
  const page = async (path, cookie) => (await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" })).text();
  const team = (html) => {
    const m = html.match(/window\.BOTLIEN_TEAM=(\{.*?\});/);
    return m ? JSON.parse(m[1]) : null;
  };
  try {
    const demo = await signIn("demo@botlien.com");
    tenants.get(control.accountByEmail("demo@botlien.com").id).setKV("owner.business_type", "manufacturing");
    const html = await page("/app?layout=team", demo);
    assert.match(html, /<title>Botlien · Team<\/title>/);
    assert.deepEqual(team(html), { replay: true, dashboard: true });
    assert.match(await page("/app?page=mfg", demo), /Manufacturing/, "the dashboard pane loads for the demo account");

    const b = sent.length;
    await fetch(`${base}/api/v1/members`, { method: "POST", headers: { Cookie: demo }, body: JSON.stringify({ email: "dana@demo.io", role: "technician" }) });
    const dana = await redeem(sent.slice(b).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
    assert.deepEqual(team(await page("/app?layout=team", dana)), { replay: false, dashboard: false }, "a technician gets the stops and Mara, not the dollar dashboard or the rewind");
    assert.doesNotMatch(await page("/app?page=mfg", dana), /<title>Botlien · Manufacturing/);

    const ops = await signIn("ops@botlien.com");
    assert.deepEqual(team(await page("/app?layout=team", ops)), { replay: false, dashboard: true });
    const customer = await signIn("sam@linelab.io");
    assert.equal(team(await page("/app?layout=team", customer)), null, "a customer still gets the usual page");

    const feed = await (await fetch(`${base}/api/v1/stops`, { headers: { Cookie: demo } })).json();
    assert.ok("epoch" in feed, "the feed says which replay it belongs to");
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
    tenants.closeAll();
    control.close();
  }
});
