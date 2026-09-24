import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.mjs";
import { openControl } from "../src/control.mjs";
import { rebuildRollupsForRobot } from "../src/rollup.mjs";
import { fleetContract, KV_BILLING_DAY } from "../src/contract.mjs";
import { saveInputs, loadInputs } from "../src/inputs.mjs";
import { setBusinessType, KV_CONFIRMED } from "../src/owner.mjs";
import { createVault } from "../src/vault.mjs";
import { buildBrief, briefEmail, briefRecipients } from "../src/brief.mjs";
import { briefDue, createBriefJob, parseBriefTime, localClock, stopLink, verifyStop, stopBriefFor, KV_BRIEF_SENT } from "../src/brief-job.mjs";

const TZ = "America/Los_Angeles";
const MIN = 60_000;
const at = (iso) => Date.parse(iso);
// Thursday Sep 3 2026, 5:45 AM Pacific.
const THU_545 = at("2026-09-03T12:45:00Z");
const vault = createVault({ keyB64: Buffer.alloc(32, 7).toString("base64") });

/** A confirmed account: two pickers at Pier 4, a week of work ending Sep 2,
 *  Picker 2 stalling at the same spot and under its lease. */
function account({ lease = true } = {}) {
  const s = openStore(":memory:");
  s.setKV(KV_BILLING_DAY, "4");
  s.setKV("owner.tz", TZ);
  setBusinessType(s, "warehouse");
  const site = s.upsertSite("Pier 4", 1);
  const ids = [1, 2].map((n) => {
    const id = s.upsertRobot({ connector: "import", externalId: `p${n}`, displayName: `Picker ${n}`, brand: "Locus", model: "LocusBot", category: "picking" }, 1);
    s.setRobotSite(id, site);
    return id;
  });
  for (let d = 27; d <= 33; d++) {
    const day = d <= 31 ? `2026-08-${d}` : `2026-09-0${d - 31}`;
    ids.forEach((id, k) => {
      const t0 = at(`${day}T15:00:00Z`);
      for (let i = 0; i < 36; i++) {
        const t = t0 + i * 10 * MIN;
        // Picker 2 does a third of the work and stalls at the same spot daily.
        const busy = k === 0 || i % 3 === 0;
        const stuck = k === 1 && i >= 12 && i < 15;
        s.insertSnapshot({ robotId: id, at: t, receivedAt: t, connector: "import", source: "import", connectionState: "online", missionState: busy ? "active" : "idle", missionId: busy ? `${id}-${day}-${i}` : null, moving: !stuck, stuck, pose: { x: 14, y: 6 } });
      }
    });
  }
  ids.forEach((id) => {
    rebuildRollupsForRobot(s, id);
    s.upsertRobotEconomics(id, { taskType: "picking", taskBasis: "mission", rateCents: 40, invoiceCentsMonth: 150_000, wageCentsHour: null, operatingHoursDay: 12 }, 1);
    if (lease) s.upsertRobotContract(id, { startDate: "2026-08-04", termMonths: 36, paybackMonths: 14, uptimePct: 99.5 }, 1);
  });
  s.setKV(KV_CONFIRMED, "1");
  saveInputs(s, { account: { briefSettings: { to: ["owner@fleet.co", "555-0100", "floor@fleet.co"], time: "5:30 AM", days: [1, 1, 1, 1, 1, 0, 0], sites: [1] } } }, 1);
  return { s, ids };
}

test("brief times and local clocks read the way the page writes them", () => {
  assert.equal(parseBriefTime("5:30 AM"), 330);
  assert.equal(parseBriefTime("12:00 AM"), 0);
  assert.equal(parseBriefTime("12:30 PM"), 750);
  assert.equal(parseBriefTime("soon"), null);
  assert.deepEqual(localClock(THU_545, TZ), { weekday: 3, minute: 345 });
});

test("the brief goes to email addresses only, at most three, never to one that stopped it", () => {
  assert.deepEqual(briefRecipients({ to: ["A@x.co", "555-0100", "a@x.co", "b@x.co", "c@x.co", "d@x.co"] }), ["a@x.co", "b@x.co", "c@x.co"]);
  assert.deepEqual(briefRecipients({ to: ["a@x.co", "b@x.co"] }, ["A@x.co"]), ["b@x.co"]);
});

test("the brief names the robot to watch, the stall spot and the one thing to do", () => {
  const { s, ids } = account();
  const b = buildBrief(fleetContract(s, THU_545), { inputs: loadInputs(s) });
  assert.equal(b.throughKey, "2026-09-02");
  assert.equal(b.dateLabel, "Thursday, Sep 3, before first shift");
  assert.equal(b.parity.watch.robotId, ids[1]);
  assert.equal(b.parity.spots[0].place, "near 14, 6 m");
  assert.ok(b.parity.spots[0].n >= 5, "one stall a day at the same spot");
  assert.equal(b.parity.fix.place, "near 14, 6 m");
  const money = b.blocks.find((x) => x.id === "money");
  assert.ok(money?.items.some((i) => i.text === "Credit owed for Picker 2"), "credit against the stated 99.5%");
});

test("no lease, no credit line in the brief", () => {
  const { s } = account({ lease: false });
  const b = buildBrief(fleetContract(s, THU_545), { inputs: loadInputs(s) });
  assert.equal(b.blocks.find((x) => x.id === "money"), undefined);
});

