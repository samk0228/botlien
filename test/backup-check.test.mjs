import { test } from "node:test";
import assert from "node:assert/strict";
import { openControl } from "../src/control.mjs";
import { backupProblem, createBackupCheck, KV_BACKUP_VERIFIED } from "../src/backup-check.mjs";

const H = 3_600_000;
const NOON_UTC = Date.parse("2026-09-24T17:00:00Z"); // 10 AM Pacific, after the check hour

function setup({ markedHoursAgo = null, upHours = 72 } = {}) {
  const control = openControl(":memory:");
  if (markedHoursAgo !== null) control.setMeta(KV_BACKUP_VERIFIED, JSON.stringify({ at: NOON_UTC - markedHoursAgo * H, databases: 3 }));
  const sent = [], logs = [];
  const check = createBackupCheck({ control, mailer: { async send(m) { sent.push(m); return { ok: true }; } }, opsEmails: ["sam@botlien.com"], bootMs: NOON_UTC - upHours * H, log: (l, k) => logs.push([l, k]) });
  return { control, check, sent, logs };
}

test("a backup verified within a day and a half is fine", () => {
  const { control } = setup({ markedHoursAgo: 30 });
  assert.equal(backupProblem(control, { nowMs: NOON_UTC, bootMs: 0 }), null);
});

test("a stale backup emails ops once a day, with what to do", async () => {
  const { check, sent, logs } = setup({ markedHoursAgo: 14 * 24 });
  await check.tick(NOON_UTC);
  await check.tick(NOON_UTC + H);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "sam@botlien.com");
  assert.match(sent[0].text, /14 days 0 hours ago/);
  assert.match(sent[0].text, /fly auth login/);
  assert.equal(logs[0][1], "needs_user");
  await check.tick(NOON_UTC + 24 * H);
  assert.equal(sent.length, 2, "again the next day while it stays stale");
});

test("no mark at all is only a problem once the server has been up two days", async () => {
  assert.equal(backupProblem(setup({ upHours: 20 }).control, { nowMs: NOON_UTC, bootMs: NOON_UTC - 20 * H }), null);
  const { check, sent } = setup({ upHours: 49 });
  await check.tick(NOON_UTC);
  assert.match(sent[0].text, /No verified backup is on record/);
});

test("the check waits until after the nightly job's morning", async () => {
  const { check, sent } = setup({ markedHoursAgo: 100 });
  await check.tick(Date.parse("2026-09-24T12:00:00Z"));
  assert.equal(sent.length, 0);
});
