import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControl, normalizeEmail, EVENTS } from "../src/control.mjs";
import {
  requestLink,
  redeemLink,
  currentAccount,
  signOut,
  pruneExpired,
  parseCookies,
  sessionCookie,
  clearCookie,
  validEmail,
  newToken,
  tokensEqual,
  SESSION_COOKIE,
  LINK_TTL_MS,
  MAX_LINKS_PER_HOUR,
} from "../src/auth.mjs";
import { TenantStores } from "../src/tenant.mjs";
import { createConsoleMailer, createResendMailer, createMailer, linkEmail } from "../src/mailer.mjs";
import {
  renderLandingHTML,
  renderSignInHTML,
  renderCheckEmailHTML,
  renderLinkFailedHTML,
} from "../src/site.mjs";

const NOW = Date.parse("2026-08-07T12:00:00-07:00");
const MIN = 60_000;

function ctl() {
  return openControl(":memory:");
}

function tmp(name) {
  return join(mkdtempSync(join(tmpdir(), "botlien-auth-")), name);
}

// ---- email handling ----

test("email validation accepts real addresses and rejects typos", () => {
  assert.ok(validEmail("sam@harborgrill.com"));
  assert.ok(validEmail("a.b+tag@sub.example.co.uk"));
  assert.ok(!validEmail(""));
  assert.ok(!validEmail("sam"));
  assert.ok(!validEmail("sam@"));
  assert.ok(!validEmail("sam@localhost"), "no dot in domain is a typo, not an address");
  assert.ok(!validEmail("sam @ grill.com"));
  assert.ok(!validEmail(`${"a".repeat(250)}@x.com`), "absurd length is rejected");
});

test("emails are matched case-insensitively so one owner is one account", () => {
  const c = ctl();
  assert.equal(normalizeEmail("  Sam@Harborgrill.COM "), "sam@harborgrill.com");
  const a = c.upsertAccount("Sam@Harborgrill.com", NOW);
  const b = c.upsertAccount("sam@harborgrill.com", NOW + 1000);
  assert.equal(a.created, true);
  assert.equal(b.created, false, "same owner, different capitalisation");
  assert.equal(a.account.id, b.account.id);
  assert.equal(c.countAccounts(), 1);
});

// ---- tokens ----

test("tokens are long, random, and URL safe", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.match(a, /^[A-Za-z0-9_-]+$/, "base64url survives being pasted into a browser");
});

test("tokensEqual rejects mismatched and empty values", () => {
  const t = newToken();
  assert.ok(tokensEqual(t, t));
  assert.ok(!tokensEqual(t, newToken()));
  assert.ok(!tokensEqual("", ""));
  assert.ok(!tokensEqual(t, t.slice(0, -1)));
  assert.ok(!tokensEqual(null, undefined));
});

// ---- the sign-in flow ----

test("a link signs in, creates the account on redemption, and opens a session", () => {
  const c = ctl();
  const req = requestLink(c, "sam@harborgrill.com", NOW);
  assert.ok(req.ok);
  assert.equal(c.countAccounts(), 0, "asking for a link must not create an account");

  const red = redeemLink(c, req.token, NOW + MIN);
  assert.ok(red.ok);
  assert.equal(red.created, true);
  assert.equal(red.account.email, "sam@harborgrill.com");
  assert.equal(c.countAccounts(), 1);

  const header = `${SESSION_COOKIE}=${red.sessionToken}`;
  const me = currentAccount(c, header, NOW + 2 * MIN);
  assert.equal(me.id, red.account.id);
});

test("a link works exactly once", () => {
  const c = ctl();
  const req = requestLink(c, "sam@harborgrill.com", NOW);
  assert.ok(redeemLink(c, req.token, NOW + MIN).ok);
  const second = redeemLink(c, req.token, NOW + 2 * MIN);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "used", "a forwarded link is dead on arrival");
});

test("a link expires after fifteen minutes", () => {
  const c = ctl();
  const req = requestLink(c, "sam@harborgrill.com", NOW);
  const late = redeemLink(c, req.token, NOW + LINK_TTL_MS + 1);
  assert.equal(late.ok, false);
  assert.equal(late.reason, "expired");
});

test("an unknown token is refused rather than throwing", () => {
  const c = ctl();
  const out = redeemLink(c, "not-a-real-token", NOW);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "unknown");
});

