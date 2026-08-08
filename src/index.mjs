// Entry point. `npm start` runs live mode (real clock; Bear connector joins
// automatically once credentials exist in .claude/secrets.local.json).
// `npm run demo` runs the demo fleet on a 60x virtual clock: within ~2 real
// minutes the board shows utilization and battery flags accumulating, and the
// scripted outage turns the heartbeat strip red without robot flags firing.
import { loadConfig, loadSecrets, genesisLog } from "./infra.mjs";
import { openStore } from "./store.mjs";
import { createEngine, createClock } from "./engine.mjs";
import { createSimConnector } from "./connectors/sim.mjs";
import { boardModel, startBoard, readBody } from "./board.mjs";
import { ownerModel, parseSetupForm, confirmModel, parseConfirmForm, applyConfirm, recordImport, businessType, setBusinessType } from "./owner.mjs";
import { importTelemetryFromText } from "./importer.mjs";
import { defaultWorkFor } from "./rates.mjs";
import { ROOT, resolvePath } from "./infra.mjs";
import { join } from "node:path";

/** True when a base URL points back at whoever opens it. Parsed rather than
 * string-matched, because "http://localhost.evil.com" contains "localhost" and
 * is not loopback, and an unparseable value is a misconfiguration worth warning
 * about too. */
