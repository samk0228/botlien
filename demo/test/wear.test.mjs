// Asset-condition path: Gausium status → normalized wear/condition → store →
// rules → board model. The rules here are the ones that carry the product's
// actual claim (collateral condition is measurable), so they get the coverage.
import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { normalizeGausiumStatus, extractWear, validateStatus } from "../src/normalize.mjs";
import { RULES, ruleParams } from "../src/rules.mjs";
import { boardModel, renderBoardHTML } from "../src/board.mjs";
import { createGausiumConnector } from "../src/connectors/gausium.mjs";
import { createSimConnector } from "../src/connectors/sim.mjs";
import demoFleet from "../src/scenarios/demo-fleet.mjs";
import { readFileSync } from "node:fs";

const NOW = 1_760_000_000_000;
const MIN = 60_000;
const DAY = 86_400_000;

const rule = (id) => RULES.find((r) => r.id === id);
const evalRule = (id, ctx, overrides = {}) => {
  const r = rule(id);
  return r.eval(ctx, { ...ruleParams(r, {}, null), ...overrides });
};

const gausiumStatus = (over = {}) => ({
  serialNumber: "GS-A-001",
  online: true,
  taskState: "IDLE",
  navStatus: "NAVI_IDLE",
  speedKilometerPerHour: 0,
  latestReportTime: NOW,
  manualControlling: false,
  battery: { charging: true, powerPercentage: 87, voltage: 51.4, current: 12.2, temperature: 31.5 },
  emergencyStop: { enabled: false },
  localizationInfo: { state: "LOCALIZED", worldX: 12.5, worldY: -3.25 },
  currentTask: { workMode: "SCRUB", taskInstanceId: "task-991" },
  device: {
    rollingBrush: { enabled: true, lifeSpan: 400, usedLife: 100 },
    squeegee: { enabled: true, lifeSpan: 250, usedLife: 245 },
    filter: { enabled: true, lifeSpan: 300, usedLife: 330 },
    cleanWaterTank: { level: 62, enabled: true },
  },
  ...over,
});

test("normalizeGausiumStatus maps status, condition and wear", () => {
  const s = normalizeGausiumStatus(gausiumStatus());
  assert.deepEqual(validateStatus(s), []);
  assert.equal(s.externalId, "GS-A-001");
  assert.equal(s.at, NOW);
  assert.equal(s.connectionState, "online");
  assert.equal(s.batteryPct, 87);
  assert.equal(s.charging, true);
  assert.equal(s.eStop, false);
  assert.equal(s.missionState, "idle");
  // The peer session's rollup counts distinct mission ids, so this must be set.
  assert.equal(s.missionId, "task-991");
  assert.equal(s.moving, false);
  assert.deepEqual(s.pose, { x: 12.5, y: -3.25, theta: null });
  assert.equal(s.condition.batteryTempC, 31.5);
  assert.equal(s.condition.localizationState, "LOCALIZED");
  assert.equal(s.condition.manualControlling, false);
});

test("wear extraction canonicalizes vendor part names and computes remaining life", () => {
  const wear = normalizeGausiumStatus(gausiumStatus()).wear;
  const by = Object.fromEntries(wear.map((w) => [w.component, w]));
  assert.equal(by.rolling_brush.remainingPct, 75);
  assert.equal(by.squeegee.remainingPct, 2);
  // suctionBlade/scraper/rollingBrush all collapse onto one canonical name.
  assert.equal(extractWear({ suctionBlade: { lifeSpan: 10, usedLife: 5 } })[0].component, "squeegee");
  // A tank reports fill level but has no rated life; it must not be invented.
  assert.equal(by.clean_water_tank.remainingPct, null);
  assert.equal(by.clean_water_tank.levelPct, 62);
});

