// End-to-end check: sim fleet → engine → flags → board, on a temp DB and an
// ephemeral port, driven by a stepped virtual clock (fast, no real waiting).
// Exits 0 on PASS, 1 on FAIL. Run via `npm run e2e`.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { createEngine } from "../src/engine.mjs";
import { createSimConnector } from "../src/connectors/sim.mjs";
import demoFleet from "../src/scenarios/demo-fleet.mjs";
import { boardModel, startBoard } from "../src/board.mjs";
import { loadConfig } from "../src/infra.mjs";

const START = Date.parse("2026-08-04T08:00:00-07:00");
const MIN = 60_000;
const DAY = 86_400_000;

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

console.log("botlien e2e: driving demo fleet through 5 sim-days...");
const store = openStore(join(mkdtempSync(join(tmpdir(), "botlien-e2e-")), "e2e.db"));
const config = loadConfig();
const engine = createEngine({ store, connectors: [createSimConnector(demoFleet)], config });

await engine.init(START);
for (let t = START; t <= START + 2 * 60 * MIN; t += 5 * MIN) await engine.runOnce(t);
for (let t = START + 3 * 60 * MIN; t <= START + 5 * DAY; t += 60 * MIN) await engine.runOnce(t);
let now = START + 5 * DAY;

const all = store.allFlags();
const ruleIds = new Set(all.map((f) => f.rule_id));
check(ruleIds.size >= 4, `>=4 distinct rule_ids raised (got: ${[...ruleIds].join(", ")})`);
check(
  all.some((f) => f.rule_id === "connector_down" && f.status === "cleared"),
  "connector_down raised during the scripted outage and cleared after"
);
check(
  !all.some((f) => f.rule_id === "offline_duration"),
  "no false offline_duration flags (heartbeat gating held)"
);
check(store.activeFlags().length > 0, "flags are active at end of run");

const server = startBoard(0, { getState: () => boardModel(store, now) });
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
const api = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
server.close();

check(html.includes("BOTLIEN"), "board serves HTML");
check(html.includes("DEMO"), "demo badge shown for simulated fleet");
for (const id of [...ruleIds].filter((r) => store.activeFlags().some((f) => f.rule_id === r))) {
  check(html.includes(id), `board shows active flag ${id}`);
}
check(html.includes("Connector heartbeat"), "board shows heartbeat strip");
check(api.summary.robotCount === 5, `api reports 5 robots (got ${api.summary.robotCount})`);

store.close();
if (failures.length > 0) {
  console.log(`\nFAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS: end-to-end pipeline verified");
process.exit(0);