test("a second sign-in reuses the account instead of making another", () => {
  const c = ctl();
  const first = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW).token, NOW);
  const second = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW + MIN).token, NOW + MIN);
  assert.equal(first.account.id, second.account.id);
  assert.equal(second.created, false, "account_created must not fire twice");
  assert.equal(c.countAccounts(), 1);
});

test("invalid emails never reach the mailer", () => {
  const c = ctl();
  const out = requestLink(c, "nope", NOW);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "invalid_email");
});

test("link requests are rate limited per address", () => {
  const c = ctl();
  for (let i = 0; i < MAX_LINKS_PER_HOUR; i++) {
    assert.ok(requestLink(c, "sam@harborgrill.com", NOW + i).ok, `link ${i} allowed`);
  }
  const blocked = requestLink(c, "sam@harborgrill.com", NOW + MAX_LINKS_PER_HOUR);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "rate_limited");

  // a different owner is unaffected, and the window rolls
  assert.ok(requestLink(c, "other@grill.com", NOW).ok);
  assert.ok(requestLink(c, "sam@harborgrill.com", NOW + 61 * MIN).ok);
});

// ---- sessions ----

test("signing out kills the session immediately", () => {
  const c = ctl();
  const red = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW).token, NOW);
  const header = `${SESSION_COOKIE}=${red.sessionToken}`;
  assert.ok(currentAccount(c, header, NOW));
  assert.equal(signOut(c, header), true);
  assert.equal(currentAccount(c, header, NOW), null);
});

test("an expired session stops resolving", () => {
  const c = ctl();
  const red = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW).token, NOW);
  const header = `${SESSION_COOKIE}=${red.sessionToken}`;
  const far = NOW + 31 * 24 * 60 * 60 * 1000;
  assert.equal(currentAccount(c, header, far), null);
});

test("no cookie, a junk cookie, and a forged token all resolve to nobody", () => {
  const c = ctl();
  redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW).token, NOW);
  assert.equal(currentAccount(c, null, NOW), null);
  assert.equal(currentAccount(c, "", NOW), null);
  assert.equal(currentAccount(c, "unrelated=1", NOW), null);
  assert.equal(currentAccount(c, `${SESSION_COOKIE}=${newToken()}`, NOW), null);
});

test("revoking every session logs an owner out of all devices", () => {
  const c = ctl();
  const a = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW).token, NOW);
  const b = redeemLink(c, requestLink(c, "sam@harborgrill.com", NOW + MIN).token, NOW + MIN);
  assert.equal(c.deleteSessionsForAccount(a.account.id), 2);
  assert.equal(currentAccount(c, `${SESSION_COOKIE}=${a.sessionToken}`, NOW + 2 * MIN), null);
  assert.equal(currentAccount(c, `${SESSION_COOKIE}=${b.sessionToken}`, NOW + 2 * MIN), null);
});

test("pruning removes spent links and dead sessions but keeps live ones", () => {
  const c = ctl();
  const live = redeemLink(c, requestLink(c, "live@grill.com", NOW).token, NOW);
  requestLink(c, "stale@grill.com", NOW); // never redeemed, will expire

  const out = pruneExpired(c, NOW + LINK_TTL_MS + MIN);
  assert.equal(out.links, 2, "one consumed, one expired");
  assert.equal(out.sessions, 0);
  assert.ok(currentAccount(c, `${SESSION_COOKIE}=${live.sessionToken}`, NOW + LINK_TTL_MS + MIN));
});

// ---- cookies ----

