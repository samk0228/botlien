import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openStore } from "../src/store.mjs";
import { saveInputs, loadInputs, ROBOT_INPUTS, ACCOUNT_INPUTS, InputError } from "../src/inputs.mjs";
import { fleetContract } from "../src/contract.mjs";

const require = createRequire(import.meta.url);
const adapter = require("../prototype/src/live-adapter.cjs");
const T0 = Date.parse("2026-09-23T17:00:00Z");

function store2() {
  const s = openStore(":memory:");
  const a = s.upsertRobot({ connector: "import", externalId: "p1", displayName: "Picker 1", category: "picking" }, 1);
  const b = s.upsertRobot({ connector: "import", externalId: "p2", displayName: "Picker 2", category: "picking" }, 1);
  return { s, a, b };
}

test("the page and the server save exactly the same keys", () => {
  assert.deepEqual([...adapter.PERSIST_ROBOT].sort(), Object.keys(ROBOT_INPUTS).sort());
  assert.deepEqual([...adapter.PERSIST_ACCOUNT].sort(), [...ACCOUNT_INPUTS].sort());
});

test("account and robot inputs round-trip, robots by id", () => {
  const { s, a, b } = store2();
  saveInputs(s, { account: { stallMinutes: 8, fixes: { "0:aisle 14": { status: "done", note: "moved pallets" } } }, robots: { robotInvoice: { [a]: 1450 }, confirmWork: { [b]: "Order picking" } } }, T0);
  const got = loadInputs(s);
  assert.equal(got.account.stallMinutes, 8);
  assert.equal(got.account.fixes["0:aisle 14"].status, "done");
  assert.deepEqual(got.robots.robotInvoice, { [a]: 1450 });
  assert.deepEqual(got.robots.confirmWork, { [b]: "Order picking" });
});

test("later saves merge per robot, and null puts a robot back on its default", () => {
  const { s, a, b } = store2();
  saveInputs(s, { robots: { robotHours: { [a]: 10 } } }, T0);
  saveInputs(s, { robots: { robotHours: { [b]: 16 } } }, T0 + 1);
  assert.deepEqual(loadInputs(s).robots.robotHours, { [a]: 10, [b]: 16 });
  saveInputs(s, { robots: { robotHours: { [a]: null } } }, T0 + 2);
  assert.deepEqual(loadInputs(s).robots.robotHours, { [b]: 16 });
});

test("a bad batch saves nothing at all", () => {
  const { s, a } = store2();
  assert.throws(() => saveInputs(s, { account: { stallMinutes: 5, password: "x" } }, T0), InputError);
  assert.throws(() => saveInputs(s, { robots: { robotHours: { [a]: 30 } } }, T0), /not a value it can take/);
  assert.throws(() => saveInputs(s, { robots: { robotInvoice: { 999: 100 } } }, T0), /not on this account/);
  assert.deepEqual(loadInputs(s), { account: {}, robots: {} });
});

test("invoice and hours reach the economics the server computes with", () => {
  const { s, a } = store2();
  saveInputs(s, { robots: { robotInvoice: { [a]: 1450.5 }, robotHours: { [a]: 14 } } }, T0);
  const e = s.listRobotEconomics().find((x) => x.robot_id === a);
  assert.equal(e.invoice_cents_month, 145050);
  assert.equal(e.operating_hours_day, 14);
  assert.ok(e.rate_cents > 0, "the rate is kept from the benchmark");
});

test("only a fully stated lease reaches the lease table", () => {
  const { s, a, b } = store2();
  saveInputs(s, { robots: { contract: { [a]: { term: 24 }, [b]: { start: "2025-07-01", term: 36, payback: 14, uptime: 95 } } } }, T0);
  const rows = s.listRobotContracts();
  assert.deepEqual(rows.map((r) => r.robot_id), [b]);
  assert.equal(loadInputs(s).robots.contract[a].term, 24, "the partial edit is still kept as page state");
});

test("the page sends only what changed, by robot id, with cleared rows as null", () => {
  const ids = [11, 12];
  const prev = { stallMinutes: 6, robotInvoice: { 0: 1000 }, robotHours: {} };
  assert.equal(adapter.inputChanges(prev, JSON.parse(JSON.stringify(prev)), ids), null);
  const next = { stallMinutes: 7, robotInvoice: { 1: 900 }, robotHours: {} };
  const ch = adapter.inputChanges(prev, next, ids);
  assert.deepEqual(ch.account, { stallMinutes: 7 });
  assert.deepEqual(ch.robots.robotInvoice, { 11: null, 12: 900 });
  assert.equal(ch.robots.robotHours, undefined);
});

test("saved inputs come back to the page in row order", () => {
  const { s, a, b } = store2();
  saveInputs(s, { account: { taxRate: 0.21 }, robots: { robotInvoice: { [b]: 800 } } }, T0);
  const c = fleetContract(s, T0);
  const T = adapter.liveTables(c);
  assert.deepEqual(T.ROBOT_IDS, [a, b]);
  assert.deepEqual(T.SAVED.robots.robotInvoice, { 1: 800 });
  assert.equal(T.SAVED.account.taxRate, 0.21);
});

test("rate history logs a rate only when it changes, with who saved it", () => {
  const { s } = store2();
  const pick = (cents, own) => ({ rates: { "Order picking": { cents, unit: "pick", own } } });
  saveInputs(s, pick(42, false), T0, "owner@example.com");
  saveInputs(s, pick(42, false), T0 + 1, "owner@example.com"); // unchanged: no row
  const keys = saveInputs(s, { account: { workWage: { "Order picking": 26 } }, ...pick(44, true) }, T0 + 2, "owner@example.com");
  assert.ok(keys.includes("rate.Order picking"));
  const hist = fleetContract(s, T0 + 3).rateHistory;
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((r) => [r.cents, r.own, r.by, r.at]), [[44, true, "owner@example.com", T0 + 2], [42, false, "owner@example.com", T0]]);
});

test("a bad rate rejects the whole batch", () => {
  const { s, a } = store2();
  for (const rates of [[], { "": { cents: 1, unit: "pick", own: true } }, { x: { cents: -1, unit: "pick", own: true } }, { x: { cents: 1.5, unit: "pick", own: true } }, { x: { cents: 1, unit: "pick" } }]) {
    assert.throws(() => saveInputs(s, { robots: { robotHours: { [a]: 9 } }, rates }, T0), InputError);
  }
  assert.equal(loadInputs(s).robots.robotHours, undefined);
  assert.equal(fleetContract(s, T0).rateHistory.length, 0);
});

test("the adapter carries people and the rate log, with a fallback owner", () => {
  const { s } = store2();
  const c = fleetContract(s, T0);
  const bare = adapter.liveTables(c);
  assert.deepEqual(bare.PEOPLE.map((p) => [p.name, p.role]), [["You", "Owner"]]);
  assert.deepEqual(bare.RATE_LOG, []);
  const withPeople = adapter.liveTables({ ...c, people: [{ email: "dana@fleet.co", role: "Owner", since: T0 }] });
  assert.deepEqual(withPeople.PEOPLE.map((p) => [p.name, p.email, p.role]), [["dana", "dana@fleet.co", "Owner"]]);
});