test("a fix marked done drops out of One thing to do", () => {
  const { s } = account();
  saveInputs(s, { account: { fixes: { "pier-4:near 14, 6 m": { status: "done", note: "moved pallets" } } } }, 2);
  const b = buildBrief(fleetContract(s, THU_545), { inputs: loadInputs(s) });
  assert.equal(b.parity.fix, null);
});

test("the email escapes what the owner typed and carries its unsubscribe link", () => {
  const { s } = account();
  const b = buildBrief(fleetContract(s, THU_545), { inputs: loadInputs(s) });
  const m = briefEmail(b, { appUrl: "https://app.botlien.com/app", unsubscribeUrl: "https://app.botlien.com/brief/stop?x=1", business: "Harbor <Grill>" });
  assert.match(m.subject, /^Harbor <Grill>: before the floor opens, Thursday, Sep 3$/);
  assert.match(m.html, /Harbor|before the floor/i);
  assert.doesNotMatch(m.html, /<Grill>/);
  assert.match(m.text, /Stop these emails: https:\/\/app\.botlien\.com\/brief\/stop\?x=1/);
  assert.match(m.html, /brief\/stop\?x=1/);
});

test("the brief is due on a brief day, from the chosen time, for three hours, once", () => {
  const { s } = account();
  assert.equal(briefDue(s, at("2026-09-03T12:29:00Z")).skip, "not time yet");
  assert.deepEqual(briefDue(s, THU_545).to, ["owner@fleet.co", "floor@fleet.co"]);
  assert.equal(briefDue(s, at("2026-09-03T15:31:00Z")).skip, "too late today");
  assert.equal(briefDue(s, at("2026-09-05T12:45:00Z")).skip, "not a brief day", "Saturday is off");
  s.setKV(KV_BRIEF_SENT, "2026-09-03");
  assert.equal(briefDue(s, THU_545).skip, "already sent today");
});

test("no brief on stale data or for a fleet still being set up", () => {
  const { s } = account();
  assert.match(briefDue(s, at("2026-09-10T12:45:00Z")).skip, /^data stops 2026-09-02/);
  const fresh = openStore(":memory:");
  saveInputs(fresh, { account: { briefSettings: { to: ["a@x.co"], time: "5:30 AM", days: [1, 1, 1, 1, 1, 1, 1], sites: [] } } }, 1);
  assert.equal(briefDue(fresh, THU_545).skip, "setting up");
});

function jobFixture({ send = true, withVault = true } = {}) {
  const control = openControl(":memory:");
  const acct = control.upsertAccount("owner@fleet.co", 1);
  const { s } = account();
  const tenants = { get: () => s };
  const sent = [];
  const logs = [];
  const mailer = { async send(m) { sent.push(m); return { ok: true }; } };
  const job = createBriefJob({ control, tenants, mailer, vault: withVault ? vault : null, baseUrl: "https://app.botlien.com", send, log: (l) => logs.push(l) });
  return { control, acct, s, sent, logs, job };
}

test("the job sends each recipient their own email once a day, with a signed stop link", async () => {
  const { job, sent, s, control } = jobFixture();
  const r = await job.tick(THU_545);
  assert.equal(r[0].sent, 2);
  assert.deepEqual(sent.map((m) => m.to), ["owner@fleet.co", "floor@fleet.co"]);
  assert.ok(sent.every((m) => m.html && m.headers["List-Unsubscribe"]));
  const link = new URL(sent[1].headers["List-Unsubscribe"].slice(1, -1));
  assert.equal(link.searchParams.get("e"), "floor@fleet.co");
  assert.ok(verifyStop(vault, Object.fromEntries(link.searchParams)));
  await job.tick(THU_545 + 5 * MIN);
  assert.equal(sent.length, 2, "not twice in one day");
  assert.equal(s.getKV(KV_BRIEF_SENT), "2026-09-03");
  assert.equal(control.countEvents("brief_sent"), 1);
});

test("with sending off the job only logs, and with no signing key it sends nothing", async () => {
  const off = jobFixture({ send: false });
  await off.job.tick(THU_545);
  assert.equal(off.sent.length, 0);
  assert.ok(off.logs.some((l) => /not sent, BOTLIEN_BRIEF_SEND is off/.test(l)));
  const noKey = jobFixture({ withVault: false });
  const r = await noKey.job.tick(THU_545);
  assert.equal(noKey.sent.length, 0);
  assert.equal(r[0].skip, "no secret to sign unsubscribe links");
  assert.equal(noKey.s.getKV(KV_BRIEF_SENT), null, "not marked sent, so it goes once a key is set");
});

test("a stop link takes that address off, and a forged one does not verify", () => {
  const { s } = account();
  const url = new URL(stopLink("https://app.botlien.com", vault, 9, "floor@fleet.co"));
  const q = Object.fromEntries(url.searchParams);
  assert.ok(verifyStop(vault, q));
  assert.equal(verifyStop(vault, { ...q, e: "owner@fleet.co" }), false);
  assert.equal(verifyStop(vault, { ...q, a: "10" }), false);
  stopBriefFor(s, "Floor@fleet.co");
  assert.deepEqual(briefDue(s, THU_545).to, ["owner@fleet.co"]);
});