test("cookie parsing survives whitespace, encoding and malformed input", () => {
  assert.deepEqual(parseCookies("a=1; b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseCookies("  a = 1 "), { a: "1" });
  assert.deepEqual(parseCookies("a=b%20c"), { a: "b c" });
  assert.deepEqual(parseCookies("a=%E0%A4%A"), { a: "%E0%A4%A" }, "bad escape yields raw, not a throw");
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies("=novalue"), {});
});

test("the session cookie is HttpOnly, Lax, and Secure only where TLS exists", () => {
  const prod = sessionCookie("abc", { secure: true });
  assert.match(prod, /HttpOnly/);
  assert.match(prod, /SameSite=Lax/);
  assert.match(prod, /Secure/);
  assert.match(prod, /Path=\//);

  const local = sessionCookie("abc", { secure: false });
  assert.ok(!/Secure/.test(local), "a Secure cookie over plain http is silently dropped");

  assert.match(clearCookie({ secure: false }), /Max-Age=0/);
});

// ---- tenancy ----

test("each account gets its own database and cannot see another's robots", () => {
  const root = tmp("tenants");
  const stores = new TenantStores(root);

  const a = stores.get(1);
  const b = stores.get(2);
  a.upsertRobot({ connector: "sim", externalId: "servi-1", displayName: "Patio runner" }, NOW);

  assert.equal(a.listRobots().length, 1);
  assert.equal(b.listRobots().length, 0, "account 2 must not see account 1's fleet");

  // and the handle is stable across lookups
  assert.equal(stores.get(1).listRobots().length, 1);
  stores.closeAll();
});

test("tenant stores are cached and evicted least-recently-used first", () => {
  const opened = [];
  const fake = (path) => {
    opened.push(path);
    return { path, closed: false, close() { this.closed = true; } };
  };
  const stores = new TenantStores("/nowhere", { maxOpen: 2, open: fake });

  const s1 = stores.get(1);
  stores.get(2);
  assert.equal(opened.length, 2);

  stores.get(1); // touch 1 so 2 becomes the oldest
  assert.equal(opened.length, 2, "cached, not reopened");

  stores.get(3); // evicts 2
  assert.equal(stores.openCount, 2);
  assert.equal(s1.closed, false, "recently used handle survives");
});

test("tenant paths are per account and refuse anything that is not an id", () => {
  const stores = new TenantStores("/data/tenants");
  assert.equal(stores.pathFor(7), "/data/tenants/7.db");
  for (const bad of [0, -1, 1.5, NaN, "1", "../../etc/passwd", null, undefined]) {
    assert.throws(() => stores.pathFor(bad), /invalid account id/, `rejects ${String(bad)}`);
  }
});

test("forgetting an account closes its handle so a restore is picked up", () => {
  const closed = [];
  const fake = (path) => ({ path, close: () => closed.push(path) });
  const stores = new TenantStores("/nowhere", { open: fake });
  stores.get(4);
  assert.equal(stores.forget(4), true);
  assert.deepEqual(closed, ["/nowhere/4.db"]);
  assert.equal(stores.forget(4), false, "forgetting twice is not an error");
});

// ---- instrumentation ----

test("the funnel counts the six events and the median time to activate", () => {
  const c = ctl();
  const mk = (email, at) => redeemLink(c, requestLink(c, email, at).token, at).account.id;

  const a = mk("a@grill.com", NOW);
  const b = mk("b@grill.com", NOW);
  const slow = mk("c@grill.com", NOW);

  c.recordEvent("landed", { at: NOW });
  for (const [id, span] of [[a, 4 * MIN], [b, 8 * MIN]]) {
    c.recordEvent("account_created", { accountId: id, at: NOW });
    c.recordEvent("activated", { accountId: id, at: NOW + span });
  }
  // an owner who signed up but never got to a number
  c.recordEvent("account_created", { accountId: slow, at: NOW });

  const f = c.funnel();
  assert.equal(f.counts.account_created, 3);
  assert.equal(f.counts.activated, 2);
  assert.equal(f.activatedAccounts, 2);
  assert.equal(f.medianTimeToActivateMs, 6 * MIN, "median of 4 and 8 minutes");
});

test("median time to activate is null before anyone activates", () => {
  const c = ctl();
  assert.equal(c.funnel().medianTimeToActivateMs, null);
  assert.equal(c.funnel().counts.activated, 0);
});

test("an unknown event name is rejected instead of silently stored", () => {
  const c = ctl();
  assert.throws(() => c.recordEvent("activatd", { at: NOW }), /unknown event/);
  for (const name of EVENTS) c.recordEvent(name, { at: NOW });
});

test("hasEvent guards once-per-account events against a page reload", () => {
  const c = ctl();
  const id = redeemLink(c, requestLink(c, "sam@grill.com", NOW).token, NOW).account.id;
  assert.equal(c.hasEvent(id, "activated"), false);
  c.recordEvent("activated", { accountId: id, at: NOW });
  assert.equal(c.hasEvent(id, "activated"), true);
  assert.equal(c.countEvents("activated"), 1);
});

test("event detail round-trips as JSON", () => {
  const c = ctl();
  const id = redeemLink(c, requestLink(c, "sam@grill.com", NOW).token, NOW).account.id;
  c.recordEvent("data_connected", { accountId: id, at: NOW, detail: { rows: 41200, robots: 5 } });
  const rows = c.eventsForAccount(id);
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].detail), { rows: 41200, robots: 5 });
});

