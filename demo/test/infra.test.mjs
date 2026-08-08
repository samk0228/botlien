import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, genesisLog, resolvePath, ROOT } from "../src/infra.mjs";

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

// Regression: join(ROOT, "/data/x.db") yields "<root>/data/x.db", not
// "/data/x.db". On a container that is a directory inside the image rather than
// the mounted volume, so every uploaded byte is discarded on the next deploy
// with no error anywhere. Absolute paths must survive untouched.
test("resolvePath leaves absolute paths alone and roots relative ones", () => {
  assert.equal(resolvePath("/data/botlien.db"), "/data/botlien.db");
  assert.equal(resolvePath("/data/tenants"), "/data/tenants");
  assert.equal(resolvePath("data/botlien.db"), `${ROOT}/data/botlien.db`);
  assert.equal(resolvePath("data/tenants"), `${ROOT}/data/tenants`);
});
