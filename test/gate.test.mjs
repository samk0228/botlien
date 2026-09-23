// End-to-end over a real server: the isolation test that Phase A exists to
// pass. Two accounts sign in, each uploads a different export, and neither can
// reach the other's fleet through any route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBoard, readBody } from "../src/board.mjs";
import { openControl } from "../src/control.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer } from "../src/mailer.mjs";
import { createTenancy } from "../src/tenancy.mjs";
import { boardModel } from "../src/board.mjs";
import { openStore } from "../src/store.mjs";
import { SESSION_COOKIE } from "../src/auth.mjs";

const NOW = Date.parse("2026-08-07T12:00:00-07:00");
const DAY = 86_400_000;

function csv(prefix, days = 3) {
  const rows = ["robot_id,at,connection_state,mission_state,mission_id"];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 6; h++) {
      const at = new Date(NOW - (days - d) * DAY + h * 3_600_000).toISOString();
      rows.push(`${prefix}-1,${at},online,active,${prefix}-m${d}${h}`);
    }
  }
  return rows.join("\n");
}

/** Boots the real server on an ephemeral port with a console mailer, so the
 * sign-in link is captured rather than emailed. */
async function boot({ opsEmails = ["sam@harborgrill.com"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "botlien-gate-"));
  const control = openControl(join(dir, "control.db"));
  const sent = [];
  const mailer = createConsoleMailer({ log: (l) => sent.push(l) });
  const tenants = new TenantStores(join(dir, "tenants"));
  const opsStore = openStore(join(dir, "ops.db"));

  let port = 0;
  const tenancy = createTenancy({
    control,
    mailer,
    tenants,
    now: () => NOW,
    baseUrl: "http://127.0.0.1",
    secureCookies: false,
    readBody,
    opsEmails,
  });

  const server = startBoard(0, {
    tenancy,
    getState: () => boardModel(opsStore, NOW),
    getOwnerState: null,
  });
  await new Promise((r) => server.once("listening", r));
  port = server.address().port;

  const base = `http://127.0.0.1:${port}`;

  /** Full sign-in: ask for a link, pull the token out of the mailer, redeem it,
   * and return the session cookie. */
  async function signIn(email) {
    const before = sent.length;
    const res = await fetch(`${base}/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }),
      redirect: "manual",
    });
    assert.equal(res.status, 200, `link requested for ${email}`);
    const mail = sent.slice(before).join("\n");
    const token = mail.match(/\/signin\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, "a link was mailed");

    const red = await fetch(`${base}/signin/${token}`, { redirect: "manual" });
    assert.equal(red.status, 303);
    // The dashboard is home after sign-in.
    assert.equal(red.headers.get("location"), "/app");
    const cookie = red.headers.get("set-cookie");
    assert.ok(cookie?.startsWith(SESSION_COOKIE), "a session cookie was set");
    return cookie.split(";")[0];
  }

  return {
    base,
    control,
    tenants,
    signIn,
    get: (path, cookie) =>
      fetch(`${base}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: "manual",
      }),
    post: (path, body, cookie) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
        redirect: "manual",
      }),
    async close() {
      server.close();
      await new Promise((r) => server.once("close", r));
      tenants.closeAll();
      control.close();
      opsStore.close();
    },
  };
}

