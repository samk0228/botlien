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
import { fleetContract } from "../src/contract.mjs";
import { importTelemetryFromText } from "../src/importer.mjs";
import { normalizePushEvent, pushEvents, bearerKey, hashApiKey, newApiKey } from "../src/push.mjs";
import { SESSION_COOKIE } from "../src/auth.mjs";

const NOW = Date.parse("2026-09-23T18:00:00Z");
const MIN = 60_000;

// ---- one event ----

test("a pushed event needs a robot id and a time, and nothing else", () => {
  const ok = normalizePushEvent({ robot_id: "AMR-7", at: "2026-09-23T14:05:00Z" });
  assert.equal(ok.event.externalId, "AMR-7");
  assert.equal(ok.event.at, Date.parse("2026-09-23T14:05:00Z"));
  assert.deepEqual(normalizePushEvent({ at: "2026-09-23T14:05:00Z" }).problems, ["missing robot_id"]);
  assert.deepEqual(normalizePushEvent({ robot_id: "x", at: "soon" }).problems, ["missing or unreadable at"]);
  assert.deepEqual(normalizePushEvent([1]).problems, ["event is not an object"]);
});

test("a pushed event is checked the way a vendor's status is", () => {
  const bad = normalizePushEvent({ robot_id: "x", at: Date.now() + 3_600_000, battery_pct: 140, connection_state: "sleeping" });
  assert.deepEqual(bad.problems, ["at is in the future", "battery_pct must be 0 to 100", "connection_state must be online or offline"]);
  const full = normalizePushEvent({ robot_id: "x", at: 1_790_000_000_000, online: true, stuck: "true", pose: { x: 3, y: "4.5" }, errors: [{ code: "E-217", severity: "ERROR" }, "E9"], category: "picking", brand: "Locus" });
  assert.equal(full.event.status.connectionState, "online");
  assert.equal(full.event.status.stuck, true);
  assert.deepEqual(full.event.status.pose, { x: 3, y: 4.5 });
  assert.deepEqual(full.event.status.errors, [{ code: "E-217", severity: "ERROR" }, { code: "E9", severity: null }]);
  assert.equal(full.robot.category, "picking");
  assert.equal(normalizePushEvent({ robot_id: "x", at: 1_790_000_000_000, category: "juggling" }).robot.category, null, "an unknown kind of work is left for the confirm step");
});

test("only our key shape is read from the Authorization header", () => {
  const { key, prefix, keyHash } = newApiKey();
  assert.equal(bearerKey(`Bearer ${key}`), key);
  assert.equal(prefix, key.slice(0, 10));
  assert.equal(keyHash, hashApiKey(key));
  assert.equal(bearerKey("Bearer abc"), null);
  assert.equal(bearerKey(key), null);
});

// ---- a batch ----

function pickerEvents(id, n, t0 = Date.parse("2026-09-23T15:00:00Z")) {
  return Array.from({ length: n }, (_, i) => ({ robot_id: id, at: t0 + i * MIN, connection_state: "online", mission_state: "active", mission_id: `${id}-${Math.floor(i / 10)}`, name: "Picker 7", brand: "Locus", model: "LocusBot", category: "picking" }));
}

test("a batch lands robots with their details and reaches the dashboard's figures", () => {
  const s = openStore(":memory:");
  const out = pushEvents(s, { events: [...pickerEvents("AMR-7", 60), { robot_id: "AMR-8" }] }, NOW);
  assert.equal(out.accepted, 60);
  assert.deepEqual(out.rejected, [{ index: 60, problems: ["missing or unreadable at"] }]);
  const r = s.listRobots()[0];
  assert.deepEqual([r.robot_key, r.display_name, r.brand, r.model, r.category], ["push:AMR-7", "Picker 7", "Locus", "LocusBot", "picking"]);
  const c = fleetContract(s, NOW);
  assert.equal(c.robots.length, 1);
  assert.ok(c.daily.length === 1 && c.daily[0].units > 0, "pushed missions count as work");
});

test("a batch that is too big or not a list is refused whole", () => {
  const s = openStore(":memory:");
  assert.match(pushEvents(s, { events: pickerEvents("x", 1001) }, NOW).error, /At most 1000/);
  assert.match(pushEvents(s, { nope: 1 }, NOW).error, /events/);
  assert.equal(s.listRobots().length, 0);
});

