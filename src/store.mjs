// SQLite store. One SCHEMA string, WAL, epoch-ms INTEGER timestamps.
// `at` = event time, `received_at` = ingest time — kept distinct everywhere so
// historical imports (the retrospective backtest) replay through the same
// tables as live data. Flag rows are never deleted; history is backtest input.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS robots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_key TEXT NOT NULL UNIQUE,
  connector TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT,
  brand TEXT,
  model TEXT,
  category TEXT NOT NULL DEFAULT 'delivery',
  fleet_id INTEGER,
  first_seen_at INTEGER,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS fleets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  operator TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_id INTEGER,
  robot_id INTEGER,
  lender TEXT,
  principal_cents INTEGER,
  start_at INTEGER,
  term_months INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector TEXT NOT NULL,
  robot_key TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  seq INTEGER,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_raw_events_robot_at ON raw_events(robot_key, at);

CREATE TABLE IF NOT EXISTS status_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id INTEGER NOT NULL,
  raw_event_id INTEGER,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  connector TEXT NOT NULL,
  source TEXT NOT NULL,
  connection_state TEXT,
  battery_pct REAL,
  charging INTEGER,
  e_stop INTEGER,
  mission_state TEXT,
  mission_id TEXT,
  stuck INTEGER,
  moving INTEGER,
  errors TEXT,
  pose_x REAL,
  pose_y REAL,
  pose_theta REAL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_robot_at ON status_snapshots(robot_id, at);

CREATE TABLE IF NOT EXISTS utilization_rollups (
  robot_id INTEGER NOT NULL,
  bucket_start_at INTEGER NOT NULL,
  bucket_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  online_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  mission_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  stuck_episodes INTEGER NOT NULL DEFAULT 0,
  battery_min_pct REAL,
  battery_max_pct REAL,
  UNIQUE(robot_id, bucket_start_at)
);

CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  robot_id INTEGER,
  fleet_id INTEGER,
  connector TEXT,
  rule_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  raised_at INTEGER NOT NULL,
  cleared_at INTEGER,
  last_eval_at INTEGER NOT NULL,
  detail TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_active ON flags(scope, rule_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_flags_robot ON flags(robot_id, raised_at);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_connector_at ON heartbeats(connector, at);

CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_id INTEGER,
  robot_id INTEGER,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  amount_cents INTEGER,
  detail TEXT,
  source_file TEXT,
  imported_at INTEGER
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`;

export function openStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(SCHEMA);
  return new Store(db);
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  // ---- robots ----
  upsertRobot({ connector, externalId, displayName = null, brand = null, model = null, category = "delivery" }, nowMs) {
    const key = `${connector}:${externalId}`;
    const existing = this.db.prepare(`SELECT id FROM robots WHERE robot_key=?`).get(key);
    if (existing) {
      this.db.prepare(`UPDATE robots SET last_seen_at=? WHERE id=?`).run(nowMs, existing.id);
      return Number(existing.id);
    }
    const r = this.db
      .prepare(
        `INSERT INTO robots (robot_key, connector, external_id, display_name, brand, model, category, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(key, connector, externalId, displayName, brand, model, category, nowMs, nowMs);
    return Number(r.lastInsertRowid);
  }

  getRobotByKey(robotKey) {
    return this.db.prepare(`SELECT * FROM robots WHERE robot_key=?`).get(robotKey) ?? null;
  }

  listRobots() {
    return this.db.prepare(`SELECT * FROM robots ORDER BY robot_key`).all();
  }

  // ---- raw events + snapshots ----
  insertRawEvent({ connector, robotKey = null, kind, source, at, receivedAt, seq = null, payload = null }) {
    const r = this.db
      .prepare(
        `INSERT INTO raw_events (connector, robot_key, kind, source, at, received_at, seq, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(connector, robotKey, kind, source, at, receivedAt, seq, payload);
    return Number(r.lastInsertRowid);
  }

  insertSnapshot(s) {
    const r = this.db
      .prepare(
        `INSERT INTO status_snapshots (robot_id, raw_event_id, at, received_at, connector, source,
           connection_state, battery_pct, charging, e_stop, mission_state, mission_id, stuck, moving,
           errors, pose_x, pose_y, pose_theta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        s.robotId, s.rawEventId ?? null, s.at, s.receivedAt, s.connector, s.source,
        s.connectionState ?? null, s.batteryPct ?? null, boolInt(s.charging), boolInt(s.eStop),
        s.missionState ?? null, s.missionId ?? null, boolInt(s.stuck), boolInt(s.moving),
        s.errors ? JSON.stringify(s.errors) : null,
        s.pose?.x ?? null, s.pose?.y ?? null, s.pose?.theta ?? null
      );
    return Number(r.lastInsertRowid);
  }

  snapshotsBetween(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(`SELECT * FROM status_snapshots WHERE robot_id=? AND at>=? AND at<=? ORDER BY at`)
      .all(robotId, sinceMs, untilMs);
  }

  latestSnapshot(robotId) {
    return (
      this.db.prepare(`SELECT * FROM status_snapshots WHERE robot_id=? ORDER BY at DESC LIMIT 1`).get(robotId) ?? null
    );
  }

  latestOnlineAt(robotId) {
    return (
      this.db
        .prepare(`SELECT MAX(at) AS at FROM status_snapshots WHERE robot_id=? AND connection_state='online'`)
        .get(robotId)?.at ?? null
    );
  }

  // ---- rollups ----
  upsertRollup(r) {
    this.db
      .prepare(
        `INSERT INTO utilization_rollups (robot_id, bucket_start_at, bucket_ms, sample_count, online_ms,
           active_ms, mission_count, error_count, stuck_episodes, battery_min_pct, battery_max_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(robot_id, bucket_start_at) DO UPDATE SET
           bucket_ms=excluded.bucket_ms, sample_count=excluded.sample_count, online_ms=excluded.online_ms,
           active_ms=excluded.active_ms, mission_count=excluded.mission_count, error_count=excluded.error_count,
           stuck_episodes=excluded.stuck_episodes, battery_min_pct=excluded.battery_min_pct,
           battery_max_pct=excluded.battery_max_pct`
      )
      .run(
        r.robotId, r.bucketStartAt, r.bucketMs, r.sampleCount, r.onlineMs, r.activeMs,
        r.missionCount, r.errorCount, r.stuckEpisodes, r.batteryMinPct ?? null, r.batteryMaxPct ?? null
      );
  }

  rollupsBetween(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(
        `SELECT * FROM utilization_rollups WHERE robot_id=? AND bucket_start_at>=? AND bucket_start_at<=? ORDER BY bucket_start_at`
      )
      .all(robotId, sinceMs, untilMs);
  }

  // ---- heartbeats ----
  insertHeartbeat({ connector, at, state, detail = null }) {
    this.db.prepare(`INSERT INTO heartbeats (connector, at, state, detail) VALUES (?, ?, ?, ?)`).run(connector, at, state, detail);
  }

  latestHeartbeat(connector) {
    return this.db.prepare(`SELECT * FROM heartbeats WHERE connector=? ORDER BY at DESC LIMIT 1`).get(connector) ?? null;
  }

  heartbeatsBetween(connector, sinceMs, untilMs) {
    return this.db
      .prepare(`SELECT * FROM heartbeats WHERE connector=? AND at>=? AND at<=? ORDER BY at`)
      .all(connector, sinceMs, untilMs);
  }

  // ---- flags ----
  activeFlags() {
    return this.db.prepare(`SELECT * FROM flags WHERE status='active' ORDER BY raised_at`).all();
  }

  allFlags() {
    return this.db.prepare(`SELECT * FROM flags ORDER BY raised_at`).all();
  }

  raiseFlag({ scope, robotId = null, fleetId = null, connector = null, ruleId, dimension, severity, raisedAt, detail = null }) {
    const r = this.db
      .prepare(
        `INSERT INTO flags (scope, robot_id, fleet_id, connector, rule_id, dimension, severity, status, raised_at, last_eval_at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(scope, robotId, fleetId, connector, ruleId, dimension, severity, raisedAt, raisedAt, detail ? JSON.stringify(detail) : null);
    return Number(r.lastInsertRowid);
  }

  updateFlagEval(id, { severity, lastEvalAt, detail }) {
    this.db
      .prepare(`UPDATE flags SET severity=?, last_eval_at=?, detail=COALESCE(?, detail) WHERE id=?`)
      .run(severity, lastEvalAt, detail ? JSON.stringify(detail) : null, id);
  }

  clearFlag(id, clearedAt) {
    this.db.prepare(`UPDATE flags SET status='cleared', cleared_at=? WHERE id=?`).run(clearedAt, id);
  }

  // ---- fleets / loans / outcomes ----
  insertFleet({ name, operator = null }, nowMs) {
    const r = this.db.prepare(`INSERT INTO fleets (name, operator, created_at) VALUES (?, ?, ?)`).run(name, operator, nowMs);
    return Number(r.lastInsertRowid);
  }

  insertLoan({ fleetId = null, robotId = null, lender = null, principalCents = null, startAt = null, termMonths = null }) {
    const r = this.db
      .prepare(`INSERT INTO loans (fleet_id, robot_id, lender, principal_cents, start_at, term_months) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(fleetId, robotId, lender, principalCents, startAt, termMonths);
    return Number(r.lastInsertRowid);
  }

  insertOutcome({ fleetId = null, robotId = null, kind, at, amountCents = null, detail = null, sourceFile = null }, importedAt) {
    const r = this.db
      .prepare(
        `INSERT INTO outcomes (fleet_id, robot_id, kind, at, amount_cents, detail, source_file, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fleetId, robotId, kind, at, amountCents, detail, sourceFile, importedAt);
    return Number(r.lastInsertRowid);
  }

  listOutcomes() {
    return this.db.prepare(`SELECT * FROM outcomes ORDER BY at`).all();
  }

  // ---- kv ----
  getKV(key) {
    return this.db.prepare(`SELECT value FROM kv WHERE key=?`).get(key)?.value ?? null;
  }

  setKV(key, value) {
    this.db
      .prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, value);
  }
}

function boolInt(v) {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}