test("the front door is public and does not require a session", async () => {
  const app = await boot();
  try {
    const res = await app.get("/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /covering their lease/i);
    assert.match(html, /Start free/);
  } finally {
    await app.close();
  }
});

test("owner routes redirect to sign-in when there is no session", async () => {
  const app = await boot();
  try {
    // /ops and /api/state are in this list on purpose: they read the operator's
    // own connector-fed fleet, so an anonymous request must not reach them.
    for (const path of ["/app", "/owner", "/owner/setup", "/owner/import", "/owner/confirm", "/owner/sources", "/api/owner", "/api/v1/fleet", "/api/v1/connections", "/ops", "/api/state"]) {
      const res = await app.get(path);
      assert.equal(res.status, 303, `${path} is gated`);
      assert.equal(res.headers.get("location"), "/signin");
    }
  } finally {
    await app.close();
  }
});

test("a forged session cookie does not get in", async () => {
  const app = await boot();
  try {
    const res = await app.get("/owner", `${SESSION_COOKIE}=not-a-real-session`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/signin");
  } finally {
    await app.close();
  }
});

test("two accounts cannot see each other's robots", async () => {
  const app = await boot();
  try {
    const alice = await app.signIn("alice@harborgrill.com");
    const bob = await app.signIn("bob@othergrill.com");
    assert.notEqual(alice, bob);

    // each picks a business, then uploads a different export
    await app.post("/owner/business", new URLSearchParams({ business: "restaurant" }), alice);
    await app.post("/owner/business", new URLSearchParams({ business: "restaurant" }), bob);

    for (const [cookie, prefix] of [[alice, "alice"], [bob, "bob"]]) {
      const res = await fetch(`${app.base}/owner/import?name=usage.csv`, {
        method: "POST",
        headers: { "Content-Type": "text/csv", Cookie: cookie },
        body: csv(prefix),
        redirect: "manual",
      });
      assert.equal(res.status, 303, `${prefix} import accepted`);
    }

    const aliceJson = await (await app.get("/api/owner", alice)).json();
    const bobJson = await (await app.get("/api/owner", bob)).json();

    const names = (m) => JSON.stringify(m);
    assert.match(names(aliceJson), /alice-1/, "alice sees her own robot");
    assert.ok(!names(aliceJson).includes("bob-1"), "alice must not see bob's robot");
    assert.match(names(bobJson), /bob-1/, "bob sees his own robot");
    assert.ok(!names(bobJson).includes("alice-1"), "bob must not see alice's robot");
  } finally {
    await app.close();
  }
});

test("signing out ends access immediately", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("sam@harborgrill.com");
    assert.notEqual((await app.get("/owner", cookie)).headers.get("location"), "/signin");

    // POST, not GET: sign-out is POST-only so a crafted GET link cannot log an
    // owner out (logout-CSRF). A GET falls through to 404 and leaves them in.
    const getOut = await app.get("/signout", cookie);
    assert.equal(getOut.status, 404, "GET /signout does not sign anyone out");
    assert.notEqual(
      (await app.get("/owner", cookie)).headers.get("location"),
      "/signin",
      "still signed in after a GET to /signout",
    );

    const out = await app.post("/signout", new URLSearchParams(), cookie);
    assert.equal(out.status, 303);
    assert.equal(out.headers.get("location"), "/signin?signedout=1");

    const after = await app.get("/owner", cookie);
    assert.equal(after.headers.get("location"), "/signin", "the cookie is dead server-side");
  } finally {
    await app.close();
  }
});

test("a used link cannot be replayed by a second person", async () => {
  const app = await boot();
  try {
    const sent = [];
    const res = await app.post("/signin", new URLSearchParams({ email: "sam@harborgrill.com" }));
    const html = await res.text();
    const token = html.match(/\/signin\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, "dev mode shows the link on the page");

    const first = await app.get(`/signin/${token}`);
    assert.equal(first.status, 303);
    const second = await app.get(`/signin/${token}`);
    assert.equal(second.status, 400);
    assert.match(await second.text(), /already used/i);
  } finally {
    await app.close();
  }
});

test("a signed-in owner is taken to their statement instead of the sales page", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("sam@harborgrill.com");
    const res = await app.get("/", cookie);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/app");
  } finally {
    await app.close();
  }
});

test("the ops board moves off the front door and the funnel records the journey", async () => {
  const app = await boot();
  try {
    await app.get("/");
    // Anonymous access to the ops board is refused; a signed-in request reaches
    // it. The front door itself stays public.
    const anon = await app.get("/ops");
    assert.equal(anon.status, 303, "ops board is not public");
    assert.equal(anon.headers.get("location"), "/signin");

    const cookie = await app.signIn("sam@harborgrill.com");
    assert.equal((await app.get("/ops", cookie)).status, 200, "the operator reaches /ops");
    assert.equal((await app.get("/api/state", cookie)).status, 200, "and /api/state");
    await app.post("/owner/business", new URLSearchParams({ business: "restaurant" }), cookie);
    await fetch(`${app.base}/owner/import?name=usage.csv`, {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: cookie },
      body: csv("sam"),
      redirect: "manual",
    });

    const f = app.control.funnel();
    assert.ok(f.counts.landed >= 1, "landed recorded");
    assert.equal(f.counts.account_created, 1);
    assert.equal(f.counts.data_connected, 1);
  } finally {
    await app.close();
  }
});

