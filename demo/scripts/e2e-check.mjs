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
// Counted off the scenario, not hard-coded: adding a demo robot is a routine
// change and should not fail an unrelated end-to-end check.
check(
  api.summary.robotCount === demoFleet.robots.length,
  `api reports ${demoFleet.robots.length} robots (got ${api.summary.robotCount})`
);

// ---- the onboarding path an owner actually walks ----
// A separate store, because this is the empty-database experience: no simulated
// fleet, nothing but a file the owner drops.
{
  const { openStore } = await import("../src/store.mjs");
  const { importTelemetryFromText } = await import("../src/importer.mjs");
  const owner = await import("../src/owner.mjs");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-e2e-")), "onboarding.db"));
  const T = Date.parse("2026-08-06T00:00:00Z");
  const DAY_MS = 86_400_000;

  check(owner.onboardingStep(s) === "business", "empty database starts at the business question");
  check(owner.setBusinessType(s, "not-a-business") === false, "a bad business answer is rejected");
  owner.setBusinessType(s, "restaurant");
  check(owner.onboardingStep(s) === "import", "after the business question the step is import");

  const rows = ["robot_id,timestamp,connection_state,mission_state,mission_id"];
  const start = Date.parse("2026-07-01T08:00:00Z");
  for (let d = 0; d < 5; d++) {
    for (let m = 0; m < 600; m += 5) {
      const t = new Date(start + d * DAY_MS + m * 60_000).toISOString();
      const active = (m / 5) % 4 < 2;
      rows.push(`servi-1,${t},online,${active ? "active" : "idle"},${active ? "m" + d + m : ""}`);
      rows.push(`scrub-1,${t},online,active,cycle-${d}`);
    }
  }
  const imported = importTelemetryFromText(s, rows.join("\n"), "export.csv", { nowMs: T });
  check(imported.robots.length === 2, `import found 2 robots (got ${imported.robots.length})`);
  check(imported.buckets > 0, "import wrote rollups (empty statement blocker)");
  check(owner.onboardingStep(s) === "confirm", "after import the step is confirm");

  const scrub = s.listRobots().find((r) => r.robot_key.includes("scrub-1"));
  const params = new URLSearchParams();
  for (const r of s.listRobots()) {
    params.set(`name_${r.id}`, r.robot_key);
    params.set(`category_${r.id}`, r.id === scrub.id ? "cleaning" : "delivery");
    params.set(`excluded_${r.id}`, "0");
  }
  owner.applyConfirm(s, owner.parseConfirmForm(params, s.listRobots()), T);
  check(owner.onboardingStep(s) === "setup", "after confirm the step is setup");

  const priced = owner.ownerModel(s, T).robots.find((r) => r.id === scrub.id);
  check(priced.fin.basis === "active_hour", "recategorized scrubber is priced by the hour");

  for (const r of owner.ownerModel(s, T).robots) {
    s.upsertRobotEconomics(
      r.id,
      {
        taskType: r.fin.taskType,
        taskBasis: r.fin.basis,
        rateCents: r.fin.rateCents,
        invoiceCentsMonth: 99_900,
        operatingHoursDay: 12,
      },
      T
    );
  }
  check(owner.onboardingStep(s) === "done", "after setup the step is done");

  const m = owner.ownerModel(s, T);
  check(Number.isFinite(m.totals.coverage) && m.totals.coverage > 0, `coverage is a real number (got ${m.totals.coverage})`);
  check(m.totals.workServicedCents > 0, "work serviced is non-zero");
  check(m.byType.length === 2, `two kinds of work priced separately (got ${m.byType.length})`);

  s.excludeRobot(scrub.id, T);
  check(owner.ownerModel(s, T).robots.length === 1, "excluded robot leaves the statement");

  s.close();
}

store.close();
if (failures.length > 0) {
  console.log(`\nFAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS: end-to-end pipeline verified");
process.exit(0);