function isLoopback(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function main() {
  const demo = process.argv.includes("--demo");
  const config = loadConfig();
  const secrets = loadSecrets();
  // Env overrides so a demo can be run against a scratch database and a spare
  // port without editing tracked config. Without this the only way to try a
  // demo is to point it at whatever database the real fleet is using.
  const dbPath = process.env.BOTLIEN_DB ?? config.db_path;
  const port = Number(process.env.BOTLIEN_PORT ?? config.board.port);
  const store = openStore(resolvePath(dbPath));

  const connectors = [];
  let scenario = null;
  if (demo) {
    scenario = (await import(`./scenarios/${config.demo.scenario}.mjs`)).default;
    connectors.push(createSimConnector(scenario));
  } else {
    // Connectors are additive: a mixed-brand fleet is the normal case for the
    // Operator tier, so both run side by side when both sets of keys exist.
    if (secrets.bear) {
      const { createBearConnector } = await import("./connectors/bear.mjs");
      connectors.push(createBearConnector(config.bear, secrets.bear, { log: genesisLog }));
    }
    if (secrets.gausium) {
      const { createGausiumConnector } = await import("./connectors/gausium.mjs");
      connectors.push(createGausiumConnector(config.gausium ?? {}, secrets.gausium, { log: genesisLog }));
    }
    if (connectors.length === 0) {
      // Deliberately NO connector. Live mode used to fall back to the simulator,
      // which was harmless when this was only a demo, but an owner who imports
      // their own export would find five invented robots mixed into their fleet
      // and be asked to price them. Simulated robots belong behind --demo only.
      console.log("no vendor credentials — live mode with no connector. Import an export at /owner/import, or run `npm run demo` for the simulated fleet.");
    }
  }

  const clock = demo ? createClock({ scale: config.demo.clock_scale }) : createClock({ scale: 1 });
  const engine = createEngine({ store, connectors, config, log: genesisLog });
  await engine.init(clock.now());

  // Seed the demo with history before the live loop starts, so the tips and
  // period-over-period panels have something to read on the first page load
  // instead of 48 real minutes from now. Skipped when the database already
  // holds telemetry, which keeps a restart from stacking a second copy of the
  // same three weeks on top of the first.
  if (demo && scenario?.backfillDays > 0 && store.rollupTimeRange() === null) {
    const { backfillScenario } = await import("./backfill.mjs");
    const t0 = Date.now();
    const summary = await backfillScenario({
      store,
      engine,
      connector: createSimConnector(scenario),
      toMs: clock.now(),
      days: scenario.backfillDays,
      log: (m) => console.log(m),
    });
    engine.evaluate(clock.now());
    console.log(`demo history ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (${summary.events} snapshots)`);
    genesisLog(`demo backfilled ${summary.days}d of history (${summary.events} snapshots)`);
  }

  const tickRealMs = demo ? config.demo.tick_real_ms : config.engine.tick_ms;
  let ticking = false;
  const interval = setInterval(async () => {
    if (ticking) return; // never overlap ticks
    ticking = true;
    try {
      await engine.runOnce(clock.now());
    } catch (err) {
      genesisLog(`engine tick error: ${String(err).slice(0, 200)}`, "warning");
      console.error("tick error:", err);
    } finally {
      ticking = false;
    }
  }, tickRealMs);

  // The multi-tenant owner product. Deliberately off under --demo, which is one
  // scripted fleet shown without a sign-in because that is what a sales demo
  // needs. Everywhere else, `/owner` belongs to whoever is signed in.
  //
  // Note what does NOT happen here: no engine is started per account. The
  // engine exists to poll vendor APIs, and an owner's fleet arrives as an
  // uploaded export whose import path already rebuilds its own rollups. The
  // process store below stays the connector-fed fleet behind /ops.
  let tenancy = null;
  if (!demo) {
    const [{ openControl }, { TenantStores }, { createMailer }, { createTenancy }] = await Promise.all([
      import("./control.mjs"),
      import("./tenant.mjs"),
      import("./mailer.mjs"),
      import("./tenancy.mjs"),
    ]);
    const control = openControl(resolvePath(process.env.BOTLIEN_CONTROL_DB ?? "data/control.db"));
    const mailer = createMailer({ secrets, logPath: resolvePath("data/sent-mail.log") });
    const baseUrl = process.env.BOTLIEN_BASE_URL ?? `http://127.0.0.1:${port}`;
    tenancy = createTenancy({
      control,
      mailer,
      tenants: new TenantStores(resolvePath(process.env.BOTLIEN_TENANT_DIR ?? "data/tenants")),
      config,
      now: () => clock.now(),
      baseUrl,
      // A Secure cookie is silently dropped over plain http, so it stays off
      // until something is actually terminating TLS in front of us.
      secureCookies: process.env.BOTLIEN_SECURE_COOKIES === "1",
      readBody,
      log: genesisLog,
    });
    if (mailer.kind === "console") {
      console.log("no RESEND_API_KEY — sign-in links print to the console and data/sent-mail.log");
    } else if (isLoopback(baseUrl)) {
      // The failure this prevents is quiet and expensive: a real email leaves
      // for a real customer carrying a link to 127.0.0.1, which resolves to
      // their own machine. They see a dead page, we see a successful send, and
      // nothing in any log says the two are related.
      console.warn(
        `WARNING: sending live email but BOTLIEN_BASE_URL is ${baseUrl}. Every sign-in link ` +
          `will point at the recipient's own machine and will not work. Set BOTLIEN_BASE_URL ` +
          `to the public https:// address before inviting anyone.`,
      );
    }
  }

  const server = startBoard(port, {
    tenancy,
    getState: () => boardModel(store, clock.now()),
    getOwnerState: () => ownerModel(store, clock.now(), config),
    saveEconomics: (params) => {
      const { updates, errors } = parseSetupForm(params, store.listRobots());
      const nowMs = clock.now();
      for (const u of updates) store.upsertRobotEconomics(u.robotId, u.econ, nowMs);
      if (updates.length > 0) genesisLog(`owner economics updated for ${updates.length} robot(s)`);
      if (errors.length > 0) {
        genesisLog(`owner setup rejected ${errors.length} field(s): ${errors.map((e) => e.field).join(",")}`, "warning");
      }
    },
    onboarding: {
      getBusiness: () => businessType(store),
      saveBusiness: (type) => {
        const ok = setBusinessType(store, type);
        if (ok) genesisLog(`owner business type set to ${type}`);
        return ok;
      },
      importText: (text, filename) => {
        const nowMs = clock.now();
        let result;
        try {
          result = importTelemetryFromText(store, text, filename, {
            nowMs,
            bucketMs: config.engine.rollup_bucket_ms ?? 3_600_000,
            // Assume the business's main kind of work; the confirm screen is
            // where the owner corrects anything that is not.
            category: defaultWorkFor(businessType(store)),
          });
        } catch (err) {
          return { ok: false, message: `That file could not be parsed: ${String(err).slice(0, 120)}` };
        }
        if (result.imported === 0) {
          return {
            ok: false,
            message: "No usable rows. Every row needs a robot id and a timestamp.",
          };
        }
        const range = store.snapshotTimeRange();
        recordImport(store, {
          filename,
          rows: result.rows,
          imported: result.imported,
          skipped: result.skipped,
          skipReasons: result.skipReasons,
          robots: result.robots.length,
          rangeLabel: range
            ? `${new Date(range.minAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${new Date(range.maxAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : null,
          at: nowMs,
        });
        genesisLog(`owner imported ${result.imported} rows across ${result.robots.length} robot(s) from ${filename}`);
        return { ok: true };
      },
      confirmState: () => confirmModel(store, clock.now()),
      saveConfirm: (params) => {
        const nowMs = clock.now();
        applyConfirm(store, parseConfirmForm(params, store.listRobots()), nowMs);
        genesisLog("owner confirmed fleet");
      },
    },
  });
  const mode = demo ? `demo (${config.demo.clock_scale}x clock)` : "live";
  // The address the outside world uses, not the one we bound. On a host these
  // differ, and a log line claiming 127.0.0.1 sends you debugging the wrong box.
  const base = process.env.BOTLIEN_BASE_URL ?? `http://127.0.0.1:${port}`;
  console.log(
    demo
      ? `botlien ${mode} — risk board ${base}/ · owner board ${base}/owner`
      : `botlien ${mode} — front door ${base}/ · sign in ${base}/signin · ops board ${base}/ops`,
  );
  genesisLog(`botlien engine online (${mode}, connectors: ${connectors.map((c) => c.name).join(",")})`);

  const shutdown = async () => {
    clearInterval(interval);
    server.close();
    await engine.stop();
    store.close();
    // Every account's database is a separate file with its own WAL, and a
    // container gets SIGTERM on each deploy. Closing them checkpoints the WAL
    // back into the database; skipping it leaves -wal files on the volume that
    // the next boot has to recover, per account, on the first request.
    if (tenancy) {
      try {
        tenancy.close();
      } catch {
        /* a handle we cannot close is not worth failing the shutdown over */
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
