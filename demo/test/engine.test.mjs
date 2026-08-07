import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { createEngine, createClock } from "../src/engine.mjs";
import { createSimConnector } from "../src/connectors/sim.mjs";
import demoFleet from "../src/scenarios/demo-fleet.mjs";
import { loadConfig } from "../src/infra.mjs";

const START = Date.parse("2026-08-04T08:00:00-07:00");
const MIN = 60_000;
const DAY = 86_400_000;

test("full scenario: sim + engine produce snapshots, rollups, heartbeats, and the expected flags", async () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "engine.db"));
  const config = loadConfig();
  const logs = [];
  const engine = createEngine({
    store,
    connectors: [createSimConnector(demoFleet)],
    config,
    log: (msg, kind) => logs.push({ msg, kind }),
  });

  await engine.init(START);
  assert.equal(store.listRobots().length, 5, "fleet registered at init");

  // First 2 hours in 5-minute steps so the 12-minute outage is observed live,
  // then 5 sim-days in hourly steps for the slow-burn profiles.
  for (let t = START; t <= START + 2 * 60 * MIN; t += 5 * MIN) await engine.runOnce(t);
  for (let t = START + 3 * 60 * MIN; t <= START + 5 * DAY; t += 60 * MIN) await engine.runOnce(t);

  const robots = store.listRobots();
  const snapCount = robots.reduce((n, r) => n + store.snapshotsBetween(r.id, START, START + 5 * DAY).length, 0);
  assert.ok(snapCount > 30_000, `snapshots: ${snapCount}`);

  const declining = store.getRobotByKey("sim:sim-002");
  assert.ok(store.rollupsBetween(declining.id, START, START + 5 * DAY).length > 100, "rollups exist");
  assert.ok(store.heartbeatsBetween("sim", START, START + 5 * DAY).length > 100, "heartbeats exist");

  const all = store.allFlags();
  const byRule = (id) => all.filter((f) => f.rule_id === id);
  const ruleIds = new Set(all.map((f) => f.rule_id));

  // The five expected signals from the demo fleet:
  assert.ok(ruleIds.has("connector_down"), "connector_down raised during scripted outage");
  assert.ok(ruleIds.has("utilization_drop"), "utilization_drop raised for sim-002");
  assert.ok(ruleIds.has("stuck_state"), "stuck_state raised for sim-004");
  assert.ok(ruleIds.has("error_severity"), "error_severity raised for sim-003");
  assert.ok(ruleIds.has("battery_degradation"), "battery_degradation raised for sim-005");

  // The outage flag must have raised AND cleared (pipe recovered).
  assert.ok(byRule("connector_down").some((f) => f.status === "cleared"), "connector_down cleared after outage");

  // Heartbeat gating: no offline_duration flags — robots never went offline,
  // the only silence was the connector outage, which must be suppressed.
  assert.equal(byRule("offline_duration").length, 0, "no false offline flags from the outage");

  // Flags carry the right dimension and target.
  const util = byRule("utilization_drop").find((f) => f.status === "active") ?? byRule("utilization_drop")[0];
  assert.equal(util.dimension, "pd");
  assert.equal(util.robot_id, declining.id);
  const batt = byRule("battery_degradation")[0];
  assert.equal(batt.dimension, "lgd");

  // Genesis log lines fired for raises.
  assert.ok(logs.some((l) => l.msg.startsWith("flag raised:")), "raises logged");
});

test("watchdog: a throwing connector records a down heartbeat, engine survives", async () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "watchdog.db"));
  const broken = {
    name: "bear",
    async init() { return []; },
    async tick() { throw new Error("auth exploded"); },
    async stop() {},
  };
  const engine = createEngine({ store, connectors: [broken], config: loadConfig() });
  await engine.init(START);
  await engine.runOnce(START);
  const hb = store.latestHeartbeat("bear");
  assert.equal(hb.state, "down");
  assert.ok(hb.detail.includes("auth exploded"));
});

test("virtual clock scales sim time over real time", () => {
  let real = 1_000_000;
  const clock = createClock({ scale: 60, startMs: START, realNow: () => real });
  assert.equal(clock.now(), START);
  real += 1000; // 1 real second
  assert.equal(clock.now(), START + 60_000); // = 1 sim minute at 60x
});