test("a part past its rated life reports negative remaining, not clamped to zero", () => {
  const by = Object.fromEntries(normalizeGausiumStatus(gausiumStatus()).wear.map((w) => [w.component, w]));
  // 330 used against a 300 life = 10% over. Clamping this to 0 would erase the
  // difference between "spent" and "run 10% past spec", which is the whole
  // point of the signal.
  assert.equal(Math.round(by.filter.remainingPct), -10);
});

test("unknown components pass through as snake_case rather than being dropped", () => {
  const wear = extractWear({ someNewPart: { lifeSpan: 100, usedLife: 20 }, nested: { deepPart: { lifeSpan: 50, usedLife: 25 } } });
  const names = wear.map((w) => w.component).sort();
  assert.deepEqual(names, ["deep_part", "some_new_part"]);
});

test("consumable_exhaustion: crit past life, warn near it, silent when healthy", () => {
  const wear = (remaining) => remaining.map((p, i) => ({ component: `p${i}`, remaining_pct: p }));
  assert.equal(evalRule("consumable_exhaustion", { wear: wear([80, 60]) }), null);
  assert.equal(evalRule("consumable_exhaustion", { wear: wear([80, 9]) }).severity, "warn");
  assert.equal(evalRule("consumable_exhaustion", { wear: wear([80, -10]) }).severity, "crit");
  // Components with no rated life must not be read as zero remaining.
  assert.equal(evalRule("consumable_exhaustion", { wear: [{ component: "tank", remaining_pct: null }] }), null);
  assert.equal(evalRule("consumable_exhaustion", { wear: [] }), null);
});

test("deferred_maintenance fires only when a robot with spent parts is still working", () => {
  const spent = [
    { component: "squeegee", remaining_pct: -5 },
    { component: "filter", remaining_pct: 0 },
    { component: "brush", remaining_pct: 40 },
  ];
  const working = [{ bucket_start_at: NOW - MIN, active_ms: 3 * 3_600_000 }];
  const parked = [{ bucket_start_at: NOW - MIN, active_ms: 60_000 }];

  const hit = evalRule("deferred_maintenance", { wear: spent, rollups: working, nowMs: NOW });
  assert.equal(hit.severity, "warn");
  assert.equal(hit.evidence.spent_parts, 2);

  // Parked with spent parts is a storage decision, not distress.
  assert.equal(evalRule("deferred_maintenance", { wear: spent, rollups: parked, nowMs: NOW }), null);
  // One spent part is wear, not a spending pattern.
  assert.equal(
    evalRule("deferred_maintenance", { wear: [spent[0]], rollups: working, nowMs: NOW }),
    null
  );
});

test("manual_operation needs enough samples before it will speak", () => {
  const conds = (n, manualCount) =>
    Array.from({ length: n }, (_, i) => ({ manual_controlling: i < manualCount ? 1 : 0 }));
  assert.equal(evalRule("manual_operation", { conditions24h: conds(10, 10) }), null, "too few samples");
  assert.equal(evalRule("manual_operation", { conditions24h: conds(100, 5) }), null);
  assert.equal(evalRule("manual_operation", { conditions24h: conds(100, 40) }).severity, "warn");
  assert.equal(evalRule("manual_operation", { conditions24h: conds(100, 70) }).severity, "crit");
  // Robots that never report the field must never be flagged on it.
  assert.equal(
    evalRule("manual_operation", { conditions24h: Array.from({ length: 100 }, () => ({ manual_controlling: null })) }),
    null
  );
});

