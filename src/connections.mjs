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
import { gausiumTaskReportToEvents } from "./normalize.mjs";
import { rebuildRollupsForRobot } from "./rollup.mjs";

const DAY_MS = 86_400_000;
export const DEFAULT_HISTORY_DAYS = 90;
export const historyKey = (vendor) => `history.${vendor}`;

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
    // Past jobs in, as the samples the live poll would have written.
    historyToEvents: gausiumTaskReportToEvents,
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

/** Where an account's history pull stands, from its own store. */
export function historyStatus(store, vendor) {
  try {
    return JSON.parse(store.getKV(historyKey(vendor)) ?? "null");
  } catch {
    return null;
  }
}

/** Land a vendor's past in an account's store through the engine's own
 *  ingest, then rebuild the hourly rollups the dashboard reads. One
 *  transaction per robot, so a failure part way leaves whole robots, never
 *  half of one. Returns what it did, for the status and the log. */
export async function pullHistory({ store, engine, connector, vendor, fromMs, toMs }) {
  const h = await connector.history(fromMs, toMs);
  for (const m of h.robots) {
    store.upsertRobot({ connector: connector.name, externalId: m.externalId, displayName: m.displayName, brand: m.brand, model: m.model, category: m.category }, toMs);
  }
  let jobs = 0;
  let samples = 0;
  for (const [sn, reports] of Object.entries(h.reports)) {
    store.transaction(() => {
      for (const rep of reports) {
        const events = VENDORS[vendor].historyToEvents(sn, rep);
        if (!events.length) continue;
        jobs += 1;
        samples += events.length;
        engine.ingest(connector.name, events, toMs, { storeRaw: false });
        // One archived row per job keeps what the samples cannot carry (area
        // cleaned, water used) for the figures that will price it later.
        store.insertRawEvent({ connector: connector.name, robotKey: `${connector.name}:${sn}`, kind: "task_report", source: "history", at: events[0].at, receivedAt: toMs, payload: JSON.stringify(rep) });
      }
      const robot = store.getRobotByKey(`${connector.name}:${sn}`);
      if (robot) rebuildRollupsForRobot(store, robot.id);
    });
  }
  return { robots: h.robots.length, jobs, samples, failed: h.failed };
}

/** What a page may show about an account's connections. Never the keys.
 *  With the account's store, it also says how the history pull went. */
export function describeConnections(control, accountId, store = null) {
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
      history: c && store ? historyStatus(store, key) : null,
    };
  });
}

/** Every connected account, synced in turn. One slow or broken vendor never
 *  holds up the rest: each account runs under its own timeout, a failure is
 *  recorded on that connection, and the loop moves on. */
export function createTenantSync({ control, tenants, vault, config = {}, log = () => {}, fetchImpl = fetch, perAccountTimeoutMs = 30_000, historyDays = DEFAULT_HISTORY_DAYS }) {
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
    const fresh = { updatedAt: c.updated_at, store, connector, engine, lastState: null, history: null };
    runtimes.set(c.id, fresh);
    return fresh;
  }

  /** Start the account's history pull once, in the background: the live sync
   *  keeps its cadence while months of past jobs land. Done or failed is kept
   *  in the account's own store, so it never runs twice for one connection,
   *  and new keys (a new connection row) pull again. */
  function startHistory(c, rt, nowMs) {
    if (rt.history || typeof rt.connector.history !== "function") return;
    const prev = historyStatus(rt.store, c.vendor);
    if (prev && prev.connectionId === c.id && prev.updatedAt === c.updated_at && prev.state !== "running") return;
    const fromMs = nowMs - historyDays * DAY_MS;
    const base = { connectionId: c.id, updatedAt: c.updated_at, fromMs, toMs: nowMs, days: historyDays };
    rt.store.setKV(historyKey(c.vendor), JSON.stringify({ ...base, state: "running", startedAt: nowMs }));
    rt.history = pullHistory({ store: rt.store, engine: rt.engine, connector: rt.connector, vendor: c.vendor, fromMs, toMs: nowMs })
      .then((out) => {
        rt.store.setKV(historyKey(c.vendor), JSON.stringify({ ...base, state: "done", finishedAt: Date.now(), ...out }));
        log(`account ${c.account_id} ${c.vendor} history: ${out.jobs} jobs over ${historyDays} days, ${out.robots} robots${out.failed.length ? `, ${out.failed.length} robot(s) failed` : ""}`);
      })
      .catch((err) => {
        const error = String(err?.message ?? err).slice(0, 200);
        try {
          rt.store.setKV(historyKey(c.vendor), JSON.stringify({ ...base, state: "failed", finishedAt: Date.now(), error }));
        } catch {
          /* the store was closed under us; the next start retries */
        }
        log(`account ${c.account_id} ${c.vendor} history pull failed: ${error}`, "warning");
      });
  }

  async function syncOne(c, nowMs) {
    let state = "down";
    let detail = null;
    let robotCount = null;
    try {
      const rt = await withTimeout(runtimeFor(c, nowMs), perAccountTimeoutMs, "starting the connection timed out");
      startHistory(c, rt, nowMs);
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
    /** Resolves when every history pull that has started has finished. */
    async settled() {
      await Promise.allSettled([...runtimes.values()].map((rt) => rt.history).filter(Boolean));
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
