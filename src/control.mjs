// Control database: who may sign in, and what happened during onboarding.
//
// Deliberately a SEPARATE database from tenant data. Every other module in this
// codebase assumes one store equals one fleet, and that invariant is what lets
// owner.mjs, finance.mjs, rollup.mjs and the importer stay untouched by
// multi-tenancy. Accounts live here; a robot never does. Nothing in this file
// imports store.mjs and nothing in store.mjs knows an account exists.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
-- API keys an account uses to push robot status (POST /api/v1/events). Only
-- a SHA-256 of the key is kept; the key itself is shown once, when made.
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- Small facts about the service itself, such as when production was last
-- backed up and verified (written by scripts/backup-mark.mjs).
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Sign-in links. Single-use: consumed_at is stamped on redemption and checked
-- on every lookup, so a link forwarded out of an inbox is dead on arrival.
CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

-- The six onboarding events from the spec, plus room for more. Kept here and
-- not in the tenant database so a funnel can be read across all accounts with
-- one query, which is the entire point of measuring landed -> activated.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_name_at ON events(name, at);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id, at);

-- One row per account per vendor: the account's own API keys for that
-- vendor, sealed by vault.mjs, and how the last sync went. Here and not in
-- the tenant file so the scheduler can find every active connection with one
-- query instead of opening every account's database each tick.
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  vendor TEXT NOT NULL,
  secret_sealed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  robot_count INTEGER,
  last_sync_at INTEGER,
  last_ok_at INTEGER,
  last_state TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, vendor)
);
`;

/** The six events onboarding is judged on. Anything outside this set is a typo,
 * so recordEvent rejects it rather than silently writing a name nobody queries. */
export const EVENTS = [
  "landed",
  "brief_sent",
  "account_created",
  "data_connected",
  "fleet_confirmed",
  "numbers_saved",
  "activated",
];

export function openControl(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(SCHEMA);
  return new Control(db);
}

/** Emails are matched case-insensitively and stored lowercase. Owners type
 * their address differently than they did at signup often enough that treating
 * Sam@x.com as a second account would strand them from their own fleet. */
export function normalizeEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export class Control {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  // ---- accounts ----

  /** Returns the existing account for an email, or creates one. Used on token
   * redemption rather than at link-request time: an address that never clicks
   * through must not leave an account behind, or the account count stops
   * meaning anything and every typo becomes a tenant database. */
  upsertAccount(email, nowMs) {
    const e = normalizeEmail(email);
    const found = this.accountByEmail(e);
    if (found) return { account: found, created: false };
    this.db
      .prepare(`INSERT INTO accounts (email, created_at, last_seen_at) VALUES (?, ?, ?)`)
      .run(e, nowMs, nowMs);
    return { account: this.accountByEmail(e), created: true };
  }

  accountByEmail(email) {
    const row = this.db
      .prepare(`SELECT id, email, created_at, last_seen_at FROM accounts WHERE email=?`)
      .get(normalizeEmail(email));
    return row ?? null;
  }

  accountById(id) {
    const row = this.db
      .prepare(`SELECT id, email, created_at, last_seen_at FROM accounts WHERE id=?`)
      .get(id);
    return row ?? null;
  }

  touchAccount(id, nowMs) {
    this.db.prepare(`UPDATE accounts SET last_seen_at=? WHERE id=?`).run(nowMs, id);
  }

  insertApiKey({ accountId, prefix, keyHash, label }, nowMs) {
    const r = this.db
      .prepare(`INSERT INTO api_keys (account_id, prefix, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(accountId, prefix, keyHash, label ?? null, nowMs);
    return Number(r.lastInsertRowid);
  }

  apiKeysForAccount(accountId) {
    return this.db
      .prepare(`SELECT id, prefix, label, created_at, last_used_at, revoked_at FROM api_keys WHERE account_id=? ORDER BY id`)
      .all(accountId);
  }

  /** The live key with this hash, and the account it belongs to. */
  apiKeyByHash(keyHash) {
    return this.db.prepare(`SELECT id, account_id FROM api_keys WHERE key_hash=? AND revoked_at IS NULL`).get(keyHash) ?? null;
  }

  touchApiKey(id, nowMs) {
    this.db.prepare(`UPDATE api_keys SET last_used_at=? WHERE id=?`).run(nowMs, id);
  }

  revokeApiKey(accountId, id, nowMs) {
    return this.db.prepare(`UPDATE api_keys SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL`).run(nowMs, id, accountId).changes > 0;
  }

  getMeta(key) {
    return this.db.prepare(`SELECT value FROM meta WHERE key=?`).get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
  }

  listAccounts() {
    return this.db.prepare(`SELECT id, email, created_at, last_seen_at FROM accounts ORDER BY id`).all();
  }

  countAccounts() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n;
  }

  // ---- login tokens ----

  insertLoginToken({ token, email, createdAt, expiresAt }) {
    this.db
      .prepare(
        `INSERT INTO login_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(token, normalizeEmail(email), createdAt, expiresAt);
  }

  /** Redeem a link. Returns {ok:false, reason} rather than throwing, because
   * every failure here is a screen an owner sees, not an exception: unknown,
   * expired, and used are three different messages. */
  consumeLoginToken(token, nowMs) {
    const row = this.db
      .prepare(`SELECT token, email, expires_at, consumed_at FROM login_tokens WHERE token=?`)
      .get(token);
    if (!row) return { ok: false, reason: "unknown" };
    if (row.consumed_at !== null) return { ok: false, reason: "used" };
    if (nowMs > row.expires_at) return { ok: false, reason: "expired" };
    this.db.prepare(`UPDATE login_tokens SET consumed_at=? WHERE token=?`).run(nowMs, token);
    return { ok: true, email: row.email };
  }

  /** How many links this address asked for since `sinceMs`. The rate limiter
   * reads this so a stranger cannot use our mailer to flood someone's inbox. */
  countRecentTokens(email, sinceMs) {
    return this.db
      .prepare(`SELECT COUNT(*) AS n FROM login_tokens WHERE email=? AND created_at >= ?`)
      .get(normalizeEmail(email), sinceMs).n;
  }

  /** Expired and consumed links are dead weight; nothing reads them after the
   * fact. Called on a timer from the server so the table cannot grow forever. */
  pruneLoginTokens(nowMs) {
    return this.db
      .prepare(`DELETE FROM login_tokens WHERE expires_at < ? OR consumed_at IS NOT NULL`)
      .run(nowMs).changes;
  }

  // ---- sessions ----

  insertSession({ token, accountId, createdAt, expiresAt, userAgent = null }) {
    this.db
      .prepare(
        `INSERT INTO sessions (token, account_id, created_at, expires_at, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(token, accountId, createdAt, expiresAt, userAgent);
  }

  /** Resolve a cookie to an account. An expired row returns null and is left in
   * place for pruneSessions rather than deleted mid-read, so a request never
   * writes just by looking at a cookie. */
  sessionAccount(token, nowMs) {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.account_id, s.expires_at, a.id, a.email, a.created_at, a.last_seen_at
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token=?`,
      )
      .get(token);
    if (!row) return null;
    if (nowMs > row.expires_at) return null;
    return { id: row.id, email: row.email, created_at: row.created_at, last_seen_at: row.last_seen_at };
  }

  deleteSession(token) {
    return this.db.prepare(`DELETE FROM sessions WHERE token=?`).run(token).changes;
  }

  /** Sign out everywhere. The prototype's settings screen offers this, and it
   * is also the only remedy if an owner's laptop walks off. */
  deleteSessionsForAccount(accountId) {
    return this.db.prepare(`DELETE FROM sessions WHERE account_id=?`).run(accountId).changes;
  }

  pruneSessions(nowMs) {
    return this.db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(nowMs).changes;
  }

  // ---- events ----

  /** Detail is stored as JSON text. Unknown names throw: the funnel is six
   * events by design, and a seventh spelled slightly wrong would read as zero. */
  recordEvent(name, { accountId = null, at, detail = null } = {}) {
    if (!EVENTS.includes(name)) throw new Error(`unknown event: ${name}`);
    this.db
      .prepare(`INSERT INTO events (account_id, name, at, detail) VALUES (?, ?, ?, ?)`)
      .run(accountId, name, at, detail === null ? null : JSON.stringify(detail));
  }

  countEvents(name) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE name=?`).get(name).n;
  }

  eventsForAccount(accountId) {
    return this.db
      .prepare(`SELECT name, at, detail FROM events WHERE account_id=? ORDER BY at ASC, id ASC`)
      .all(accountId);
  }

  /** Whether this account has already fired an event. Guards the once-per-account
   * events so a reload of the statement does not inflate `activated`. */
  hasEvent(accountId, name) {
    const row = this.db
      .prepare(`SELECT 1 AS x FROM events WHERE account_id=? AND name=? LIMIT 1`)
      .get(accountId, name);
    return row !== undefined && row !== null;
  }

  /** The only number that matters, per the spec: landed -> activated, and the
   * median time between them. Median rather than mean because one owner who
   * leaves a tab open for a week would otherwise move the average on its own. */
  // ---- vendor connections ----
  // Every read here leaves secret_sealed out except sealedSecret(), so a
  // listing can never carry a credential to a page or a log by accident.
  upsertConnection({ accountId, vendor, secretSealed, robotCount = null }, nowMs) {
    this.db
      .prepare(
        `INSERT INTO connections (account_id, vendor, secret_sealed, status, robot_count, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT(account_id, vendor) DO UPDATE SET secret_sealed=excluded.secret_sealed, status='active',
           robot_count=excluded.robot_count, last_error=NULL, updated_at=excluded.updated_at`
      )
      .run(accountId, vendor, secretSealed, robotCount, nowMs, nowMs);
    return this.connection(accountId, vendor);
  }

  connection(accountId, vendor) {
    return (
      this.db
        .prepare(`SELECT id, account_id, vendor, status, robot_count, last_sync_at, last_ok_at, last_state, last_error, created_at, updated_at
                  FROM connections WHERE account_id=? AND vendor=?`)
        .get(accountId, vendor) ?? null
    );
  }

  connectionsForAccount(accountId) {
    return this.db
      .prepare(`SELECT id, account_id, vendor, status, robot_count, last_sync_at, last_ok_at, last_state, last_error, created_at, updated_at
                FROM connections WHERE account_id=? ORDER BY vendor`)
      .all(accountId);
  }

  activeConnections() {
    return this.db
      .prepare(`SELECT id, account_id, vendor, status, updated_at FROM connections WHERE status='active' ORDER BY id`)
      .all();
  }

  sealedSecret(connectionId) {
    return this.db.prepare(`SELECT secret_sealed FROM connections WHERE id=?`).get(connectionId)?.secret_sealed ?? null;
  }

  recordSync(connectionId, { at, state, detail = null, robotCount = null }) {
    this.db
      .prepare(
        `UPDATE connections SET last_sync_at=?, last_state=?, last_error=?,
           last_ok_at=CASE WHEN ?='ok' THEN ? ELSE last_ok_at END,
           robot_count=COALESCE(?, robot_count) WHERE id=?`
      )
      .run(at, state, state === "ok" ? null : detail, state, at, robotCount, connectionId);
  }

  deleteConnection(accountId, vendor) {
    return this.db.prepare(`DELETE FROM connections WHERE account_id=? AND vendor=?`).run(accountId, vendor).changes > 0;
  }

  funnel() {
    const counts = {};
    for (const name of EVENTS) counts[name] = this.countEvents(name);

    const rows = this.db
      .prepare(
        `SELECT account_id,
                MIN(CASE WHEN name='account_created' THEN at END) AS started,
                MIN(CASE WHEN name='activated' THEN at END) AS activated
         FROM events WHERE account_id IS NOT NULL GROUP BY account_id`,
      )
      .all();

    const spans = rows
      .filter((r) => r.started !== null && r.activated !== null && r.activated >= r.started)
      .map((r) => r.activated - r.started)
      .sort((a, b) => a - b);

    let medianMs = null;
    if (spans.length > 0) {
      const mid = Math.floor(spans.length / 2);
      medianMs = spans.length % 2 === 1 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
    }

    return {
      counts,
      activatedAccounts: spans.length,
      medianTimeToActivateMs: medianMs,
    };
  }
}
