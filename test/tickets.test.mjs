import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { startBoard, readBody } from "../src/board.mjs";
import { fleetContract } from "../src/contract.mjs";
import { addTicket, updateTicket, TicketError } from "../src/tickets.mjs";

const require = createRequire(import.meta.url);
const adapter = require("../prototype/src/live-adapter.cjs");
const NOW = Date.parse("2026-09-23T18:00:00Z");
const DAY = 86_400_000;

// ---- the rules ----

test("a ticket needs a title, a robot on the account, and a reply after it was opened", () => {
  const s = openStore(":memory:");
  const a = s.upsertRobot({ connector: "import", externalId: "p1", displayName: "Picker 1", category: "picking" }, 1);
  assert.throws(() => addTicket(s, { title: "  " }, NOW), TicketError);
  assert.throws(() => addTicket(s, { title: "Lidar", robotId: 999 }, NOW), /not on this account/);
  assert.throws(() => addTicket(s, { title: "Lidar", openedAt: "2026-09-20T15:00:00Z", respondedAt: "2026-09-19T15:00:00Z" }, NOW), /before the ticket was opened/);
  assert.throws(() => addTicket(s, { title: "Lidar", openedAt: NOW + 3 * DAY }, NOW), /future/);
  assert.throws(() => addTicket(s, { title: "Lidar", status: "pending" }, NOW), /open or closed/);
  assert.equal(s.listTickets().length, 0, "nothing is saved by a refused ticket");

  const t = addTicket(s, { title: "Lidar fault", brand: "Locus", robotId: a, ref: "LR-4471" }, NOW);
  assert.deepEqual([t.robotId, t.openedAt, t.respondedAt, t.status, t.ref], [a, NOW, null, "open", "LR-4471"]);
  assert.equal(updateTicket(s, t.id, { respondedAt: NOW + DAY }).respondedAt, NOW + DAY);
  assert.throws(() => updateTicket(s, t.id, { respondedAt: NOW - 1 }), TicketError);
  assert.equal(updateTicket(s, t.id, { status: "closed" }).status, "closed");
  assert.equal(updateTicket(s, t.id, {}).respondedAt, NOW + DAY, "an empty patch changes nothing");
  assert.equal(updateTicket(s, 404, { status: "open" }), null);

  const c = fleetContract(s, NOW + 2 * DAY);
  assert.equal(c.tickets[0].status, "closed");
  assert.equal(c.provenance.tickets, "owner");
});

// ---- over HTTP ----

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "botlien-tickets-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const tenants = new TenantStores(join(dir, "tenants"));
  const tenancy = createTenancy({ control, mailer: createConsoleMailer({ log: (l) => sent.push(l) }), tenants, now: () => NOW, baseUrl: "http://127.0.0.1", readBody });
  const server = startBoard(0, { tenancy, getState: () => ({}), getOwnerState: null });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function signIn(email) {
    const before = sent.length;
    await fetch(`${base}/signin`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }), redirect: "manual" });
    const token = sent.slice(before).join("\n").match(/\/signin\/([A-Za-z0-9_-]+)/)[1];
    const red = await fetch(`${base}/signin/${token}`, { redirect: "manual" });
    return red.headers.get("set-cookie").split(";")[0];
  }
  const api = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie }, redirect: "manual" });
  return {
    signIn, api,
    async close() {
      server.close();
      await new Promise((r) => server.once("close", r));
      tenants.closeAll();
      control.close();
    },
  };
}

test("the owner logs a vendor ticket, marks the reply, and it shows on the dashboard", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@fleetco.com");
    const post = (body, c = cookie) => app.api("/api/v1/tickets", c, { method: "POST", body: JSON.stringify(body) });
    const patch = (id, body, c = cookie) => app.api(`/api/v1/tickets/${id}`, c, { method: "PATCH", body: JSON.stringify(body) });

    const made = await post({ title: "Lidar fault on Picker 7", brand: "Locus", openedAt: "2026-09-20T15:00:00Z" });
    assert.equal(made.status, 200);
    const t = (await made.json()).ticket;
    assert.deepEqual([t.brand, t.status, t.respondedAt], ["Locus", "open", null]);
    assert.equal((await post({ title: "", brand: "Locus" })).status, 400);
    assert.equal((await post({ title: "x", robotId: 12 })).status, 400, "a robot that is not the account's");
    assert.equal((await patch(t.id, { respondedAt: "2026-09-19T15:00:00Z" })).status, 400);

    const reply = await patch(t.id, { respondedAt: "2026-09-22T09:00:00Z" });
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).ticket.respondedAt, Date.parse("2026-09-22T09:00:00Z"));

    const fleet = await (await app.api("/api/v1/fleet", cookie)).json();
    assert.equal(fleet.tickets.length, 1);
    const T = adapter.liveTables(fleet);
    assert.deepEqual([T.TICKETS[0].opened, T.TICKETS[0].responded, T.TICKETS[0].status], ["2026-09-20T08:00", "2026-09-22T02:00", "open"]);

    // Another account cannot see or touch it.
    const other = await app.signIn("sam@harborgrill.com");
    assert.equal((await patch(t.id, { status: "closed" }, other)).status, 404);
    assert.deepEqual((await (await app.api("/api/v1/fleet", other)).json()).tickets, []);
    assert.equal((await app.api(`/api/v1/tickets/${t.id}`, cookie)).status, 404, "tickets are read through the contract, not one by one");
  } finally {
    await app.close();
  }
});

test("an account gets ten vendor connection attempts an hour", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("dana@fleetco.com");
    const attempt = (c = cookie) => app.api("/api/v1/connections", c, { method: "POST", body: JSON.stringify({ vendor: "gausium", credentials: { client_id: "a", client_secret: "b", open_access_key: "c" } }) });
    for (let i = 0; i < 10; i++) {
      assert.equal((await attempt()).status, 400, "no encryption key on this server, so each try is refused before the vendor is asked");
    }
    const eleventh = await attempt();
    assert.equal(eleventh.status, 429);
    assert.match((await eleventh.json()).error, /10 connection attempts an hour/);
    const other = await app.signIn("sam@harborgrill.com");
    assert.equal((await attempt(other)).status, 400, "the limit is per account");
  } finally {
    await app.close();
  }
});
