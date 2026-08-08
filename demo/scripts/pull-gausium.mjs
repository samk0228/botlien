// Pull Gausium (gs-robot) OpenAPI → raw JSON on disk + a KPI roll-up.
//
// Gausium is the vendor whose API we can actually reach today: the reference is
// public, auth is plain OAuth client-credentials, and taskReports carries the
// output metrics (area, duration, efficiency, consumables) that Botlien prices.
// That makes this the first real connector after Bear, and the one worth
// modeling KPIs against while Pudu credentials are still pending.
//
// Usage:
//   node scripts/pull-gausium.mjs                 # last 30 days, all robots
//   node scripts/pull-gausium.mjs --days 90
//   node scripts/pull-gausium.mjs --robot SIM00-0000-000-S046
//   node scripts/pull-gausium.mjs --out data/gausium
//
// Credentials go in .claude/secrets.local.json (gitignored):
//   { "gausium": { "client_id": "...", "client_secret": "...", "open_access_key": "..." } }
import { writeFileSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { loadConfig, loadSecrets, ROOT, genesisLog } from "../src/infra.mjs";

const DEFAULT_BASE = "https://openapi.gs-robot.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // hard stop; a vendor that never advances must not spin forever

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

/** OAuth client-credentials, Gausium's custom grant. Returns { token, expiresAtMs }. */
async function getToken(base, creds) {
  const res = await fetch(`${base}/gas/api/v1alpha1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:gaussian:params:oauth:grant-type:open-access-token",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      open_access_key: creds.open_access_key,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`oauth failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  if (!json.access_token) throw new Error(`oauth response had no access_token: ${body.slice(0, 300)}`);
  // expires_in comes back as an absolute epoch-ms in Gausium's examples, not a
  // duration. Treat anything that looks like a timestamp as one, else as secs.
  const raw = Number(json.expires_in);
  const expiresAtMs = raw > 1e12 ? raw : Date.now() + (raw || 3600) * 1000;
  return { token: json.access_token, expiresAtMs };
}

/** GET with bearer auth; throws with the body on failure so vendor errors are readable. */
async function get(base, token, path, params = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/** Drains a paginated Gausium list endpoint. `pick` pulls the array out of the envelope. */
async function paginate(base, token, path, params, pick) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get(base, token, path, { ...params, page, pageSize: PAGE_SIZE });
    const batch = pick(body) ?? [];
    all.push(...batch);
    const total = Number(body.total ?? 0);
    if (batch.length < PAGE_SIZE || (total && all.length >= total)) break;
  }
  return all;
}

/** Task reports → the per-robot output figures Botlien's coverage math needs. */
function rollup(reports) {
  const byRobot = new Map();
  for (const r of reports) {
    const sn = r.robotSerialNumber ?? r.robot ?? "unknown";
    const cur = byRobot.get(sn) ?? {
      robotSerialNumber: sn,
      tasks: 0,
      completedTasks: 0,
      areaSqm: 0,
      plannedAreaSqm: 0,
      runHours: 0,
      waterLiters: 0,
      firstTask: null,
      lastTask: null,
    };
    cur.tasks += 1;
    // completionPercentage is a decimal ratio in the vendor's examples.
    if (Number(r.completionPercentage ?? 0) >= 0.99) cur.completedTasks += 1;
    cur.areaSqm += Number(r.actualCleaningAreaSquareMeter ?? 0);
    cur.plannedAreaSqm += Number(r.plannedCleaningAreaSquareMeter ?? 0);
    cur.runHours += Number(r.durationSeconds ?? 0) / 3600;
    cur.waterLiters += Number(r.waterConsumptionLiter ?? 0);
    const start = Date.parse(r.startTime ?? "");
    if (!Number.isNaN(start)) {
      cur.firstTask = cur.firstTask === null ? start : Math.min(cur.firstTask, start);
      cur.lastTask = cur.lastTask === null ? start : Math.max(cur.lastTask, start);
    }
    byRobot.set(sn, cur);
  }
  for (const cur of byRobot.values()) {
    // Derived, not reported: efficiency is recomputed from our own totals rather
    // than averaging the vendor's per-task efficiencySquareMeterPerHour, because
    // an unweighted mean of rates over uneven task lengths is simply wrong.
    cur.efficiencySqmPerHour = cur.runHours > 0 ? cur.areaSqm / cur.runHours : null;
    cur.planAttainment = cur.plannedAreaSqm > 0 ? cur.areaSqm / cur.plannedAreaSqm : null;
    cur.completionRate = cur.tasks > 0 ? cur.completedTasks / cur.tasks : null;
    const spanDays = cur.firstTask && cur.lastTask ? (cur.lastTask - cur.firstTask) / 86_400_000 + 1 : null;
    cur.spanDays = spanDays;
    cur.runHoursPerDay = spanDays ? cur.runHours / spanDays : null;
    cur.areaSqmPerDay = spanDays ? cur.areaSqm / spanDays : null;
  }
  return [...byRobot.values()].sort((a, b) => b.areaSqm - a.areaSqm);
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

async function main() {
  const config = loadConfig();
  const secrets = loadSecrets();
  const creds = secrets.gausium;
  if (!creds?.client_id || !creds?.client_secret || !creds?.open_access_key) {
    console.error(
      "No Gausium credentials. Add to .claude/secrets.local.json:\n" +
        '  { "gausium": { "client_id": "...", "client_secret": "...", "open_access_key": "..." } }'
    );
    process.exit(1);
  }

  const base = config.gausium?.base ?? DEFAULT_BASE;
  const days = Number(arg("days", 30));
  const outArg = arg("out", "data/gausium");
  const outDir = isAbsolute(outArg) ? outArg : join(ROOT, outArg);
  const onlyRobot = arg("robot");
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);

  mkdirSync(outDir, { recursive: true });
  console.log(`gausium: ${base}  window ${since.toISOString()} → ${until.toISOString()}`);

  const { token, expiresAtMs } = await getToken(base, creds);
  console.log(`authed, token valid until ${new Date(expiresAtMs).toISOString()}`);

  const robots = await paginate(base, token, "/v1alpha1/robots", { relation: "contract" }, (b) => b.robots);
  const targets = onlyRobot ? robots.filter((r) => r.serialNumber === onlyRobot) : robots;
  console.log(`${robots.length} robot(s) on contract${onlyRobot ? `, filtered to ${targets.length}` : ""}`);

  const statuses = [];
  const reports = [];
  for (const r of targets) {
    const sn = r.serialNumber;
    // Status is the live snapshot (one point in time); task reports are the
    // historical output record. Botlien needs both: status feeds the risk flags,
    // reports feed the coverage statement.
    try {
      const s = await get(base, token, `/v1alpha1/robots/${encodeURIComponent(sn)}/status`);
      statuses.push({ serialNumber: sn, ...s });
    } catch (err) {
      console.warn(`  status ${sn}: ${String(err).slice(0, 160)}`);
    }
    try {
      const batch = await paginate(
        base,
        token,
        `/openapi/v2alpha1/robots/${encodeURIComponent(sn)}/taskReports`,
        { startTimeUtcFloor: since.toISOString(), startTimeUtcUpper: until.toISOString() },
        (b) => b.robotTaskReports
      );
      reports.push(...batch);
      console.log(`  ${sn}: ${batch.length} task report(s)`);
    } catch (err) {
      console.warn(`  taskReports ${sn}: ${String(err).slice(0, 160)}`);
    }
  }

  const kpis = rollup(reports);
  const stamp = until.toISOString().slice(0, 10);
  writeFileSync(join(outDir, `robots-${stamp}.json`), JSON.stringify(robots, null, 2));
  writeFileSync(join(outDir, `statuses-${stamp}.json`), JSON.stringify(statuses, null, 2));
  writeFileSync(join(outDir, `task-reports-${stamp}.json`), JSON.stringify(reports, null, 2));
  writeFileSync(join(outDir, `task-reports-${stamp}.csv`), toCsv(reports));
  writeFileSync(join(outDir, `kpis-${stamp}.csv`), toCsv(kpis));

  console.log(`\n${reports.length} task report(s) → ${outDir}\n`);
  console.table(
    kpis.map((k) => ({
      robot: k.robotSerialNumber,
      tasks: k.tasks,
      "area m²": Math.round(k.areaSqm),
      hours: k.runHours.toFixed(1),
      "m²/hr": k.efficiencySqmPerHour ? Math.round(k.efficiencySqmPerHour) : null,
      "hrs/day": k.runHoursPerDay ? k.runHoursPerDay.toFixed(2) : null,
      "plan att.": k.planAttainment ? `${Math.round(k.planAttainment * 100)}%` : null,
      "completed": k.completionRate ? `${Math.round(k.completionRate * 100)}%` : null,
    }))
  );
  genesisLog(`gausium pull: ${targets.length} robot(s), ${reports.length} task report(s) over ${days}d`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
