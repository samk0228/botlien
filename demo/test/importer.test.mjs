import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store.mjs";
import { importTelemetry, importOutcomes, parseCSV } from "../src/importer.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const tempStore = () => openStore(join(mkdtempSync(join(tmpdir(), "botlien-")), "import.db"));

test("CSV telemetry: historical at, source=import, errors in both formats, bad rows skipped", () => {
  const s = tempStore();
  const res = importTelemetry(s, join(FIXTURES, "telemetry.csv"), { nowMs: NOW });
  assert.equal(res.rows, 5);
  assert.equal(res.imported, 4);
  assert.equal(res.skipped, 1); // badrow has no timestamp
  assert.deepEqual(res.robots.sort(), ["unit-7", "unit-9"]);

  const r7 = s.getRobotByKey("import:unit-7");
  const snaps = s.snapshotsBetween(r7.id, 0, NOW);
  assert.equal(snaps.length, 3);
  assert.equal(snaps[0].at, Date.parse("2026-05-01T09:00:00Z")); // historical event time
  assert.equal(snaps[0].received_at, NOW); // import time
  assert.equal(snaps[0].source, "import");
  // semicolon code list normalized to error objects
  assert.deepEqual(JSON.parse(snaps[1].errors).map((e) => e.code), ["E210", "E105"]);

  // quoted CSV with embedded JSON errors and comma inside quotes
  const r9 = s.getRobotByKey("import:unit-9");
  const snap9 = s.latestSnapshot(r9.id);
  assert.equal(snap9.mission_state, "idle, mostly");
  assert.deepEqual(JSON.parse(snap9.errors), [{ code: "bear:E900", severity: "CRITICAL" }]);
  assert.equal(snap9.stuck, 1);
});

test("JSONL telemetry: online bool → connection_state, epoch ms accepted", () => {
  const s = tempStore();
  const res = importTelemetry(s, join(FIXTURES, "telemetry.jsonl"), { nowMs: NOW });
  assert.equal(res.imported, 2);
  assert.equal(res.skipped, 1); // row without external_id
  const r = s.getRobotByKey("import:unit-12");
  const snaps = s.snapshotsBetween(r.id, 0, NOW);
  assert.equal(snaps[0].connection_state, "online");
  assert.equal(snaps[1].connection_state, "offline");
  assert.equal(snaps[1].at, 1778068860000);
  assert.equal(snaps[0].battery_pct, 72.5);
});

test("outcomes: robot-linked and account-level, dollar amounts to cents", () => {
  const s = tempStore();
  importTelemetry(s, join(FIXTURES, "telemetry.csv"), { nowMs: NOW });
  const res = importOutcomes(s, join(FIXTURES, "outcomes.csv"), { nowMs: NOW });
  assert.equal(res.imported, 4);
  const outcomes = s.listOutcomes();
  const late = outcomes.find((o) => o.kind === "payment_late");
  assert.equal(late.robot_id, s.getRobotByKey("import:unit-7").id);
  assert.equal(late.amount_cents, 149900);
  assert.equal(late.at, Date.parse("2026-05-15"));
  const accountDefault = outcomes.find((o) => o.kind === "default");
  assert.equal(accountDefault.robot_id, null);
  assert.equal(accountDefault.source_file, "outcomes.csv");
});

test("parseCSV handles quotes, escaped quotes, CRLF", () => {
  const rows = parseCSV('a,b\r\n"x,y","say ""hi"""\r\nplain,2\r\n');
  assert.deepEqual(rows, [
    { a: "x,y", b: 'say "hi"' },
    { a: "plain", b: "2" },
  ]);
});