// ---- over HTTP, with keys ----

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "botlien-push-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => NOW, baseUrl: "http://127.0.0.1", readBody });
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
  const push = (key, body) => fetch(`${base}/api/v1/events`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie }, redirect: "manual" });
  return {
    base, control, tenants, signIn, push, api,
    async close() {
      server.close();
      await new Promise((r) => server.once("close", r));
      tenants.closeAll();
      control.close();
    },
  };
}

test("an account makes a key, pushes with it, and a revoked key stops working", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@fleetco.com");
    assert.ok(cookie.startsWith(SESSION_COOKIE));
    const made = await (await app.api("/api/v1/keys", cookie, { method: "POST", body: JSON.stringify({ label: "Fleet manager" }) })).json();
    assert.match(made.key, /^blk_/);
    const listed = await (await app.api("/api/v1/keys", cookie)).json();
    assert.deepEqual(listed.keys.map((k) => [k.prefix, k.label]), [[made.prefix, "Fleet manager"]]);
    assert.ok(!JSON.stringify(listed).includes(made.key), "the full key is never listed again");

    assert.equal((await app.push(null, { events: [] })).status, 401);
    assert.equal((await app.push("blk_notarealkeynotarealkey123", { events: [] })).status, 401);
    const ok = await app.push(made.key, { events: pickerEvents("AMR-7", 30) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).accepted, 30);

    const fleet = await (await app.api("/api/v1/fleet", cookie)).json();
    assert.deepEqual(fleet.robots.map((r) => r.name), ["Picker 7"]);
    assert.ok(fleet.sources.some((x) => x.push && x.robotCount === 1), "pushed data shows as a source");

    // Another account sees none of it and cannot use the key's robots.
    const other = await app.signIn("sam@harborgrill.com");
    assert.deepEqual((await (await app.api("/api/v1/fleet", other)).json()).robots, []);

    assert.equal((await app.api(`/api/v1/keys/${made.id}`, other, { method: "DELETE" })).status, 404, "one account cannot revoke another's key");
    assert.equal((await app.api(`/api/v1/keys/${made.id}`, cookie, { method: "DELETE" })).status, 200);
    assert.equal((await app.push(made.key, { events: [] })).status, 401);
  } finally {
    await app.close();
  }
});

test("a key is limited to 120 requests a minute and an account to 5 keys", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@fleetco.com");
    const keys = [];
    for (let i = 0; i < 5; i++) keys.push(await (await app.api("/api/v1/keys", cookie, { method: "POST", body: "{}" })).json());
    const sixth = await app.api("/api/v1/keys", cookie, { method: "POST", body: "{}" });
    assert.equal(sixth.status, 400);
    let last = null;
    for (let i = 0; i < 121; i++) last = await app.push(keys[0].key, { events: [] });
    assert.equal(last.status, 429);
    assert.equal((await app.push(keys[1].key, { events: [] })).status, 200, "the limit is per key");
  } finally {
    await app.close();
  }
});

test("the Data sources page shows a new key once and then only its prefix", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@fleetco.com");
    const made = await app.api("/owner/sources", cookie, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "create_key", label: "Integrator" }) });
    assert.equal(made.status, 200);
    const html = await made.text();
    const key = html.match(/blk_[A-Za-z0-9_-]{20,}/)?.[0];
    assert.ok(key, "shown once");
    const again = await (await app.api("/owner/sources", cookie)).text();
    assert.ok(!again.includes(key));
    assert.match(again, new RegExp(key.slice(0, 10)));
  } finally {
    await app.close();
  }
});

// ---- import ----

test("an export names each robot's make, work and position on its own row", () => {
  const s = openStore(":memory:");
  const csv = [
    "robot_id,at,mission_state,mission_id,brand,model,name,category,x,y",
    "A1,2026-09-01T15:00:00Z,active,m1,Locus,LocusBot,Picker 1,picking,12,4",
    "S1,2026-09-01T15:00:00Z,active,m2,Gausium,Scrubber 50,Scrubber,cleaning,,",
  ].join("\n");
  importTelemetryFromText(s, csv, "fleet.csv", { nowMs: NOW, category: "delivery" });
  const byKey = Object.fromEntries(s.listRobots().map((r) => [r.external_id, r]));
  assert.deepEqual([byKey.A1.brand, byKey.A1.category, byKey.A1.display_name], ["Locus", "picking", "Picker 1"]);
  assert.deepEqual([byKey.S1.brand, byKey.S1.category], ["Gausium", "cleaning"]);
  const snap = s.latestSnapshot(byKey.A1.id);
  assert.deepEqual([snap.pose_x, snap.pose_y], [12, 4]);
});

