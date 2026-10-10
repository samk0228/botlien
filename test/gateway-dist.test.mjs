import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayAsset, GATEWAY_FILES } from "../src/gateway-dist.mjs";
import { startBoard } from "../src/board.mjs";

test("the installers carry this server's address, and only the gateway's own files can be fetched", () => {
  const sh = gatewayAsset("/gateway/install.sh", "https://app.botlien.com/");
  assert.match(sh.body, /BOTLIEN="https:\/\/app\.botlien\.com"/);
  assert.doesNotMatch(sh.body, /__BOTLIEN__/);
  assert.match(gatewayAsset("/gateway/install.ps1", "https://app.botlien.com").body, /\$Botlien = 'https:\/\/app\.botlien\.com'/);
  for (const f of GATEWAY_FILES) assert.match(gatewayAsset(`/gateway/files/${f}`, "x").body, /./, f);
  for (const bad of ["/gateway/files/fake-ursim.mjs", "/gateway/files/../../src/auth.mjs", "/gateway/files/..%2Fsrc%2Fauth.mjs", "/gateway/files/config.example.json", "/gateway/README.md", "/gateway/"]) {
    assert.equal(gatewayAsset(bad, "https://app.botlien.com"), null, bad);
  }
  assert.equal(gatewayAsset("/gateway/install.sh", "javascript:alert(1)"), null, "no address it cannot trust is written in");
});

test("over HTTP the gateway downloads need no session", async () => {
  process.env.BOTLIEN_BASE_URL = "https://app.botlien.com";
  const server = startBoard(0, { getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sh = await fetch(`${base}/gateway/install.sh`);
    assert.equal(sh.status, 200);
    assert.match(await sh.text(), /Read only\. It can never move or change a robot\./);
    assert.equal((await fetch(`${base}/gateway/files/gateway.mjs`)).status, 200);
    assert.equal((await fetch(`${base}/gateway/files/store.mjs`)).status, 404);
  } finally {
    server.close();
    await new Promise((r) => server.once("close", r));
  }
});