test("store round-trips wear and condition, and latestComponentWear reads one instant", () => {
  const store = openStore(":memory:");
  const robotId = store.upsertRobot({ connector: "gausium", externalId: "GS-A-001" }, NOW);
  const s = normalizeGausiumStatus(gausiumStatus());
  const snapshotId = store.insertSnapshot({
    robotId, at: s.at, receivedAt: NOW, connector: "gausium", source: "live",
    connectionState: s.connectionState, batteryPct: s.batteryPct,
  });
  store.insertCondition({ snapshotId, robotId, at: s.at, ...s.condition });
  store.insertComponentWear(robotId, s.at - DAY, s.wear);
  store.insertComponentWear(robotId, s.at, s.wear);

  const latest = store.latestComponentWear(robotId);
  assert.equal(latest.length, 4, "one row per component, from the newest reading only");
  assert.ok(latest.every((w) => w.at === s.at));
  assert.equal(store.latestCondition(robotId).battery_temp_c, 31.5);
  assert.equal(store.conditionsBetween(robotId, NOW - DAY, NOW).length, 1);

  // Re-reading the same instant must not duplicate rows.
  store.insertComponentWear(robotId, s.at, s.wear);
  assert.equal(store.latestComponentWear(robotId).length, 4);
  store.close();
});

test("board surfaces wear bars, the parts-past-life count, and survives fleets with no wear", () => {
  const store = openStore(":memory:");
  const gs = store.upsertRobot({ connector: "gausium", externalId: "GS-A-001", displayName: "Scrubber 50" }, NOW);
  const bear = store.upsertRobot({ connector: "bear", externalId: "B-1", displayName: "Servi 1" }, NOW);
  const s = normalizeGausiumStatus(gausiumStatus());
  for (const id of [gs, bear]) {
    store.insertSnapshot({ robotId: id, at: NOW, receivedAt: NOW, connector: "x", source: "live", connectionState: "online", batteryPct: 80 });
  }
  store.insertComponentWear(gs, NOW, s.wear);
  store.insertCondition({ snapshotId: 1, robotId: gs, at: NOW, ...s.condition, manualControlling: true });

  const m = boardModel(store, NOW);
  // filter is 10% over its life; squeegee at 2% is warn, not spent.
  assert.equal(m.summary.spentParts, 1);
  const scrubber = m.robots.find((r) => r.name === "Scrubber 50");
  assert.equal(scrubber.wear.length, 4);
  assert.equal(scrubber.manualControlling, true);
  assert.equal(m.robots.find((r) => r.name === "Servi 1").wear.length, 0);

  const html = renderBoardHTML(m);
  assert.match(html, /Asset condition/);
  assert.match(html, /rolling_brush/);
  assert.match(html, /10% over/, "overrun is labelled, not shown as 0%");
  assert.match(html, /parts past life/);
  store.close();
});

test("board omits the condition panel entirely when no robot reports wear", () => {
  const store = openStore(":memory:");
  const id = store.upsertRobot({ connector: "bear", externalId: "B-1" }, NOW);
  store.insertSnapshot({ robotId: id, at: NOW, receivedAt: NOW, connector: "bear", source: "live", connectionState: "online" });
  const m = boardModel(store, NOW);
  assert.equal(m.summary.spentParts, null, "null, not 0 — nothing reports wear at all");
  assert.doesNotMatch(renderBoardHTML(m), /Asset condition/);
  store.close();
});

