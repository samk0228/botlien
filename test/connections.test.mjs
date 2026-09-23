import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVault, VaultError } from "../src/vault.mjs";
import { openControl } from "../src/control.mjs";
import { openStore } from "../src/store.mjs";
import { readCredentials, connectVendor, describeConnections, createTenantSync, ConnectionError } from "../src/connections.mjs";

const KEY = randomBytes(32).toString("base64");
const KEYS = { client_id: "cid-1", client_secret: "shh-secret", open_access_key: "oak-1" };
const T0 = Date.parse("2026-09-23T17:00:00Z");

/** A stand-in for Gausium's open API: accepts one set of keys, lists two
 *  scrubbers, answers status for each. `calls` records every URL hit. */
function fakeGausium({ acceptSecret = "shh-secret", robots = ["SN-1", "SN-2"] } = {}) {
  const calls = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).endsWith("/oauth/token")) {
      const body = JSON.parse(opts.body);
      return body.client_secret === acceptSecret ? json(200, { access_token: "tok", expires_in: 3600 }) : json(401, {});
    }
    if (String(url).includes("/v1alpha1/robots?")) {
      return json(200, { robots: robots.map((sn) => ({ serialNumber: sn, displayName: `Scrubber ${sn}`, modelTypeCode: "S50" })), total: robots.length });
    }
    const m = String(url).match(/robots\/([^/]+)\/status/);
    if (m) {
      return json(200, {
        online: true,
        battery: { powerPercentage: 80, charging: false },
        taskState: "RUNNING",
        currentTask: { taskInstanceId: `task-${m[1]}` },
        navStatus: "NORMAL",
        speedKilometerPerHour: 2,
        localizationInfo: { worldX: 4, worldY: 7 },
      });
    }
    return json(404, {});
  };
  return { fetchImpl, calls };
}

// ---- vault ----

test("a sealed credential opens to what went in and is not readable at rest", () => {
  const v = createVault({ keyB64: KEY });
  const sealed = v.seal(KEYS);
  assert.equal(sealed.includes("shh-secret"), false);
  assert.deepEqual(v.open(sealed), KEYS);
  assert.notEqual(v.seal(KEYS), sealed, "a fresh IV each time");
});

test("a tampered or wrongly keyed credential fails loudly", () => {
  const v = createVault({ keyB64: KEY });
  const sealed = v.seal(KEYS);
  const parts = sealed.split(".");
  parts[3] = Buffer.from("x" + Buffer.from(parts[3], "base64").toString("latin1")).toString("base64");
  assert.throws(() => v.open(parts.join(".")), VaultError);
  const other = createVault({ keyB64: randomBytes(32).toString("base64") });
  assert.throws(() => other.open(sealed), VaultError);
});

test("production refuses to store keys without BOTLIEN_SECRET_KEY", () => {
  const v = createVault({ keyB64: null, production: true, devKeyPath: "/tmp/never-used" });
  assert.equal(v.ready, false);
  assert.throws(() => v.seal(KEYS), VaultError);
});

test("development gets a key file only its owner can read", () => {
  const path = join(mkdtempSync(join(tmpdir(), "vault-")), ".secret-key");
  const a = createVault({ keyB64: null, production: false, devKeyPath: path });
  const b = createVault({ keyB64: null, production: false, devKeyPath: path });
  assert.deepEqual(b.open(a.seal(KEYS)), KEYS, "the same file is reused across restarts");
  assert.equal(statSync(path).mode & 0o077, 0);
});

// ---- connecting ----

test("a missing field is named before any vendor call", () => {
  assert.throws(() => readCredentials("gausium", { client_id: "x", client_secret: "y" }), /Open access key is missing/);
  assert.throws(() => readCredentials("locus", {}), ConnectionError);
});

test("good keys are tested, then stored sealed, and the listing never carries them", async () => {
  const control = openControl(":memory:");
  const vault = createVault({ keyB64: KEY });
  const g = fakeGausium();
  const out = await connectVendor({ control, vault, accountId: 7, vendor: "gausium", input: KEYS, fetchImpl: g.fetchImpl, now: () => T0 });
  assert.equal(out.robotCount, 2);
  const raw = control.sealedSecret(out.connection.id);
  assert.equal(raw.includes("shh-secret"), false);
  assert.deepEqual(vault.open(raw), KEYS);
  const listed = describeConnections(control, 7);
  assert.equal(JSON.stringify(listed).includes("shh-secret"), false);
  assert.equal(listed.find((x) => x.vendor === "gausium").connected, true);
});

