// Entry point. `npm start` runs live mode (real clock; Bear connector joins
// automatically once credentials exist in .claude/secrets.local.json).
// `npm run demo` runs the demo fleet on a 60x virtual clock: within ~2 real
// minutes the board shows utilization and battery flags accumulating, and the
// scripted outage turns the heartbeat strip red without robot flags firing.
import { loadConfig, loadSecrets, genesisLog } from "./infra.mjs";
import { openStore } from "./store.mjs";
import { createEngine, createClock } from "./engine.mjs";
import { createSimConnector } from "./connectors/sim.mjs";
import { boardModel, startBoard } from "./board.mjs";
import { ROOT } from "./infra.mjs";
import { join } from "node:path";

async function main() {
  const demo = process.argv.includes("--demo");
  const config = loadConfig();
  const secrets = loadSecrets();
  const store = openStore(join(ROOT, config.db_path));

  const connectors = [];
  if (demo) {
    const scenario = (await import(`./scenarios/${config.demo.scenario}.mjs`)).default;
    connectors.push(createSimConnector(scenario));
  } else {
    if (secrets.bear) {
      const { createBearConnector } = await import("./connectors/bear.mjs");
      connectors.push(createBearConnector(config.bear, secrets.bear, { log: genesisLog }));
    } else {
      console.log("no Bear credentials in .claude/secrets.local.json — starting with the demo fleet instead");
      const scenario = (await import(`./scenarios/${config.demo.scenario}.mjs`)).default;
      connectors.push(createSimConnector(scenario));
    }
  }

  const clock = demo ? createClock({ scale: config.demo.clock_scale }) : createClock({ scale: 1 });
  const engine = createEngine({ store, connectors, config, log: genesisLog });
  await engine.init(clock.now());

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

  const server = startBoard(config.board.port, { getState: () => boardModel(store, clock.now()) });
  const mode = demo ? `demo (${config.demo.clock_scale}x clock)` : "live";
  console.log(`botlien ${mode} — board on http://127.0.0.1:${config.board.port}`);
  genesisLog(`botlien engine online (${mode}, connectors: ${connectors.map((c) => c.name).join(",")})`);

  const shutdown = async () => {
    clearInterval(interval);
    server.close();
    await engine.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
