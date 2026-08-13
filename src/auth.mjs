// Magic-link sign-in. No passwords anywhere in this codebase, by decision:
// passwords would add hashing, reset flows, breach exposure and a second
// credential for an owner to lose, and buy nothing a mailed link does not.
//
// Tokens are opaque 256-bit random strings looked up in the control database,
// not signed cookies. That costs one indexed read per request and buys three
// things signing cannot: a link can be made single-use, a session can be
// revoked the instant it is deleted, and there is no signing key to rotate or
// leak. Sessions survive a restart because they are rows, not memory.
import { randomBytes, timingSafeEqual, scryptSync } from "node:crypto";

export const LINK_TTL_MS = 15 * 60 * 1000; // "expires in 15 minutes", per the design
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "botlien_session";

/** Resend throttle shown on the check-your-email screen. */
export const RESEND_COOLDOWN_MS = 30 * 1000;
/** Links per address per hour. Generous for a real owner who mistypes or loses
 * one in spam, low enough that we cannot be used to bomb somebody's inbox. */
export const MAX_LINKS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/** Deliberately not a full RFC 5322 implementation. This rejects what an owner
 * would recognise as a typo and lets everything else through to the mailer,
 * which is the only real test of whether an address exists. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export function validEmail(raw) {
  const e = String(raw ?? "").trim();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

/** 32 bytes of CSPRNG as base64url. Long enough that guessing is not a threat
 * model, URL-safe so a link survives being pasted through an email client. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare for equal-length tokens. Used where a token is
 * compared outside a database lookup; SQLite's own index probe is not
 * constant-time, but a timing signal on a 256-bit random value is not a
 * practical attack, whereas an early-exit compare in our own code is free to
 * avoid. */
export function tokensEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

// ---- passwords ----
//
// scrypt from node:crypto, not bcrypt/argon2: this codebase ships with no
// native dependencies and scrypt is memory-hard, in the standard library, and
// good enough that the weak link is the owner's own password, not the KDF.
//
// Parameters are stored INSIDE the hash string rather than as constants read
// at verify time, so raising the cost later does not lock out everyone who
// registered before the change: an old hash still verifies with the old
// parameters recorded in it.

const SCRYPT_N = 16384; // 16 MiB at r=8, comfortably under node's 32 MiB default maxmem
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/** Minimum that is worth enforcing. Length beats composition rules, which
 * mostly teach people to write Password1! and reuse it, so there is no
 * uppercase/symbol requirement here on purpose. */
export const MIN_PASSWORD_LENGTH = 10;

export function validPassword(raw) {
  const p = String(raw ?? "");
  return p.length >= MIN_PASSWORD_LENGTH && p.length <= 1024;
}

/** `scrypt$N$r$p$salt$key`, all hex. Self-describing so verifyPassword needs
 * no knowledge of what the parameters were when this was written. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** False for a null/!malformed hash rather than throwing: an account with no
 * password must fail the check, never bypass it. Comparison is constant-time. */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;
  let expected;
  let actual;
  try {
    expected = Buffer.from(keyHex, "hex");
    if (expected.length === 0) return false;
    actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N, r: R, p: P });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Sign in with an email and a password, opening a session on success.
 *
 * Every failure returns the SAME reason ("bad_credentials"), whether the
 * address has no account, the account has no password, or the password is
 * simply wrong. Telling those apart on the sign-in page would turn it into a
 * customer-list oracle, which is the same reason the check-your-email screen
 * looks identical for a known and an unknown address.
 *
 * A dummy verify runs when no hash exists so the response takes about as long
 * either way, rather than returning instantly for an unknown address and
 * leaking the difference through timing. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

