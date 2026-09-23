// Customers' own vendor connections: test the keys, keep them sealed, and
// sync every connected account on the same engine the ops board uses.
//
// One connection = one account + one vendor + that account's API keys. The
// scheduler below walks every active connection each tick and runs it
// through createEngine() against the account's own store, so a connected
// fleet lands in exactly the tables an uploaded export lands in, and every
// screen the account sees fills in with no step of its own.
import { createEngine } from "./engine.mjs";
import { createGausiumConnector } from "./connectors/gausium.mjs";

/** The vendors an account can connect today. `fields` is what the owner
 *  pastes; everything else about the vendor stays server-side. */
export const VENDORS = {
  gausium: {
    label: "Gausium",
    fields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret", secret: true },
      { key: "open_access_key", label: "Open access key", secret: true },
    ],
    help: "Gausium issues these in the Gausium Open Platform under your company account.",
    // BOTLIEN_GAUSIUM_BASE points every customer's connection at another
    // host: a vendor sandbox, or the stand-in the end-to-end check runs.
    create: (secrets, config, deps) =>
      createGausiumConnector({ ...(config.gausium ?? {}), ...(process.env.BOTLIEN_GAUSIUM_BASE ? { base: process.env.BOTLIEN_GAUSIUM_BASE } : {}) }, secrets, deps),
  },
};

export class ConnectionError extends Error {}

/** Clean and check the pasted fields. Returns the secrets object or throws a
 *  ConnectionError that names the field, for the form to show. */
export function readCredentials(vendor, input) {
  const v = VENDORS[vendor];
  if (!v) throw new ConnectionError(`We cannot connect ${vendor} yet.`);
  const out = {};
  for (const f of v.fields) {
    const val = String(input?.[f.key] ?? "").trim();
    if (!val) throw new ConnectionError(`${f.label} is missing.`);
    if (val.length > 512) throw new ConnectionError(`${f.label} is longer than any real key.`);
    out[f.key] = val;
  }
  return out;
}

/** Try the keys against the vendor for real. Resolves with what the vendor
 *  says is on the account, or throws a ConnectionError the owner can act on. */
export async function testConnection(vendor, secrets, { config = {}, fetchImpl = fetch, now = Date.now } = {}) {
  const connector = VENDORS[vendor].create(secrets, config, { fetchImpl });
  try {
    return await withTimeout(connector.probe(now()), 20_000, "the vendor did not answer within 20 seconds");
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/auth rejected|401|403/i.test(msg)) throw new ConnectionError(`${VENDORS[vendor].label} did not accept these keys. Check each one and try again.`);
    throw new ConnectionError(`Could not reach ${VENDORS[vendor].label}: ${msg.slice(0, 160)}`);
  } finally {
    await connector.stop?.();
  }
}

/** Test, then store sealed. Nothing is saved unless the vendor accepted it. */
export async function connectVendor({ control, vault, accountId, vendor, input, config = {}, fetchImpl = fetch, now = Date.now }) {
  if (!vault.ready) throw new ConnectionError("Saving keys is switched off on this server until its encryption key is set.");
  const secrets = readCredentials(vendor, input);
  const probe = await testConnection(vendor, secrets, { config, fetchImpl, now });
  const row = control.upsertConnection({ accountId, vendor, secretSealed: vault.seal(secrets), robotCount: probe.robotCount }, now());
  return { connection: row, robots: probe.robots, robotCount: probe.robotCount };
}

/** What a page may show about an account's connections. Never the keys. */
export function describeConnections(control, accountId) {
  const byVendor = new Map(control.connectionsForAccount(accountId).map((c) => [c.vendor, c]));
  return Object.entries(VENDORS).map(([key, v]) => {
    const c = byVendor.get(key) ?? null;
    return {
      vendor: key,
      label: v.label,
      fields: v.fields.map(({ key: k, label, secret }) => ({ key: k, label, secret: secret === true })),
      help: v.help,
      connected: c !== null,
      status: c?.status ?? null,
      robotCount: c?.robot_count ?? null,
      lastSyncAt: c?.last_sync_at ?? null,
      lastOkAt: c?.last_ok_at ?? null,
      state: c?.last_state ?? null,
      error: c?.last_error ?? null,
      connectedAt: c?.created_at ?? null,
    };
  });
}

/** Every connected account, synced in turn. One slow or broken vendor never
 *  holds up the rest: each account runs under its own timeout, a failure is
 *  recorded on that connection, and the loop moves on. */
export function createTenantSync({ control, tenants, vault, config = {}, log = () => {}, fetchImpl = fetch, perAccountTimeoutMs = 30_000 }) {
  const runtimes = new Map(); // connection id -> { updatedAt, store, connector, engine, lastState }

  async function stopRuntime(id) {
    const rt = runtimes.get(id);
    runtimes.delete(id);
    try {
      await rt?.connector.stop?.();
    } catch {
      /* stopping is best effort */
    }
  }

  async function runtimeFor(c, nowMs) {
    const store = tenants.get(c.account_id);
    const rt = runtimes.get(c.id);
    // Rebuilt when the owner saved new keys, or when the account's store
    // handle was closed by the cache and reopened.
    if (rt && rt.updatedAt === c.updated_at && rt.store === store) return rt;
    if (rt) await stopRuntime(c.id);
    const secrets = vault.open(control.sealedSecret(c.id));
    const connector = VENDORS[c.vendor].create(secrets, config, { fetchImpl, log });
    const engine = createEngine({ store, connectors: [connector], config, log });
    await engine.init(nowMs);
    const fresh = { updatedAt: c.updated_at, store, connector, engine, lastState: null };
    runtimes.set(c.id, fresh);
    return fresh;
  }

  async function syncOne(c, nowMs) {
    let state = "down";
    let detail = null;
    let robotCount = null;
    try {
      const rt = await withTimeout(runtimeFor(c, nowMs), perAccountTimeoutMs, "starting the connection timed out");
      await withTimeout(rt.engine.runOnce(nowMs), perAccountTimeoutMs, "sync timed out");
      const hb = rt.store.latestHeartbeat(rt.connector.name);
      state = hb?.state ?? "degraded";
      detail = hb?.detail ?? null;
      robotCount = rt.store.listRobots().filter((r) => r.connector === rt.connector.name).length;
      if (state !== rt.lastState && (state === "down" || rt.lastState === "down")) {
        log(
          state === "down"
            ? `account ${c.account_id} ${c.vendor} sync is down: ${detail ?? "no detail"}`
            : `account ${c.account_id} ${c.vendor} sync recovered`,
          state === "down" ? "needs_user" : "info"
        );
      }
      rt.lastState = state;
    } catch (err) {
      detail = String(err?.message ?? err).slice(0, 200);
      await stopRuntime(c.id);
    }
    control.recordSync(c.id, { at: nowMs, state, detail, robotCount });
    return { id: c.id, accountId: c.account_id, vendor: c.vendor, state, detail, robotCount };
  }

  return {
    async tick(nowMs) {
      const active = control.activeConnections();
      const live = new Set(active.map((c) => c.id));
      for (const id of [...runtimes.keys()]) if (!live.has(id)) await stopRuntime(id);
      const results = [];
      for (const c of active) results.push(await syncOne(c, nowMs));
      return results;
    },
    async stop() {
      for (const id of [...runtimes.keys()]) await stopRuntime(id);
    },
    get running() {
      return runtimes.size;
    },
  };
}

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