test("a signed-in customer who is not an operator cannot reach the ops board", async () => {
  const app = await boot({ opsEmails: ["sam@harborgrill.com"] });
  try {
    const outsider = await app.signIn("alice@othergrill.com");
    for (const path of ["/ops", "/api/state"]) {
      const res = await app.get(path, outsider);
      assert.equal(res.status, 404, `${path} is hidden from a non-operator`);
    }
    // but her own statement is reachable, so this is authorization, not a lockout
    assert.notEqual((await app.get("/owner", outsider)).headers.get("location"), "/signin");
  } finally {
    await app.close();
  }
});

test("an empty operator allowlist denies everyone, signed in or not", async () => {
  const app = await boot({ opsEmails: [] });
  try {
    assert.equal((await app.get("/ops")).status, 303, "anonymous still bounced to sign-in");
    const cookie = await app.signIn("sam@harborgrill.com");
    assert.equal((await app.get("/ops", cookie)).status, 404, "no operator set means the board is closed");
    assert.equal((await app.get("/api/state", cookie)).status, 404);
  } finally {
    await app.close();
  }
});

test("an invalid email is refused before anything is mailed", async () => {
  const app = await boot();
  try {
    const res = await app.post("/signin", new URLSearchParams({ email: "nope" }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /does not look like an email address/);
    assert.equal(app.control.countAccounts(), 0);
  } finally {
    await app.close();
  }
});

test("asking for too many links is refused with a 429", async () => {
  const app = await boot();
  try {
    for (let i = 0; i < 5; i++) {
      const ok = await app.post("/signin", new URLSearchParams({ email: "sam@harborgrill.com" }));
      assert.equal(ok.status, 200, `link ${i}`);
    }
    const blocked = await app.post("/signin", new URLSearchParams({ email: "sam@harborgrill.com" }));
    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /Too many links/);
  } finally {
    await app.close();
  }
});

// Regression: `activated` is the one number the funnel exists to produce, and
// the ratio lives on model.totals, not on the model root. Reading it from the
// wrong place is silently always-undefined, which reports as "nobody ever
// activated" rather than as any kind of error.
test("reaching a real coverage ratio fires activated exactly once", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("sam@harborgrill.com");
    await app.post("/owner/business", new URLSearchParams({ business: "restaurant" }), cookie);
    await fetch(`${app.base}/owner/import?name=usage.csv`, {
      method: "POST",
      headers: { "Content-Type": "text/csv", Cookie: cookie },
      body: csv("sam", 5),
      redirect: "manual",
    });
    await app.post("/owner/confirm", new URLSearchParams(), cookie);

    const setup = new URLSearchParams();
    setup.set("task_type_1", "tray_delivery");
    setup.set("task_basis_1", "mission");
    setup.set("rate_1", "0.73");
    setup.set("invoice_1", "999.00");
    setup.set("wage_1", "22.00");
    setup.set("hours_1", "10.5");
    await app.post("/owner/setup", setup, cookie);

    assert.equal(app.control.funnel().counts.numbers_saved, 1);

    // The old statement page now forwards to the dashboard, which is home.
    const old = await app.get("/owner", cookie);
    assert.equal(old.status, 303);
    assert.equal(old.headers.get("location"), "/app?view=dashv2");
    assert.equal(app.control.funnel().counts.activated ?? 0, 0, "a redirect is not activation");

    // the dashboard itself is what activates
    const home = await app.get("/app", cookie);
    assert.equal(home.status, 200, "the dashboard renders rather than redirecting back");

    const f = app.control.funnel();
    assert.equal(f.counts.activated, 1, "activated fired");
    assert.equal(f.activatedAccounts, 1);
    assert.notEqual(f.medianTimeToActivateMs, null, "time to activate is measurable");

    // reloading must not inflate it
    await app.get("/app", cookie);
    await app.get("/app", cookie);
    assert.equal(app.control.funnel().counts.activated, 1, "a reload is not a second activation");
  } finally {
    await app.close();
  }
});

test("/app sends a brand-new account to first run, and old pages forward once it has a fleet", async () => {
  const app = await boot();
  try {
    const cookie = await app.signIn("new@example.com");
    const first = await app.get("/app", cookie);
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), "/owner/business", "no business chosen yet");
    const demo = await app.get("/app?demo=1", cookie);
    assert.equal(demo.status, 200, "the demo is always reachable");
  } finally {
    await app.close();
  }
});
