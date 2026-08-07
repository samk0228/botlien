import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";
import { boardModel, renderBoardHTML, esc } from "../src/board.mjs";

const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const MIN = 60_000;

function seededStore() {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "board.db"));
  const r1 = s.upsertRobot({ connector: "sim", externalId: "r1", displayName: "Servi 1", brand: "Bear", model: "Servi" }, NOW - 60 * MIN);
  const r2 = s.upsertRobot({ connector: "sim", externalId: "r2", displayName: "<script>alert(1)</script>", brand: "Pudu" }, NOW - 60 * MIN);
  s.insertSnapshot({ robotId: r1, at: NOW - 2 * MIN, receivedAt: NOW - 2 * MIN, connector: "sim", source: "sim", connectionState: "online", batteryPct: 76, missionState: "active", stuck: false });
  s.insertSnapshot({ robotId: r2, at: NOW - 50 * MIN, receivedAt: NOW - 50 * MIN, connector: "sim", source: "sim", connectionState: "offline", batteryPct: 12, missionState: "idle", stuck: false });
  s.raiseFlag({ scope: "robot:sim:r2", robotId: r2, ruleId: "offline_duration", dimension: "pd", severity: "crit", raisedAt: NOW - 30 * MIN, detail: { offline_min: 48 } });
  s.raiseFlag({ scope: "robot:sim:r1", robotId: r1, ruleId: "battery_degradation", dimension: "lgd", severity: "warn", raisedAt: NOW - 10 * MIN, detail: { fade_pct: 17 } });
  s.raiseFlag({ scope: "connector:sim", connector: "sim", ruleId: "connector_down", dimension: "infra", severity: "warn", raisedAt: NOW - 5 * MIN, detail: { down_min: 6 } });
  s.insertHeartbeat({ connector: "sim", at: NOW - 2 * MIN, state: "ok" });
  s.insertHeartbeat({ connector: "sim", at: NOW - MIN, state: "down", detail: "test" });
  return s;
}

test("boardModel: summary, per-robot flags, dimension grouping, heartbeat strip", () => {
  const s = seededStore();
  const m = boardModel(s, NOW);
  assert.equal(m.summary.robotCount, 2);
  assert.equal(m.summary.onlineCount, 1);
  assert.equal(m.summary.activeFlags, 3);
  assert.equal(m.summary.critFlags, 1);
  assert.equal(m.demo, true);

  assert.equal(m.flags.pd.length, 1);
  assert.equal(m.flags.lgd.length, 1);
  assert.equal(m.flags.infra.length, 1);
  assert.equal(m.flags.pd[0].target, "<script>alert(1)</script>"); // raw in model, escaped in HTML

  const r1 = m.robots.find((r) => r.key === "sim:r1");
  assert.equal(r1.worstSeverity, "warn");
  assert.equal(r1.flagCount, 1);
  const hb = m.heartbeats.find((h) => h.connector === "sim");
  assert.equal(hb.state, "down");
  assert.deepEqual(hb.recent, ["ok", "down"]);
});

test("renderBoardHTML: escapes hostile names, shows rules, demo badge, sections", () => {
  const s = seededStore();
  const html = renderBoardHTML(boardModel(s, NOW));
  assert.ok(!html.includes("<script>alert(1)</script>"), "hostile robot name is escaped");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("offline_duration"));
  assert.ok(html.includes("battery_degradation"));
  assert.ok(html.includes("connector_down"));
  assert.ok(html.includes("DEMO"));
  assert.ok(html.includes("PD signals"));
  assert.ok(html.includes("LGD signals"));
  assert.ok(html.includes("Data pipe"));
  assert.ok(html.includes("offline_min=48"));
});

test("esc handles quotes and ampersands", () => {
  assert.equal(esc(`a&b<c>"d"`), "a&amp;b&lt;c&gt;&quot;d&quot;");
  assert.equal(esc(null), "");
});

test("empty store renders without crashing", () => {
  const s = openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "empty.db"));
  const html = renderBoardHTML(boardModel(s, NOW));
  assert.ok(html.includes("no connectors yet"));
  assert.ok(html.includes("clear"));
});
