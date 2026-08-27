// OrionStar connector and normaliser, tested against the vendor's own
// published response examples. No network, no credentials, fixed clock.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. These fixtures are transcribed from
// OrionStar's documentation, so the tests prove our parsing is right about what
// the docs say. They cannot prove the docs are right about the platform. Auth
// from an allowlisted IP, real rate limits, pagination on a large fleet, and
// whether expires_time is populated in practice are all unknown until a real
// credential exists. Treat green here as "ready to plug in", not "integrated".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOrionStarConnector, categoryForModel, REGIONS } from "../src/connectors/orionstar.mjs";
import { normalizeOrionStarStatus, validateStatus, toEpochMs } from "../src/normalize.mjs";

const robotInfo = JSON.parse(readFileSync(new URL("./fixtures/orionstar-robot-info.json", import.meta.url), "utf8"));
const usage = JSON.parse(readFileSync(new URL("./fixtures/orionstar-usage.json", import.meta.url), "utf8"));

const NOW = Date.parse("2026-08-25T12:00:00Z");

/* A fetch that answers from a route table and records what was asked. Every
 * OrionStar response is HTTP 200 with a body-level code, which is exactly the
 * failure mode worth simulating. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, async json() { return body; } };
      }
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  impl.calls = calls;
  return impl;
}

const AUTH_OK = ["/v1/auth/get_token", { code: 0, msg: "", data: { access_token: "T.test-token", expires_in: "7200" } }];
const LIST_OK = ["/v1/robot/robot_list", { code: 0, msg: "", data: { list: [{ robot_sn: "test_sn", robot_name: "Picker 1", robot_model: "OS-R-D100" }], total: 1 } }];
const INFO_OK = ["/v1/robot/robot_info", robotInfo];

test("a documented status normalises into a valid canonical status", () => {
  const s = normalizeOrionStarStatus(robotInfo.data, { at: NOW });
  assert.deepEqual(validateStatus(s), [], "should have no validation problems");
  assert.equal(s.externalId, "test_sn");
  assert.equal(s.connectionState, "online");
  assert.equal(s.batteryPct, 85);
});

test('0/1 flags arrive as strings, and "0" must not read as true', () => {
  const s = normalizeOrionStarStatus(robotInfo.data, { at: NOW });
  // The fixture has is_charging "0" and emergency "0". Plain coercion would
  // make both true, since "0" is a non-empty string.
  assert.equal(s.charging, false, 'is_charging "0" must be false, not truthy');
  assert.equal(s.eStop, false, 'emergency "0" must be false, not truthy');

  const charging = structuredClone(robotInfo.data);
  charging.robot_report_status.battery.is_charging = "1";
  assert.equal(normalizeOrionStarStatus(charging, { at: NOW }).charging, true);

  const missing = structuredClone(robotInfo.data);
  delete missing.robot_report_status.battery.is_charging;
  assert.equal(normalizeOrionStarStatus(missing, { at: NOW }).charging, null, "absent is unknown, not false");
});

test("epoch seconds arriving as a string are parsed, not dropped", () => {
  // Date.parse("1712046236") is NaN, so before this was handled every OrionStar
  // timestamp became null and every status silently fell back to poll time.
  assert.equal(toEpochMs("1712046236"), 1712046236000);
  assert.equal(toEpochMs(1712046236), 1712046236000);
  assert.equal(toEpochMs("2026-08-25T12:00:00Z"), Date.parse("2026-08-25T12:00:00Z"));
  assert.equal(toEpochMs("not a date"), null);
});

test("the robot's own report time is preferred over the time we asked", () => {
  const s = normalizeOrionStarStatus(robotInfo.data, { at: NOW });
  assert.equal(s.at, 1712046236000, "should use battery.update_time, not the poll clock");
  assert.notEqual(s.at, NOW);

  const noReport = structuredClone(robotInfo.data);
  delete noReport.robot_report_status;
  assert.equal(normalizeOrionStarStatus(noReport, { at: NOW }).at, NOW, "falls back to poll time when nothing reported");
});

test("lease expiry is carried through when the vendor sends it", () => {
  // This is the reason this vendor is interesting: the cost side's timing
  // arrives from the robot API, not from the operator.
  const leased = structuredClone(robotInfo.data);
  leased.robot.expires_time = "1735689600";
  const s = normalizeOrionStarStatus(leased, { at: NOW });
  assert.equal(s.condition.leaseExpiresAt, 1735689600000);

  // Documented as "valid only for leased robots", so an owned unit reports
  // nothing and must not be read as expiring at the epoch.
  const owned = normalizeOrionStarStatus(robotInfo.data, { at: NOW });
  assert.equal(owned.condition.leaseExpiresAt, null);
});

test("task keys map to canonical mission states, and unknown keys stay null", () => {
  const cases = [
    ["6YCB6aSQ5Lit", "active"],   // delivery in progress
    ["5YWF55S15Lit", "charging"], // charging
    ["56m66Zey", "idle"],         // idle
    ["5oCl5YGc", "failed"],       // emergency stop
    ["5byC5bi4", "failed"],       // abnormal
  ];
  for (const [key, expected] of cases) {
    const d = structuredClone(robotInfo.data);
    d.robot_report_status.task_info.task_key = key;
    assert.equal(normalizeOrionStarStatus(d, { at: NOW }).missionState, expected, `task_key ${key}`);
  }
  // The docs say the robot reports other states that can be ignored. Guessing
  // one into "active" would inflate the work a period is credited with.
  const weird = structuredClone(robotInfo.data);
  weird.robot_report_status.task_info.task_key = "definitely-not-a-documented-key";
  assert.equal(normalizeOrionStarStatus(weird, { at: NOW }).missionState, null);
});

test("localisation failure reads as stuck, and ready reads as not stuck", () => {
  const ready = normalizeOrionStarStatus(robotInfo.data, { at: NOW });
  assert.equal(ready.stuck, false);

  const lost = structuredClone(robotInfo.data);
  lost.robot_report_status.location.state = "get_lost";
  assert.equal(normalizeOrionStarStatus(lost, { at: NOW }).stuck, true);

  const silent = structuredClone(robotInfo.data);
  delete silent.robot_report_status.location;
  assert.equal(normalizeOrionStarStatus(silent, { at: NOW }).stuck, null, "no report is unknown, not false");
});

test("CarryBot is priced as warehouse work, LuckiBot as delivery, unknown asks", () => {
  assert.equal(categoryForModel("OS-R-D100"), "putaway", "CarryBot D100 is the warehouse AMR");
  assert.equal(categoryForModel("CarryBot 2"), "putaway");
  assert.equal(categoryForModel("OS-R-DR01S"), "delivery", "DR01S is the LuckiBot in the docs");
  assert.equal(categoryForModel("something-new"), null, "unknown model must not inherit a wage");
  assert.equal(categoryForModel(null), null);
});

test("init lists the fleet and stamps brand, model and category", async () => {
  const c = createOrionStarConnector({ region: "us" }, { app_id: "a", app_secret: "b", ov_corpid: "corp" },
    { fetchImpl: fakeFetch([AUTH_OK, LIST_OK, INFO_OK]) });
  const fleet = await c.init();
  assert.equal(fleet.length, 1);
  assert.deepEqual(fleet[0], {
    externalId: "test_sn",
    displayName: "Picker 1",
    brand: "OrionStar",
    model: "OS-R-D100",
    category: "putaway",
  });
});

test("tick emits one event per robot, carrying the raw payload alongside", async () => {
  const c = createOrionStarConnector({ region: "us", poll_sec: 60 }, { app_id: "a", app_secret: "b", ov_corpid: "corp" },
    { fetchImpl: fakeFetch([AUTH_OK, LIST_OK, INFO_OK]) });
  await c.init();
  const { events, heartbeat } = await c.tick(NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].externalId, "test_sn");
  assert.equal(events[0].status.batteryPct, 85);
  assert.ok(events[0].raw, "raw vendor payload is kept for replay");
  assert.equal(heartbeat.state, "ok");
});

test("poll cadence is respected: a second tick inside the window reads nothing", async () => {
  const fetchImpl = fakeFetch([AUTH_OK, LIST_OK, INFO_OK]);
  const c = createOrionStarConnector({ region: "us", poll_sec: 60 }, { app_id: "a", app_secret: "b", ov_corpid: "corp" }, { fetchImpl });
  await c.init();
  await c.tick(NOW);
  const before = fetchImpl.calls.length;
  const second = await c.tick(NOW + 5_000);
  assert.equal(second.events.length, 0);
  assert.equal(fetchImpl.calls.length, before, "no HTTP inside the poll window");
  const third = await c.tick(NOW + 61_000);
  assert.equal(third.events.length, 1, "polls again once the window has passed");
});

test("a body-level auth rejection is down, not an empty fleet", async () => {
  // The trap this vendor sets: HTTP 200 with code 40001 in the body. Trusting
  // res.ok would report a healthy pipe watching zero robots, and "zero robots"
  // is indistinguishable from "the fleet is fine and idle".
  const c = createOrionStarConnector({ region: "us" }, { app_id: "bad", app_secret: "bad" },
    { fetchImpl: fakeFetch([["/v1/auth/get_token", { code: 40001, msg: "invalid app_secret" }]]) });
  await c.init();
  const { events, heartbeat } = await c.tick(NOW);
  assert.equal(events.length, 0);
  assert.equal(heartbeat.state, "down");
  assert.match(heartbeat.detail, /40001|invalid app_secret/);
});

test("one unreadable robot is a robot problem, not a pipe problem", async () => {
  const twoRobots = { code: 0, msg: "", data: { list: [
    { robot_sn: "good_sn", robot_name: "A", robot_model: "OS-R-D100" },
    { robot_sn: "bad_sn", robot_name: "B", robot_model: "OS-R-D100" },
  ], total: 2 } };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("/v1/auth/get_token")) return { ok: true, status: 200, async json() { return AUTH_OK[1]; } };
    if (u.includes("/v1/robot/robot_list")) return { ok: true, status: 200, async json() { return twoRobots; } };
    if (u.includes("robot_sn=bad_sn")) return { ok: false, status: 500, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return robotInfo; } };
  };
  const c = createOrionStarConnector({ region: "us" }, { app_id: "a", app_secret: "b" }, { fetchImpl });
  await c.init();
  const { events, heartbeat } = await c.tick(NOW);
  assert.equal(events.length, 1, "the readable robot still reports");
  assert.equal(heartbeat.state, "ok", "a partial sweep is not a pipe failure");
});

test("is_report_status=1 is actually requested, or every status is an empty shell", async () => {
  const fetchImpl = fakeFetch([AUTH_OK, LIST_OK, INFO_OK]);
  const c = createOrionStarConnector({ region: "us" }, { app_id: "a", app_secret: "b" }, { fetchImpl });
  await c.init();
  await c.tick(NOW);
  const infoCall = fetchImpl.calls.find((u) => u.includes("/v1/robot/robot_info"));
  assert.ok(infoCall, "robot_info was called");
  assert.match(infoCall, /is_report_status=1/);
});

test("region selects the entry point, and a token is not portable between them", async () => {
  const fetchImpl = fakeFetch([AUTH_OK, LIST_OK, INFO_OK]);
  const c = createOrionStarConnector({ region: "eu" }, { app_id: "a", app_secret: "b" }, { fetchImpl });
  await c.init();
  assert.ok(fetchImpl.calls.every((u) => u.startsWith(REGIONS.eu)), "all calls hit the EU entry point");
  assert.equal(REGIONS.us, "https://us-openapi.orionstar.com");
});

test("the usage endpoint uses code 200 for success, unlike /v1/*", () => {
  // Recorded as an executable note: the two families genuinely disagree, and a
  // parser that assumes one convention drops the other silently.
  assert.equal(usage.daily.code, 200);
  assert.equal(robotInfo.code, 0);
});

test("hourly usage is 24 buckets aligned to weeklist, and daily is one per date", () => {
  const h = usage.hourly.data;
  assert.equal(h.weeklist.length, 24);
  assert.equal(h.list[0].list.length, 24);
  assert.equal(h.list[0].list[18], 12, "the 18:00 bucket is the busiest in the example");
  assert.equal(h.list[0].list.reduce((a, b) => a + b, 0), 75);

  const d = usage.daily.data;
  assert.equal(d.weeklist.length, d.list[0].list.length);
  assert.deepEqual(d.weeklist, ["2024-02-01", "2024-02-02", "2024-02-03"]);
});

test("the CarryBot history gap is recorded so it is not rediscovered later", () => {
  // The documented usage endpoint is LuckiBot-only. CarryBot, the warehouse
  // AMR we actually sell against, has no documented historical usage endpoint.
  // If this ever stops being true, delete this test.
  assert.ok(usage._carrybot_gap.includes("No equivalent historical usage endpoint is documented for CarryBot"));
  const metrics = Object.keys(usage._classify_values);
  assert.ok(metrics.includes("b_delivery_nums") && metrics.includes("active_hour"));
});
