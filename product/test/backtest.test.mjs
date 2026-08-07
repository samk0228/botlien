import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { runBacktest, analyzeBacktest, formatReport } from "../scripts/backtest.mjs";
import { loadConfig } from "../src/infra.mjs";

const START = Date.parse("2026-05-01T08:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Robot A works normally for 7 days then goes quiet; payment missed at day 10.
// Robot B works normally the whole time with no outcome. If the rules mean
// anything, A gets flagged before its outcome and B stays clean.
function seedStore() {
  const s = openStore(":memory:");
  const importedAt = START + 90 * DAY;
  const a = s.upsertRobot({ connector: "import", externalId: "unit-A" }, importedAt);
  const b = s.upsertRobot({ connector: "import", externalId: "unit-B" }, importedAt);

  for (let h = 0; h < 10 * 24; h++) {
    const at = START + h * HOUR;
    const day = h / 24;
    // A: active 50% of hours until day 7, then idle. B: active 50% throughout.
    const aActive = day < 7 && h % 2 === 0;
    const bActive = h % 2 === 0;
    for (const [robotId, active] of [[a, aActive], [b, bActive]]) {
      s.insertSnapshot({
        robotId,
        at,
        receivedAt: importedAt,
        connector: "import",
        source: "import",
        connectionState: "online",
        batteryPct: 90,
        charging: false,
        eStop: false,
        missionState: active ? "active" : "idle",
        stuck: false,
        moving: active,
        errors: [],
        pose: null,
      });
    }
  }
  s.insertOutcome({ robotId: a, kind: "payment_missed", at: START + 10 * DAY, amountCents: 149900 }, importedAt);
  return { s, a, b };
}

test("backtest replay: decliner flagged before its outcome, healthy robot stays clean", async () => {
  const { s, a, b } = seedStore();
  const replay = await runBacktest(s, loadConfig(), { stepMs: 6 * HOUR });
  assert.ok(replay.steps > 30);

  const flags = s.allFlags();
  assert.ok(flags.some((f) => f.robot_id === a && f.rule_id === "utilization_drop"), "utilization_drop raised for the decliner");
  assert.ok(!flags.some((f) => f.robot_id === b), "healthy robot never flagged");

  const report = analyzeBacktest(s, { leadDays: 30 });
  assert.equal(report.recall.totalOutcomes, 1);
  assert.equal(report.recall.outcomesPrecededByFlag, 1, "the outcome was preceded by a flag");
  assert.equal(report.recall.rate, 1);
  assert.ok(report.recall.medianLeadDays > 0.5, `lead time ${report.recall.medianLeadDays} days`);
  assert.ok(report.precision.rate > 0, "flags on the decliner were followed by its outcome");
  assert.equal(report.contingency.flaggedWithOutcome, 1);
  assert.equal(report.contingency.unflaggedNoOutcome, 1);
  assert.equal(report.contingency.flaggedNoOutcome, 0);

  const text = formatReport(report, replay);
  assert.ok(text.includes("RECALL   1/1"));
  assert.ok(text.includes("utilization_drop"));
  assert.ok(text.includes("CAVEAT"), "small-sample caveat present");
  s.close();
});

test("analyze with no outcomes yields null rates, not crashes", async () => {
  const s = openStore(":memory:");
  const r = s.upsertRobot({ connector: "import", externalId: "solo" }, START);
  s.insertSnapshot({ robotId: r, at: START, receivedAt: START, connector: "import", source: "import", connectionState: "online", missionState: "idle" });
  await runBacktest(s, loadConfig(), { stepMs: DAY });
  const report = analyzeBacktest(s, {});
  assert.equal(report.recall.rate, null);
  assert.equal(report.recall.medianLeadDays, null);
  assert.ok(formatReport(report).includes("n/a"));
  s.close();
});
