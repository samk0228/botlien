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

-- What the owner pays for a robot and what its work is worth. One current row
-- per robot; rate history is a later concern (the backtest reads telemetry, not
-- prices). Absent row = fall back to the category benchmark in rates.mjs.
CREATE TABLE IF NOT EXISTS robot_economics (
  robot_id INTEGER NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  task_basis TEXT NOT NULL,
  rate_cents INTEGER NOT NULL,
  invoice_cents_month INTEGER,
  wage_cents_hour INTEGER,
  operating_hours_day REAL,
  updated_at INTEGER NOT NULL
);

-- Robots the owner says they no longer lease. A separate table because robots
-- cannot take new columns: CREATE TABLE IF NOT EXISTS will not add one to an
-- existing database, and this table predates MIGRATIONS below. New columns
-- now go through a migration instead. Renames and category
-- corrections need no storage here, since display_name and category already
-- exist on robots and are updated in place.
CREATE TABLE IF NOT EXISTS robot_exclusions (
  robot_id INTEGER PRIMARY KEY,
  excluded_at INTEGER NOT NULL
);

-- Vendor status fields that arrive with a snapshot but do not fit
-- status_snapshots, which cannot take new columns for the reason spelled out
-- above robot_exclusions. One row per snapshot, every column nullable: Bear
-- sends none of this and imported CSVs send none of it either.
CREATE TABLE IF NOT EXISTS snapshot_conditions (
  snapshot_id INTEGER PRIMARY KEY,
  robot_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  manual_controlling INTEGER,
  nav_status TEXT,
  localization_state TEXT,
  battery_voltage_v REAL,
  battery_current_a REAL,
  battery_temp_c REAL,
  charger_current_a REAL,
  vendor_report_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conditions_robot_at ON snapshot_conditions(robot_id, at);

-- Consumable and wear-part condition: brushes, squeegees, filters, tanks.
-- The collateral-value table. remaining_pct is stored rather than derived at
-- read time because life_span_hours changes between firmware versions, and a
-- reading has to stay interpretable against the spec it was taken under.
CREATE TABLE IF NOT EXISTS component_wear (
  robot_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  component TEXT NOT NULL,
  level_pct REAL,
  enabled INTEGER,
  life_span_hours REAL,
  used_life_hours REAL,
  remaining_pct REAL,
  UNIQUE(robot_id, at, component)
);
CREATE INDEX IF NOT EXISTS idx_wear_robot_at ON component_wear(robot_id, at);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`;

// Ordered, append-only. Each entry runs once per database, tracked by
// PRAGMA user_version, so a tenant file opened by a newer build picks up the
// tables and columns it is missing. Never edit or reorder a shipped entry:
// add a new one. SCHEMA above stays the version-0 baseline.
export const MIGRATIONS = [
  // 1. What the owner tells us that no robot reports: which site a robot
  //    works at, what its lease promised, and the tickets they opened with
  //    the vendor. These fill the Demo's SITES, CONTRACT and TICKETS tables.
  `CREATE TABLE IF NOT EXISTS sites (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL
   );
   ALTER TABLE robots ADD COLUMN site_id INTEGER;
   CREATE TABLE IF NOT EXISTS robot_contracts (
     robot_id INTEGER PRIMARY KEY,
     start_date TEXT,
     term_months INTEGER,
     payback_months INTEGER,
     uptime_pct REAL,
     equip_cost_cents INTEGER,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS vendor_tickets (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ref TEXT,
     brand TEXT,
     robot_id INTEGER,
     title TEXT NOT NULL,
     opened_at INTEGER NOT NULL,
     responded_at INTEGER,
     status TEXT NOT NULL DEFAULT 'open'
   );`,
];

export function migrate(db) {
  const current = Number(db.prepare("PRAGMA user_version").get().user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${v + 1} failed: ${err.message}`);
    }
  }
  return MIGRATIONS.length;
}

