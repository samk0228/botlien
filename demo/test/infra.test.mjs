import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, genesisLog } from "../src/infra.mjs";

test("loadConfig parses config.json with expected sections", () => {
  const cfg = loadConfig();
  assert.equal(typeof cfg.board.port, "number");
  assert.equal(typeof cfg.engine.tick_ms, "number");
  assert.ok(cfg.rules.offline_duration.warn_min > 0);
  assert.ok(cfg.bear.auth_url.startsWith("https://"));
});

test("genesisLog is a no-op under BOTLIEN_NO_GENESIS", () => {
  const calls = [];
  const spy = (...args) => calls.push(args);
  genesisLog("should not fire", "info", spy); // npm test sets BOTLIEN_NO_GENESIS=1
  assert.equal(calls.length, 0);
});

test("genesisLog invokes genesis-log with source botlien when enabled", () => {
  delete process.env.BOTLIEN_NO_GENESIS;
  try {
    const calls = [];
    const spy = (bin, args) => calls.push({ bin, args });
    genesisLog("flag raised: offline_duration on sim:sim-001", "needs_user", spy);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].bin.endsWith("genesis-log"));
    assert.deepEqual(calls[0].args, [
      "botlien",
      "flag raised: offline_duration on sim:sim-001",
      "needs_user",
    ]);
  } finally {
    process.env.BOTLIEN_NO_GENESIS = "1";
  }
});
