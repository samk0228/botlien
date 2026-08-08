// Retrospective backtest ingest. Takes an operator's historical telemetry
// export (CSV or JSONL) plus a payment/churn outcomes file, and lands them in
// the same tables live data uses — snapshots keep their historical `at`,
// received_at records the import moment, source='import'. The flag engine can
// then replay history through identical rules and correlate against outcomes.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { toEpochMs } from "./normalize.mjs";
import { rebuildRollupsForRobot } from "./rollup.mjs";

/** Minimal CSV parser with quoted-field support. Returns array of objects. */
export function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") pushField();
    else if (ch === "\n") { pushField(); pushRow(); }
    else if (ch !== "\r") field += ch;
  }
  pushField();
  pushRow();
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const pick = (row, ...names) => {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== "") return row[n];
  }
  return null;
};

const toBool = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return null;
};

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

function parseRowErrors(v) {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through to code list */ }
  return String(v)
    .split(/[;|]/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((code) => ({ code, severity: null }));
}

function rowsFromFile(filePath) {
  return rowsFromText(readFileSync(filePath, "utf8"), filePath);
}

/** Same dispatch, but from text already in memory. A browser upload has no
 * path on disk, so the parser needs an entry point that does not read a file. */
export function rowsFromText(text, filename = "") {
  if (String(filename).endsWith(".jsonl")) {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  return parseCSV(text);
}

/**
 * Import historical telemetry. Row fields (flexible): external_id|robot_id|
 * robot_key, at|timestamp|time, connection_state|online, battery_pct|battery,
 * mission_state|state, mission_id, stuck, moving, errors|error_codes, charging.
 * Returns { rows, imported, skipped, robots }.
 */
export function importTelemetry(store, filePath, opts) {
  return importTelemetryFromText(store, readFileSync(filePath, "utf8"), filePath, opts);
}

/**
 * The same import, from text in memory. This is what the upload route calls.
 *
 * NOTE ON CATEGORY: `category` is one value applied to every robot in the file,
 * because a telemetry export says nothing about what kind of work a robot does.
 * A mixed fleet therefore lands as all-delivery, and a cleaning robot would be
 * priced per run instead of per hour, wrong by an order of magnitude. That is
 * why the confirm-fleet step exists: correcting the kind of work is what makes
 * the arithmetic downstream correct, not a nicety.
 */
export function importTelemetryFromText(store, text, filename, { connector = "import", brand = null, category = "delivery", nowMs, rebuild = true, bucketMs = 3_600_000 } = {}) {
  const rows = rowsFromText(text, filename);
  let imported = 0;
  const skipReasons = { total: 0, noRobotId: 0, noTimestamp: 0 };
  const robots = new Set();
  const robotIds = new Set();

  for (const row of rows) {
    const externalId = pick(row, "external_id", "robot_id", "robot_key", "robot", "serial");
    const at = toEpochMs(pick(row, "at", "timestamp", "time", "ts"));
    if (!externalId || !at) {
      // reported per reason, because "312 rows skipped" without a why is not
      // something an owner can act on
      skipReasons.total += 1;
      if (!externalId) skipReasons.noRobotId += 1;
      else skipReasons.noTimestamp += 1;
      continue;
    }
    const robotId = store.upsertRobot({ connector, externalId: String(externalId), brand, category }, nowMs);
    robots.add(String(externalId));
    robotIds.add(robotId);
    const rawEventId = store.insertRawEvent({
      connector,
      robotKey: `${connector}:${externalId}`,
      kind: "import",
      source: "import",
      at,
      receivedAt: nowMs,
      payload: JSON.stringify(row),
    });

    const online = toBool(pick(row, "online"));
    const connectionState = pick(row, "connection_state", "connection") ?? (online === null ? null : online ? "online" : "offline");
    store.insertSnapshot({
      robotId,
      rawEventId,
      at,
      receivedAt: nowMs,
      connector,
      source: "import",
      connectionState: connectionState ? String(connectionState).toLowerCase() : null,
      batteryPct: toNum(pick(row, "battery_pct", "battery", "battery_percent")),
      charging: toBool(pick(row, "charging")),
      eStop: toBool(pick(row, "e_stop", "estop")),
      missionState: pick(row, "mission_state", "state"),
      missionId: pick(row, "mission_id"),
      stuck: toBool(pick(row, "stuck")),
      moving: toBool(pick(row, "moving")),
      errors: parseRowErrors(pick(row, "errors", "error_codes")),
      pose: null,
    });
    imported += 1;
  }

  // Snapshots alone render an empty statement: every owner-facing figure is
  // computed from utilization_rollups, and nothing else writes them for
  // imported data. Without this the whole file-drop path produces zeros.
  let buckets = 0;
  if (rebuild) {
    for (const robotId of robotIds) {
      buckets += rebuildRollupsForRobot(store, robotId, bucketMs).buckets;
    }
  }

  return {
    rows: rows.length,
    imported,
    skipped: skipReasons.total,
    skipReasons,
    robots: [...robots],
    robotIds: [...robotIds],
    buckets,
  };
}

/**
 * Import outcomes (payment_late | payment_missed | churn | default |
 * repossession). Fields: kind|outcome, at|date, robot external id (optional),
 * amount_cents|amount, detail. Returns { rows, imported, skipped }.
 */
export function importOutcomes(store, filePath, { connector = "import", nowMs }) {
  const rows = rowsFromFile(filePath);
  const sourceFile = basename(filePath);
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const kind = pick(row, "kind", "outcome", "event");
    const at = toEpochMs(pick(row, "at", "date", "timestamp"));
    if (!kind || !at) {
      skipped += 1;
      continue;
    }
    const externalId = pick(row, "external_id", "robot_id", "robot_key", "robot");
    let robotId = null;
    if (externalId) {
      const key = String(externalId).includes(":") ? String(externalId) : `${connector}:${externalId}`;
      robotId = store.getRobotByKey(key)?.id ?? null;
    }
    const amount = toNum(pick(row, "amount_cents")) ?? (toNum(pick(row, "amount")) !== null ? Math.round(toNum(pick(row, "amount")) * 100) : null);
    store.insertOutcome(
      { robotId, kind: String(kind).toLowerCase(), at, amountCents: amount, detail: pick(row, "detail", "note"), sourceFile },
      nowMs
    );
    imported += 1;
  }

  return { rows: rows.length, imported, skipped };
}
