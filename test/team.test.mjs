import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControl } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { startBoard, readBody } from "../src/board.mjs";
import { TEAM_UI_HTML_PATH } from "../src/app.mjs";

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = Date.parse("2026-10-07T15:00:00Z");

test("the Team page is served at /team, live on the API, and /app sends robot-arm shops there", async () => {
  assert.ok(existsSync(TEAM_UI_HTML_PATH), "team-ui/mvp/build_mvp.py writes it");
  const dir = mkdtempSync(join(tmpdir(), "botlien-team-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => T0, baseUrl: "http://127.0.0.1", readBody, demoEmails: "demo@botlien.com" });
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
  const hosted = (html) => {
    const m = html.match(/window\.__BOTLIEN_HOSTED=(\{.*?\});/);
    return m ? { ...JSON.parse(m[1]), onb: /window\.__ONB=true/.test(html), api: /window\.__BOTLIEN_API="\/api\/v1"/.test(html) } : null;
  };
  try {
    const demo = await signIn("demo@botlien.com");
    tenants.get(control.accountByEmail("demo@botlien.com").id).setKV("owner.business_type", "manufacturing");
    assert.equal((await fetch(`${base}/app`, { headers: { Cookie: demo }, redirect: "manual" })).headers.get("location"), "/team");
    const html = await page("/team", demo);
    assert.match(html, /<title>Botlien Team<\/title>/);
    assert.deepEqual(hosted(html), { onboarding: "account", dollars: true, demo: true, onb: true, api: true }, "the owner opens on first run, live on the API");
    assert.match(await page("/app?page=mfg", demo), /Manufacturing/, "the dashboard pane loads for the demo account");

    const b = sent.length;
    await fetch(`${base}/api/v1/members`, { method: "POST", headers: { Cookie: demo }, body: JSON.stringify({ email: "dana@demo.io", role: "technician" }) });
    const dana = await redeem(sent.slice(b).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1]);
    assert.deepEqual(hosted(await page("/team", dana)), { onboarding: "account", dollars: false, demo: false, onb: false, api: true }, "a technician waits for the owner, sees no dollars and cannot rewind");
    assert.doesNotMatch(await page("/app?page=mfg", dana), /<title>Botlien · Manufacturing/);

    const customer = await signIn("sam@linelab.io");
    await fetch(`${base}/api/v1/setup/business`, { method: "POST", headers: { Cookie: customer, "Content-Type": "application/json" }, body: JSON.stringify({ business: "restaurant" }) });
    assert.equal((await fetch(`${base}/app`, { headers: { Cookie: customer }, redirect: "manual" })).status, 200, "a customer in another business keeps the usual page");
    assert.equal((await fetch(`${base}/team`, { redirect: "manual" })).status, 303, "the Team page needs a session");

    // The Team page's own requests: "since=0" before it has a cursor, and "what" for a fix.
    assert.equal((await fetch(`${base}/api/v1/stops?since=0`, { headers: { Cookie: demo } })).status, 200);
    const feed = await (await fetch(`${base}/api/v1/stops`, { headers: { Cookie: demo } })).json();
    assert.ok("epoch" in feed, "the feed says which replay it belongs to");
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
    tenants.closeAll();
    control.close();
  }
});