export function openStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return new Store(db);
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  /** Run fn inside one transaction. Only worth reaching for on bulk paths: the
   * demo backfill lands ~150k snapshots, and committing each one separately
   * turns a two-second seed into a two-minute one. Rolls back and rethrows on
   * failure so a half-written history never survives to be read as real. */
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
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

  snapshotTimeRange() {
    const r = this.db.prepare(`SELECT MIN(at) AS min_at, MAX(at) AS max_at FROM status_snapshots`).get();
    return r?.min_at ? { minAt: r.min_at, maxAt: r.max_at } : null;
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

  // Span of the aggregates the owner board actually prices. Distinct from
  // snapshotTimeRange: the board reads rollups, so the period it can honestly
  // report on is the period rollups exist for.
  rollupTimeRange() {
    const r = this.db
      .prepare(`SELECT MIN(bucket_start_at) AS min_at, MAX(bucket_start_at + bucket_ms) AS max_at FROM utilization_rollups`)
      .get();
    return r?.min_at === null || r?.min_at === undefined ? null : { minAt: r.min_at, maxAt: r.max_at };
  }

  // Every robot's rollups in one query. The owner board needs a fleet-wide
  // number, and per-robot reads would be one query per robot per page load.
  rollupsBetweenAll(sinceMs, untilMs) {
    return this.db
      .prepare(
        `SELECT * FROM utilization_rollups WHERE bucket_start_at>=? AND bucket_start_at<=? ORDER BY robot_id, bucket_start_at`
      )
      .all(sinceMs, untilMs);
  }

  // ---- behavioral reads for the tips engine ----
  // These aggregate in SQL rather than returning snapshots. A 30-day window at
  // one sample a minute is ~43k rows per robot, and the board computes tips for
  // every robot on every page load, so pulling raw rows would put a six-figure
  // row count through the renderer to produce five sentences.

  /** Charging behavior per clock hour. Rollups do not carry charging, so this is
   * the one thing tips need that has to come from snapshots. Returned per
   * absolute hour (~720 rows for a 30-day window) and folded to hour-of-day by
   * the caller, which owns the timezone question: SQLite would apply UTC and a
   * dinner rush is a local-time idea. */
  chargingByHour(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(
        `SELECT (at / 3600000) * 3600000 AS hour_start,
                SUM(CASE WHEN charging=1 THEN 1 ELSE 0 END) AS charging_samples,
                COUNT(*) AS samples
         FROM status_snapshots
         WHERE robot_id=? AND at>=? AND at<=?
         GROUP BY hour_start ORDER BY hour_start`
      )
      .all(robotId, sinceMs, untilMs);
  }

  /** Where a robot stalls, clustered onto a metre grid. Counts SAMPLES, not
   * episodes: samples are near-evenly spaced, so a cell's share of samples is a
   * fair reading of its share of stall TIME, which is the quantity the tip
   * prices. Episode counting would answer a different question (how often) and
   * would need an ordered scan of every row.
   *
   * ROUND rather than FLOOR because ROUND is core SQLite everywhere; snapping
   * to the nearest cell instead of the lower one shifts the grid by half a cell
   * and changes nothing about which spot comes out on top. */
  stallHotspots(robotId, sinceMs, untilMs, { gridMeters = 2, limit = 12 } = {}) {
    return this.db
      .prepare(
        `SELECT ROUND(pose_x / ?) * ? AS gx, ROUND(pose_y / ?) * ? AS gy, COUNT(*) AS samples
         FROM status_snapshots
         WHERE robot_id=? AND at>=? AND at<=? AND stuck=1 AND pose_x IS NOT NULL AND pose_y IS NOT NULL
         GROUP BY gx, gy ORDER BY samples DESC LIMIT ?`
      )
      .all(gridMeters, gridMeters, gridMeters, gridMeters, robotId, sinceMs, untilMs, limit);
  }

  /** Total stall samples in the window, the denominator for hotspot share.
   * Counted separately because the hotspot query is LIMITed and its rows
   * therefore do not sum to the whole. */
  stallSampleCount(robotId, sinceMs, untilMs) {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM status_snapshots
           WHERE robot_id=? AND at>=? AND at<=? AND stuck=1 AND pose_x IS NOT NULL AND pose_y IS NOT NULL`
        )
        .get(robotId, sinceMs, untilMs)?.n ?? 0
    );
  }

  /** Stuck samples against all samples, with NO pose requirement.
   *  stallSampleCount() above answers a map question and therefore throws away
   *  rows with no coordinates. This answers a labour question: a robot that
   *  stalls without reporting where it stood still had a person walk over to
   *  it, and dropping those rows would under-count the cost by exactly the
   *  fleets whose vendor sends no pose. */
  stuckSampleCount(robotId, sinceMs, untilMs) {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN stuck=1 THEN 1 ELSE 0 END) AS stuck
         FROM status_snapshots WHERE robot_id=? AND at>=? AND at<=?`
      )
      .get(robotId, sinceMs, untilMs);
    return { total: r?.total ?? 0, stuck: r?.stuck ?? 0 };
  }

  /** Hands-on-controls samples, split by whether the robot was working.
   *
   *  Reads snapshot_conditions, which most feeds never populate: Bear sends no
   *  such field and an imported CSV carries none. A zero `total` therefore
   *  means "not reported", and the caller renders that differently from
   *  "reported, and it was none".
   *
   *  The active split exists because a share has to be converted back into
   *  hours against the right clock. A vendor that reports manual_controlling on
   *  every heartbeat, parked or not, would otherwise turn a 45% flag into 45%
   *  of the wall clock, which is more hours than the machine even ran. The
   *  predicate here (mission_state='active') is deliberately the SAME one
   *  rollup.mjs uses to accumulate active_ms, so the share and the time it is
   *  multiplied by are defined identically and the result cannot exceed the
   *  hours the robot actually worked. */
  manualControlSamples(robotId, sinceMs, untilMs) {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN sc.manual_controlling=1 THEN 1 ELSE 0 END) AS manual,
                SUM(CASE WHEN ss.mission_state='active' THEN 1 ELSE 0 END) AS active_total,
                SUM(CASE WHEN ss.mission_state='active' AND sc.manual_controlling=1 THEN 1 ELSE 0 END) AS active_manual
         FROM snapshot_conditions sc
         JOIN status_snapshots ss ON ss.id = sc.snapshot_id
         WHERE sc.robot_id=? AND sc.at>=? AND sc.at<=?`
      )
      .get(robotId, sinceMs, untilMs);
    return {
      total: r?.total ?? 0,
      manual: r?.manual ?? 0,
      activeTotal: r?.active_total ?? 0,
      activeManual: r?.active_manual ?? 0,
    };
  }

  /** The floor, as a grid, for a set of robots at once.
   *  One query per SITE rather than per robot, because the map is a picture of
   *  a building and a building is shared: two robots stalling either side of
   *  the same doorway are one bad doorway, and per-robot queries would draw it
   *  as two unrelated smudges.
   *
   *  Same ROUND-based snapping as stallHotspots so both read the same grid. */
  poseGrid(robotIds, sinceMs, untilMs, { gridMeters = 2, limit = 4000 } = {}) {
    const ids = (robotIds ?? []).filter((n) => Number.isInteger(n));
    if (ids.length === 0) return [];
    const holes = ids.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT ROUND(pose_x / ?) * ? AS gx, ROUND(pose_y / ?) * ? AS gy,
                COUNT(*) AS samples,
                SUM(CASE WHEN stuck=1 THEN 1 ELSE 0 END) AS stuck_samples
         FROM status_snapshots
         WHERE robot_id IN (${holes}) AND at>=? AND at<=?
           AND pose_x IS NOT NULL AND pose_y IS NOT NULL
         GROUP BY gx, gy ORDER BY samples DESC LIMIT ?`
      )
      .all(gridMeters, gridMeters, gridMeters, gridMeters, ...ids, sinceMs, untilMs, limit);
  }

  // ---- economics ----
  upsertRobotEconomics(robotId, e, nowMs) {
    this.db
      .prepare(
        `INSERT INTO robot_economics (robot_id, task_type, task_basis, rate_cents, invoice_cents_month,
           wage_cents_hour, operating_hours_day, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(robot_id) DO UPDATE SET
           task_type=excluded.task_type, task_basis=excluded.task_basis, rate_cents=excluded.rate_cents,
           invoice_cents_month=excluded.invoice_cents_month, wage_cents_hour=excluded.wage_cents_hour,
           operating_hours_day=excluded.operating_hours_day, updated_at=excluded.updated_at`
      )
      .run(
        robotId, e.taskType, e.taskBasis, e.rateCents,
        e.invoiceCentsMonth ?? null, e.wageCentsHour ?? null, e.operatingHoursDay ?? null, nowMs
      );
  }

  getRobotEconomics(robotId) {
    return this.db.prepare(`SELECT * FROM robot_economics WHERE robot_id=?`).get(robotId) ?? null;
  }

  listRobotEconomics() {
    return this.db.prepare(`SELECT * FROM robot_economics`).all();
  }

  setRobotFleet(robotId, fleetId) {
    this.db.prepare(`UPDATE robots SET fleet_id=? WHERE id=?`).run(fleetId, robotId);
  }

  // ---- fleet confirmation ----
  renameRobot(robotId, displayName) {
    this.db.prepare(`UPDATE robots SET display_name=? WHERE id=?`).run(displayName, robotId);
  }

  // The correction that makes the arithmetic right: an import cannot tell a
  // scrubber from a food runner, and pricing a scrubber per run instead of per
  // hour is wrong by an order of magnitude.
  setRobotCategory(robotId, category) {
    this.db.prepare(`UPDATE robots SET category=? WHERE id=?`).run(category, robotId);
  }

  excludeRobot(robotId, nowMs) {
    this.db
      .prepare(
        `INSERT INTO robot_exclusions (robot_id, excluded_at) VALUES (?, ?)
         ON CONFLICT(robot_id) DO UPDATE SET excluded_at=excluded.excluded_at`
      )
      .run(robotId, nowMs);
  }

  includeRobot(robotId) {
    this.db.prepare(`DELETE FROM robot_exclusions WHERE robot_id=?`).run(robotId);
  }

  listExclusions() {
    return this.db.prepare(`SELECT robot_id FROM robot_exclusions`).all().map((r) => r.robot_id);
  }

  /** Earliest and latest telemetry for one robot, for the confirm screen. */
  robotTimeRange(robotId) {
    const r = this.db
      .prepare(`SELECT MIN(at) AS min_at, MAX(at) AS max_at FROM status_snapshots WHERE robot_id=?`)
      .get(robotId);
    return r?.min_at ? { minAt: r.min_at, maxAt: r.max_at } : null;
  }

  listFleets() {
    return this.db.prepare(`SELECT * FROM fleets ORDER BY id`).all();
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

  // ---- condition + wear ----
  insertCondition(c) {
    this.db
      .prepare(
        `INSERT INTO snapshot_conditions (snapshot_id, robot_id, at, manual_controlling, nav_status,
           localization_state, battery_voltage_v, battery_current_a, battery_temp_c, charger_current_a, vendor_report_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(snapshot_id) DO NOTHING`
      )
      .run(
        c.snapshotId, c.robotId, c.at, boolInt(c.manualControlling), c.navStatus ?? null,
        c.localizationState ?? null, c.batteryVoltageV ?? null, c.batteryCurrentA ?? null,
        c.batteryTempC ?? null, c.chargerCurrentA ?? null, c.vendorReportAt ?? null
      );
  }

  latestCondition(robotId) {
    return (
      this.db.prepare(`SELECT * FROM snapshot_conditions WHERE robot_id=? ORDER BY at DESC LIMIT 1`).get(robotId) ?? null
    );
  }

  conditionsBetween(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(`SELECT * FROM snapshot_conditions WHERE robot_id=? AND at>=? AND at<=? ORDER BY at`)
      .all(robotId, sinceMs, untilMs);
  }

  /** One reading = many components. Re-reading the same instant is idempotent. */
  insertComponentWear(robotId, at, components) {
    const stmt = this.db.prepare(
      `INSERT INTO component_wear (robot_id, at, component, level_pct, enabled, life_span_hours, used_life_hours, remaining_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(robot_id, at, component) DO UPDATE SET
         level_pct=excluded.level_pct, enabled=excluded.enabled, life_span_hours=excluded.life_span_hours,
         used_life_hours=excluded.used_life_hours, remaining_pct=excluded.remaining_pct`
    );
    for (const c of components) {
      stmt.run(
        robotId, at, c.component, c.levelPct ?? null, boolInt(c.enabled),
        c.lifeSpanHours ?? null, c.usedLifeHours ?? null, c.remainingPct ?? null
      );
    }
  }

  /** The current condition of every tracked part, from the most recent reading. */
  latestComponentWear(robotId) {
    return this.db
      .prepare(
        `SELECT * FROM component_wear WHERE robot_id=?
           AND at=(SELECT MAX(at) FROM component_wear WHERE robot_id=?)
         ORDER BY component`
      )
      .all(robotId, robotId);
  }

  componentWearBetween(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(`SELECT * FROM component_wear WHERE robot_id=? AND at>=? AND at<=? ORDER BY at, component`)
      .all(robotId, sinceMs, untilMs);
  }

  // ---- kv ----
  // ---- sites, contracts, tickets (migration 1) ----
  upsertSite(name, nowMs) {
    const found = this.db.prepare(`SELECT id FROM sites WHERE name=?`).get(name);
    if (found) return Number(found.id);
    return Number(this.db.prepare(`INSERT INTO sites (name, created_at) VALUES (?, ?)`).run(name, nowMs).lastInsertRowid);
  }

  listSites() {
    return this.db.prepare(`SELECT * FROM sites ORDER BY id`).all();
  }

  setRobotSite(robotId, siteId) {
    this.db.prepare(`UPDATE robots SET site_id=? WHERE id=?`).run(siteId, robotId);
  }

  upsertRobotContract(robotId, c, nowMs) {
    this.db
      .prepare(
        `INSERT INTO robot_contracts (robot_id, start_date, term_months, payback_months, uptime_pct, equip_cost_cents, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(robot_id) DO UPDATE SET start_date=excluded.start_date, term_months=excluded.term_months,
           payback_months=excluded.payback_months, uptime_pct=excluded.uptime_pct,
           equip_cost_cents=excluded.equip_cost_cents, updated_at=excluded.updated_at`
      )
      .run(robotId, c.startDate ?? null, c.termMonths ?? null, c.paybackMonths ?? null, c.uptimePct ?? null, c.equipCostCents ?? null, nowMs);
  }

  listRobotContracts() {
    return this.db.prepare(`SELECT * FROM robot_contracts`).all();
  }

  insertTicket({ ref = null, brand = null, robotId = null, title, openedAt, respondedAt = null, status = "open" }) {
    return Number(
      this.db
        .prepare(`INSERT INTO vendor_tickets (ref, brand, robot_id, title, opened_at, responded_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(ref, brand, robotId, title, openedAt, respondedAt, status).lastInsertRowid
    );
  }

  listTickets() {
    return this.db.prepare(`SELECT * FROM vendor_tickets ORDER BY opened_at`).all();
  }

  /** Only the samples where something was wrong. Downtime episodes are built
   *  from these alone: a healthy robot at 15-second sampling writes ~180k rows
   *  a month, and none of them change the answer. */
  abnormalSnapshots(robotId, sinceMs, untilMs) {
    return this.db
      .prepare(
        `SELECT at, stuck, e_stop, errors, connection_state, pose_x, pose_y FROM status_snapshots
         WHERE robot_id=? AND at>=? AND at<=? AND (stuck=1 OR e_stop=1 OR (errors IS NOT NULL AND errors != '[]'))
         ORDER BY at`
      )
      .all(robotId, sinceMs, untilMs);
  }

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