test("the demo's worn cleaner actually runs parts past life, with margin over crit", async () => {
  // The OTHER half of the coupling that test/sim.test.mjs guards. That test
  // proves the demo cleaners work hard enough for the rules to speak; this one
  // proves they are actually worn enough to have something to say. Duty and
  // wear are set in two different places — a scenario duty cycle and headStart
  // in simWear() — and either one alone can take the asset-condition story off
  // the risk board with every other test still green.
  //
  // Thresholds are read from config, never hard-coded, so retuning the rule and
  // retuning the simulator cannot drift apart without something failing here.
  const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  const critSpent = config.rules.deferred_maintenance.crit_spent_parts;

  const worn = demoFleet.robots.find((r) => r.profile === "worn_parts");
  assert.ok(worn, "the demo fleet needs a worn_parts cleaner for the LGD story");

  const c = createSimConnector(demoFleet);
  await c.init();
  await c.tick(NOW);
  const later = await c.tick(NOW + 3 * DAY);
  const last = later.events.filter((e) => e.externalId === worn.externalId).pop();
  assert.ok(last?.status.wear?.length, "worn cleaner must report wear");

  const spent = last.status.wear.filter((w) => w.remainingPct <= 0);
  assert.ok(
    spent.length > critSpent,
    `${worn.displayName} has ${spent.length} parts past life against a crit threshold of ` +
      `${critSpent}; with no margin, any change to the activity model or to headStart in ` +
      `simWear() silently downgrades the demo's deferred_maintenance flag`
  );

  // A healthy cleaner must NOT be swept up by the same wear model, or the
  // contrast the board is built on disappears and every scrubber looks doomed.
  const healthy = demoFleet.robots.find((r) => r.category === "cleaning" && r.profile !== "worn_parts");
  if (healthy) {
    const hl = later.events.filter((e) => e.externalId === healthy.externalId).pop();
    assert.ok(
      hl.status.wear.every((w) => w.remainingPct > 0),
      `${healthy.displayName} should have life left in every part`
    );
  }
});

// ---- connector ----

function fakeGausium({ failStatus = false, failAuth = false } = {}) {
  const calls = { auth: 0, list: 0, status: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.pathname.endsWith("/oauth/token")) {
      calls.auth += 1;
      if (failAuth) return { ok: false, status: 401, json: async () => ({}) };
      const body = JSON.parse(init.body);
      assert.equal(body.grant_type, "urn:gaussian:params:oauth:grant-type:open-access-token");
      return json({ access_token: "tok", expires_in: NOW + 3600_000, token_type: "bearer" });
    }
    assert.equal(init.headers.Authorization, "Bearer tok");
    if (u.pathname === "/v1alpha1/robots") {
      calls.list += 1;
      return json({ robots: [{ serialNumber: "GS-A-001", displayName: "Scrubber 50", modelTypeCode: "S50" }], total: "1" });
    }
    if (u.pathname.endsWith("/status")) {
      calls.status += 1;
      if (failStatus) return { ok: false, status: 500, json: async () => ({}) };
      return json(gausiumStatus());
    }
    throw new Error(`unexpected ${u.pathname}`);
  };
  return { fetchImpl, calls };
}

test("gausium connector: init lists robots, tick yields normalized status with wear", async () => {
  const { fetchImpl, calls } = fakeGausium();
  const c = createGausiumConnector({ poll_sec: 60 }, { client_id: "a", client_secret: "b", open_access_key: "c" }, { fetchImpl });

  const meta = await c.init();
  assert.deepEqual(meta, [{ externalId: "GS-A-001", displayName: "Scrubber 50", brand: "Gausium", model: "S50", category: "cleaning" }]);

  const first = await c.tick(NOW);
  assert.equal(first.heartbeat.state, "ok");
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].status.wear.length, 4);
  assert.equal(first.events[0].status.condition.batteryTempC, 31.5);

  // Polling is rate-limited: a tick inside the interval must not re-read.
  const soon = await c.tick(NOW + 5_000);
  assert.equal(soon.events.length, 0);
  assert.equal(calls.status, 1);

  await c.tick(NOW + 61_000);
  assert.equal(calls.status, 2);
  assert.equal(calls.auth, 1, "token reused until it nears expiry");
  await c.stop();
});

test("gausium connector: auth rejection is down, status failure is degraded", async () => {
  const bad = createGausiumConnector({}, {}, { fetchImpl: fakeGausium({ failAuth: true }).fetchImpl });
  await bad.init();
  assert.equal((await bad.tick(NOW)).heartbeat.state, "down");

  const flaky = createGausiumConnector({ poll_sec: 0 }, {}, { fetchImpl: fakeGausium({ failStatus: true }).fetchImpl });
  await flaky.init();
  const r = await flaky.tick(NOW);
  assert.equal(r.events.length, 0);
  assert.equal(r.heartbeat.state, "degraded");
});
