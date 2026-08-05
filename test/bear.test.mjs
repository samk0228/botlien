import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createBearConnector, createGrpcStreamFactory } from "../src/connectors/bear.mjs";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bear-status.json"), "utf8")
);

const NOW = Date.parse("2026-08-04T12:00:00-07:00");
const MIN = 60_000;
const CFG = { auth_url: "https://auth.test/authorize", rest_base: "https://api.test/v1", grpc_host: "api.test:443", token_refresh_margin_min: 5 };
const SECRETS = { credentials: { api_key: "test-key" } };

function fakeJwt(expMs) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expMs / 1000) })).toString("base64url");
  return `hdr.${payload}.sig`;
}

function fakeFetch({ authCalls = [], listCalls = [], authStatus = 200, tokenExpMs = NOW + 60 * MIN } = {}) {
  return async (url, opts = {}) => {
    if (url.includes("authorize")) {
      authCalls.push({ url, body: opts.body });
      return { ok: authStatus === 200, status: authStatus, json: async () => ({ token: fakeJwt(tokenExpMs) }) };
    }
    listCalls.push({ url, headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({ robot_ids: ["pennybot-abc123", "pennybot-def456"] }) };
  };
}

class FakeStream extends EventEmitter {
  cancel() {
    this.cancelled = true;
  }
}

test("init lists robots via REST with bearer token; stream drains through tick", async () => {
  const authCalls = [];
  const listCalls = [];
  let lastStream;
  const c = createBearConnector(CFG, SECRETS, {
    fetchImpl: fakeFetch({ authCalls, listCalls }),
    streamFactory: () => (lastStream = new FakeStream()),
  });

  const meta = await c.init();
  assert.equal(authCalls.length, 1);
  assert.ok(listCalls[0].headers.Authorization.startsWith("Bearer "));
  assert.deepEqual(meta.map((m) => m.externalId), ["pennybot-abc123", "pennybot-def456"]);
  assert.equal(meta[0].brand, "Bear");

  const first = await c.tick(NOW);
  assert.equal(first.heartbeat.state, "ok");
  assert.deepEqual(first.events, []);

  lastStream.emit("data", fixtures.healthy);
  lastStream.emit("data", fixtures.troubled);
  const second = await c.tick(NOW + 15_000);
  assert.equal(second.events.length, 2);
  assert.equal(second.events[0].externalId, "pennybot-abc123");
  assert.equal(second.events[0].status.connectionState, "online");
  assert.equal(second.events[1].status.eStop, true);
  assert.equal(second.heartbeat.state, "ok");
});

test("auth rejection → heartbeat down with detail, no crash", async () => {
  const c = createBearConnector(CFG, SECRETS, {
    fetchImpl: fakeFetch({ authStatus: 401 }),
    streamFactory: () => new FakeStream(),
  });
  await c.init(); // swallows failure, logs
  const res = await c.tick(NOW);
  assert.equal(res.heartbeat.state, "down");
  assert.ok(res.heartbeat.detail.includes("401"));
});

test("stream drop → degraded during backoff, reconnect after it, unreachable → down", async () => {
  let streams = [];
  let failMode = false;
  const c = createBearConnector(CFG, SECRETS, {
    fetchImpl: fakeFetch({}),
    streamFactory: () => {
      if (failMode) throw new Error("connect ECONNREFUSED");
      const s = new FakeStream();
      streams.push(s);
      return s;
    },
  });
  await c.init();
  await c.tick(NOW);
  assert.equal(streams.length, 1);

  // Drop the stream; a tick INSIDE the 10s backoff window shows degraded and
  // does not reconnect yet.
  streams[0].emit("error", new Error("UNAVAILABLE"));
  const dropped = await c.tick(NOW + 5_000);
  assert.equal(dropped.heartbeat.state, "degraded");
  assert.equal(streams.length, 1, "backoff prevents an instant reconnect");

  // Past the backoff window the reconnect fires and heals to ok.
  const reconnected = await c.tick(NOW + 12_000);
  assert.equal(streams.length, 2);
  assert.equal(reconnected.heartbeat.state, "ok");

  // Endpoint becomes unreachable: every open attempt fails → down after 5.
  failMode = true;
  streams[1].emit("error", new Error("UNAVAILABLE"));
  let t = NOW + 10 * MIN;
  let last;
  for (let i = 0; i < 6; i++) {
    last = await c.tick(t);
    t += 10 * MIN;
  }
  assert.equal(last.heartbeat.state, "down");
  assert.ok(last.heartbeat.detail.includes("failures"));

  // Endpoint returns → next attempt heals back to ok and resets the counter.
  failMode = false;
  const healed = await c.tick(t);
  assert.equal(healed.heartbeat.state, "ok");
});

test("token refresh: re-auths when expiry minus margin passes", async () => {
  const authCalls = [];
  const c = createBearConnector(CFG, SECRETS, {
    fetchImpl: fakeFetch({ authCalls, tokenExpMs: NOW + 30 * MIN }),
    streamFactory: () => new FakeStream(),
  });
  await c.init();
  assert.equal(authCalls.length, 1);
  await c.tick(NOW);
  assert.equal(authCalls.length, 1, "token still fresh");
  await c.tick(NOW + 26 * MIN); // inside the 5-minute refresh margin
  assert.equal(authCalls.length, 2, "re-authenticated before expiry");
});

test("vendored protos load and expose SubscribeRobotStatus", async (t) => {
  const protoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "bear");
  if (!existsSync(join(protoDir, "bearrobotics"))) {
    t.skip("protos not vendored");
    return;
  }
  const factory = await createGrpcStreamFactory(CFG, { protoDir });
  assert.equal(typeof factory, "function", "factory built: protos parsed and APIService found");
});

test("events buffered before a heartbeat-down tick are still delivered", async () => {
  let lastStream;
  const c = createBearConnector(CFG, SECRETS, {
    fetchImpl: fakeFetch({}),
    streamFactory: () => (lastStream = new FakeStream()),
  });
  await c.init();
  await c.tick(NOW);
  lastStream.emit("data", fixtures.healthy);
  lastStream.emit("error", new Error("UNAVAILABLE"));
  const res = await c.tick(NOW + 5_000); // inside the backoff window
  assert.equal(res.events.length, 1, "buffered event not lost on drop");
  assert.equal(res.heartbeat.state, "degraded");
});