test("an export with headers we do not know imports once its columns are named", () => {
  const s = openStore(":memory:");
  const csv = ["Serial No,Logged,Job", "X9,2026-09-01T15:00:00Z,J1", "X9,2026-09-01T15:05:00Z,J1"].join("\n");
  const blind = importTelemetryFromText(s, csv, "odd.csv", { nowMs: NOW });
  assert.equal(blind.imported, 0);
  assert.deepEqual(blind.headers, ["serial no", "logged", "job"]);
  const mapped = importTelemetryFromText(s, csv, "odd.csv", { nowMs: NOW, columns: { robot_id: "Serial No", at: "Logged", mission_id: "Job", nonsense: "Job" } });
  assert.equal(mapped.imported, 2);
  assert.equal(s.listRobots()[0].external_id, "X9");
});

// ---- from an on-site gateway (Sep 2026 robot API research) ----

test("a gateway's cycle counter counts as work, and everything it sent is kept", () => {
  const s = openStore(":memory:");
  const t0 = Date.parse("2026-09-23T15:00:00Z");
  const events = Array.from({ length: 12 }, (_, i) => ({
    robot_id: "UR10-1", at: t0 + i * MIN, program: "tend_cnc", cycle_count: 500 + Math.floor(i / 2),
    alarms: i === 5 ? [{ code: "C204A3", severity: "ERROR", description: "Protective stop: joint 3 deviation" }] : [],
    joint_position_deviation_ratio: [0.01, 0.02, 0.11], name: "Cell 4 arm", brand: "Universal Robots",
  }));
  assert.equal(pushEvents(s, { events }, NOW).accepted, 12);
  const c = fleetContract(s, NOW);
  assert.equal(c.daily[0].units, 6, "six distinct cycles");
  const raw = s.db.prepare("SELECT payload FROM raw_events ORDER BY id").all().map((r) => JSON.parse(r.payload));
  assert.equal(raw.length, 12);
  assert.deepEqual(raw[0].joint_position_deviation_ratio, [0.01, 0.02, 0.11], "fields we do not read yet are archived");
  const snap = s.db.prepare("SELECT errors FROM status_snapshots WHERE errors LIKE '%C204A3%'").get();
  assert.match(snap.errors, /Protective stop: joint 3 deviation/);
});

test("the contract says what each robot is doing right now", () => {
  const s = openStore(":memory:");
  pushEvents(s, { events: [
    { robot_id: "AMR-1", at: Date.parse("2026-09-23T15:00:00Z"), connection_state: "online", mission_state: "active", battery_pct: 64 },
    { robot_id: "AMR-1", at: Date.parse("2026-09-23T15:05:00Z"), connection_state: "online", mission_state: "idle", battery_pct: 61, charging: true, pose: { x: 4, y: 9 }, errors: [{ code: "E1", severity: "WARNING" }] },
  ] }, NOW);
  const now = fleetContract(s, NOW).robots[0].now;
  assert.deepEqual([now.at, now.missionState, now.batteryPct, now.charging], [Date.parse("2026-09-23T15:05:00Z"), "idle", 61, true]);
  assert.deepEqual(now.pose, { x: 4, y: 9 });
  assert.equal(now.errors[0].code, "E1");
});

test("a robot builds a two-week baseline before it counts as ready", () => {
  const s = openStore(":memory:");
  pushEvents(s, { events: pickerEvents("AMR-7", 30) }, NOW);
  const r = fleetContract(s, NOW).robots[0];
  assert.equal(r.baselineReady, false);
  assert.equal(r.baselineDays, 0);
  assert.ok(r.firstDataAt > 0);
});

test("a pushed fault reads as downtime", () => {
  const s = openStore(":memory:");
  const t0 = Date.parse("2026-09-23T15:00:00Z");
  pushEvents(s, { events: [
    { robot_id: "AMR-1", at: t0, mission_state: "active", mission_id: "m1" },
    { robot_id: "AMR-1", at: t0 + MIN, mission_state: "active", mission_id: "m1", errors: [{ code: "E-217", severity: "ERROR" }] },
    { robot_id: "AMR-1", at: t0 + 2 * MIN, mission_state: "active", mission_id: "m1" },
  ] }, NOW);
  const d = fleetContract(s, NOW).downtime;
  assert.equal(d.length, 1);
  assert.equal(d[0].cause, "error E-217");
});