test("rejected keys save nothing and say what to do", async () => {
  const control = openControl(":memory:");
  const g = fakeGausium({ acceptSecret: "the-real-one" });
  await assert.rejects(
    connectVendor({ control, vault: createVault({ keyB64: KEY }), accountId: 7, vendor: "gausium", input: KEYS, fetchImpl: g.fetchImpl }),
    /did not accept these keys/
  );
  assert.equal(control.connectionsForAccount(7).length, 0);
});

// ---- syncing ----

function tenantsFor(stores) {
  return { get: (id) => (stores[id] ??= openStore(":memory:")) };
}

test("a connected account's robots and status land in its own store", async () => {
  const control = openControl(":memory:");
  const vault = createVault({ keyB64: KEY });
  const g = fakeGausium();
  await connectVendor({ control, vault, accountId: 7, vendor: "gausium", input: KEYS, fetchImpl: g.fetchImpl, now: () => T0 });
  const stores = {};
  const sync = createTenantSync({ control, tenants: tenantsFor(stores), vault, fetchImpl: g.fetchImpl });
  const [r] = await sync.tick(T0);
  assert.equal(r.state, "ok");
  assert.equal(r.robotCount, 2);
  const store = stores[7];
  assert.deepEqual(store.listRobots().map((x) => x.robot_key).sort(), ["gausium:SN-1", "gausium:SN-2"]);
  assert.equal(store.listRobots()[0].brand, "Gausium");
  assert.ok(store.latestSnapshot(store.listRobots()[0].id), "a status snapshot was written");
  assert.equal(control.connection(7, "gausium").last_state, "ok");
  await sync.stop();
});

test("one account's broken keys do not stop another account's sync", async () => {
  const control = openControl(":memory:");
  const vault = createVault({ keyB64: KEY });
  const good = fakeGausium();
  await connectVendor({ control, vault, accountId: 1, vendor: "gausium", input: KEYS, fetchImpl: good.fetchImpl, now: () => T0 });
  await connectVendor({ control, vault, accountId: 2, vendor: "gausium", input: KEYS, fetchImpl: good.fetchImpl, now: () => T0 });
  // Account 1's keys are revoked at the vendor after connecting.
  const fetchImpl = async (url, opts = {}) => {
    if (String(url).endsWith("/oauth/token") && JSON.parse(opts.body).client_id === "revoked") return { ok: false, status: 401, json: async () => ({}) };
    return good.fetchImpl(url, opts);
  };
  control.upsertConnection({ accountId: 1, vendor: "gausium", secretSealed: vault.seal({ ...KEYS, client_id: "revoked" }) }, T0 + 1);
  const logs = [];
  const sync = createTenantSync({ control, tenants: tenantsFor({}), vault, fetchImpl, log: (m, k) => logs.push([m, k]) });
  const results = await sync.tick(T0 + 60_000);
  const byAccount = Object.fromEntries(results.map((r) => [r.accountId, r.state]));
  assert.equal(byAccount[1], "down");
  assert.equal(byAccount[2], "ok");
  assert.ok(logs.some(([m, k]) => k === "needs_user" && /account 1 gausium sync is down/.test(m)));
  await sync.stop();
});

test("disconnecting stops the account's sync on the next tick", async () => {
  const control = openControl(":memory:");
  const vault = createVault({ keyB64: KEY });
  const g = fakeGausium();
  await connectVendor({ control, vault, accountId: 7, vendor: "gausium", input: KEYS, fetchImpl: g.fetchImpl, now: () => T0 });
  const sync = createTenantSync({ control, tenants: tenantsFor({}), vault, fetchImpl: g.fetchImpl });
  await sync.tick(T0);
  assert.equal(sync.running, 1);
  control.deleteConnection(7, "gausium");
  assert.deepEqual(await sync.tick(T0 + 60_000), []);
  assert.equal(sync.running, 0);
});