// ---- mailer ----

test("the console mailer succeeds without credentials and reports it did not deliver", async () => {
  const lines = [];
  const m = createConsoleMailer({ log: (l) => lines.push(l) });
  const out = await m.send({ to: "sam@grill.com", ...linkEmail({ url: "https://x/y" }) });
  assert.equal(out.ok, true);
  assert.equal(out.delivered, false, "a logged link is not a delivered email");
  assert.match(lines.join(""), /https:\/\/x\/y/);
});

test("the link email states the single-use and expiry terms", () => {
  const e = linkEmail({ url: "https://botlien.com/signin/abc" });
  assert.match(e.text, /works once and expires in 15 minutes/);
  assert.match(e.text, /https:\/\/botlien\.com\/signin\/abc/);
  assert.match(e.subject, /sign-in link/i);
});

test("resend failures are returned, not thrown", async () => {
  const m = createResendMailer({
    apiKey: "k",
    from: "a@b.com",
    fetchImpl: async () => ({ ok: false, status: 422, text: async () => "bad domain" }),
  });
  const out = await m.send({ to: "sam@grill.com", subject: "s", text: "t" });
  assert.equal(out.ok, false);
  assert.match(out.error, /422/);
  assert.match(out.error, /bad domain/);
});

test("a network error reaching resend is also returned", async () => {
  const m = createResendMailer({
    apiKey: "k",
    from: "a@b.com",
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  const out = await m.send({ to: "sam@grill.com", subject: "s", text: "t" });
  assert.equal(out.ok, false);
  assert.match(out.error, /ECONNREFUSED/);
});

test("resend is used when a key exists and console otherwise", () => {
  assert.equal(createMailer({ env: {} }).kind, "console");
  assert.equal(createMailer({ env: { RESEND_API_KEY: "k" } }).kind, "resend");
  assert.equal(createMailer({ secrets: { resend: { api_key: "k" } }, env: {} }).kind, "resend");
});

// ---- rendered pages ----

test("the front door states the job, offers one button, and claims nothing", () => {
  const html = renderLandingHTML();
  assert.match(html, /covering their lease/i);
  assert.match(html, /Start free/);
  assert.match(html, /Bear Universe or Pudu Cloud/);
  assert.ok(!/\$\d/.test(html), "no pricing before an owner has seen their own number");
  assert.ok(!/testimonial|trusted by|ROI/i.test(html), "no claims we cannot support");
});

test("sign-in screens carry the approved copy for each variant", () => {
  assert.match(renderSignInHTML({ variant: "signin" }), /Welcome back/);
  assert.match(renderSignInHTML({ variant: "new" }), /Start with your usage export/);
  assert.match(renderSignInHTML({ variant: "new" }), /Nothing is charged/);
  assert.match(renderSignInHTML({ variant: "failed" }), /couldn&#39;t send that email/);
  assert.match(renderSignInHTML({ variant: "signedout" }), /Signed out/);
});

test("each way a link can fail gets its own explanation", () => {
  assert.match(renderLinkFailedHTML("expired"), /expired/i);
  assert.match(renderLinkFailedHTML("used"), /already used/i);
  assert.match(renderLinkFailedHTML("unknown"), /not valid/i);
  assert.match(renderLinkFailedHTML("garbage"), /not valid/i, "unknown reasons fall back safely");
});

test("the check-email screen shows the address and the fifteen minute limit", () => {
  const html = renderCheckEmailHTML({ email: "sam@harborgrill.com" });
  assert.match(html, /sam@harborgrill\.com/);
  assert.match(html, /works once and expires in 15 minutes/);
  assert.ok(!/Development mode/.test(html));
});

test("the dev link appears only when no mail provider is configured", () => {
  const html = renderCheckEmailHTML({ email: "s@g.com", devLink: "http://127.0.0.1:3230/signin/tok" });
  assert.match(html, /Development mode/);
  assert.match(html, /signin\/tok/);
});

test("rendered pages escape hostile input", () => {
  const evil = `"><script>alert(1)</script>`;
  for (const html of [
    renderSignInHTML({ email: evil }),
    renderCheckEmailHTML({ email: evil }),
  ]) {
    assert.ok(!html.includes("<script>alert(1)"), "no unescaped script tag");
    assert.match(html, /&lt;script&gt;/);
  }
});