export function signInWithPassword(control, rawEmail, password, nowMs, { userAgent = null } = {}) {
  const email = String(rawEmail ?? "").trim();
  if (!validEmail(email) || !password) return { ok: false, reason: "bad_credentials" };

  const hash = control.passwordHashFor(email);
  if (!hash) {
    verifyPassword(String(password), DUMMY_HASH);
    return { ok: false, reason: "bad_credentials" };
  }
  if (!verifyPassword(String(password), hash)) return { ok: false, reason: "bad_credentials" };

  const account = control.accountByEmail(email);
  if (!account) return { ok: false, reason: "bad_credentials" };
  control.touchAccount(account.id, nowMs);

  const sessionToken = newToken();
  control.insertSession({
    token: sessionToken,
    accountId: account.id,
    createdAt: nowMs,
    expiresAt: nowMs + SESSION_TTL_MS,
    userAgent,
  });
  return { ok: true, account, sessionToken };
}

/** Set or replace an account's password. Returns false if the password is too
 * short, so a caller cannot store something the sign-in page would refuse. */
export function setPassword(control, accountId, password) {
  if (!validPassword(password)) return false;
  control.setPasswordHash(accountId, hashPassword(String(password)));
  return true;
}

// ---- cookies ----

/** Minimal Cookie header parser. Values are percent-decoded; a malformed
 * escape yields the raw value rather than throwing, because a bad cookie must
 * render the signed-out page, never a 500. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** `secure` is off for localhost because a Secure cookie is silently dropped
 * over plain HTTP and sign-in would appear to succeed and then do nothing.
 * Production sets it on. SameSite=Lax so following the emailed link still
 * arrives with the cookie on the top-level navigation. */
export function sessionCookie(token, { secure = true, maxAgeMs = SESSION_TTL_MS } = {}) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookie({ secure = true } = {}) {
  const bits = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

// ---- flows ----

/** Issue a sign-in link. Returns the token so the caller can build the URL and
 * hand it to the mailer.
 *
 * Note what this does NOT do: create an account. An address that never clicks
 * through leaves nothing behind. Accounts appear on redemption only, so a typo
 * never becomes a tenant database and the account count stays honest. */
export function requestLink(control, rawEmail, nowMs) {
  const email = String(rawEmail ?? "").trim();
  if (!validEmail(email)) return { ok: false, reason: "invalid_email" };

  const recent = control.countRecentTokens(email, nowMs - HOUR_MS);
  if (recent >= MAX_LINKS_PER_HOUR) return { ok: false, reason: "rate_limited" };

  const token = newToken();
  control.insertLoginToken({
    token,
    email,
    createdAt: nowMs,
    expiresAt: nowMs + LINK_TTL_MS,
  });
  return { ok: true, token, email, expiresAt: nowMs + LINK_TTL_MS };
}

/** Redeem a link and open a session. The account is created here if this is a
 * first sign-in, and `created` is returned so the caller can fire
 * `account_created` exactly once. */
export function redeemLink(control, token, nowMs, { userAgent = null } = {}) {
  const consumed = control.consumeLoginToken(token, nowMs);
  if (!consumed.ok) return { ok: false, reason: consumed.reason };

  const { account, created } = control.upsertAccount(consumed.email, nowMs);
  control.touchAccount(account.id, nowMs);

  const sessionToken = newToken();
  control.insertSession({
    token: sessionToken,
    accountId: account.id,
    createdAt: nowMs,
    expiresAt: nowMs + SESSION_TTL_MS,
    userAgent,
  });

  return { ok: true, account, created, sessionToken };
}

/** Resolve a request's cookies to an account, or null. The hot path: called on
 * every authenticated request, so it is one indexed join and no writes. */
export function currentAccount(control, cookieHeader, nowMs) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  return control.sessionAccount(token, nowMs);
}

export function signOut(control, cookieHeader) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return false;
  return control.deleteSession(token) > 0;
}

/** Housekeeping for both token tables. Safe to call on a timer and cheap
 * enough to call often; returns what it removed so a caller can log it. */
export function pruneExpired(control, nowMs) {
  return {
    links: control.pruneLoginTokens(nowMs),
    sessions: control.pruneSessions(nowMs),
  };
}
