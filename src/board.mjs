// The board: one dark page showing fleet state, active flags split PD / LGD /
// infra, and the connector heartbeat strip. Plain node:http on 127.0.0.1,
// injected getState callback, pure model + renderer exported for tests.
import { createServer } from "node:http";

const MIN = 60_000;

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ago(ms, nowMs) {
  if (ms === null || ms === undefined) return "never";
  const m = Math.max(0, Math.round((nowMs - ms) / MIN));
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const SEVERITY_RANK = { info: 0, warn: 1, crit: 2 };

export function boardModel(store, nowMs) {
  const robots = store.listRobots();
  const active = store.activeFlags();
  const robotById = new Map(robots.map((r) => [r.id, r]));

  const flagView = (f) => ({
    ruleId: f.rule_id,
    severity: f.severity,
    dimension: f.dimension,
    scope: f.scope,
    target: f.robot_id ? (robotById.get(f.robot_id)?.display_name ?? robotById.get(f.robot_id)?.robot_key ?? f.scope) : f.scope,
    raisedAt: f.raised_at,
    detail: f.detail ? JSON.parse(f.detail) : null,
  });

  const flags = {
    pd: active.filter((f) => f.dimension === "pd").map(flagView),
    lgd: active.filter((f) => f.dimension === "lgd").map(flagView),
    infra: active.filter((f) => f.dimension === "infra").map(flagView),
  };

  const robotViews = robots.map((r) => {
    const latest = store.latestSnapshot(r.id);
    const robotFlags = active.filter((f) => f.robot_id === r.id);
    const worst = robotFlags.reduce((w, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), "info");
    return {
      key: r.robot_key,
      name: r.display_name ?? r.robot_key,
      brand: r.brand,
      model: r.model,
      category: r.category,
      connection: latest?.connection_state ?? "unknown",
      batteryPct: latest?.battery_pct ?? null,
      missionState: latest?.mission_state ?? null,
      stuck: latest?.stuck === 1,
      lastAt: latest?.at ?? null,
      source: latest?.source ?? null,
      flagCount: robotFlags.length,
      worstSeverity: robotFlags.length ? worst : null,
    };
  });

  const connectors = [...new Set(robots.map((r) => r.connector))];
  const heartbeats = connectors.map((name) => {
    const latest = store.latestHeartbeat(name);
    const recent = store.heartbeatsBetween(name, nowMs - 6 * 60 * MIN, nowMs).slice(-40);
    return { connector: name, state: latest?.state ?? "unknown", at: latest?.at ?? null, recent: recent.map((h) => h.state) };
  });

  return {
    nowMs,
    demo: robotViews.some((r) => r.source === "sim"),
    summary: {
      robotCount: robotViews.length,
      onlineCount: robotViews.filter((r) => r.connection === "online").length,
      activeFlags: active.length,
      critFlags: active.filter((f) => f.severity === "crit").length,
    },
    robots: robotViews,
    flags,
    heartbeats,
  };
}

const SECTION_TITLES = {
  pd: "PD signals — borrower distress read through the asset",
  lgd: "LGD signals — collateral condition and recovery value",
  infra: "Data pipe — connector health, not robot health",
};

export function renderBoardHTML(m) {
  const sevClass = (s) => (s === "crit" ? "crit" : s === "warn" ? "warn" : "info");
  const flagRow = (f) => `
    <div class="flag ${sevClass(f.severity)}">
      <span class="sev">${esc(f.severity.toUpperCase())}</span>
      <span class="rule">${esc(f.ruleId)}</span>
      <span class="target">${esc(f.target)}</span>
      <span class="detail">${esc(f.detail ? Object.entries(f.detail).map(([k, v]) => `${k}=${v}`).join(" ") : "")}</span>
      <span class="t">${esc(ago(f.raisedAt, m.nowMs))}</span>
    </div>`;

  const flagSection = (key) => {
    const list = m.flags[key];
    return `
    <h2>${esc(SECTION_TITLES[key])}</h2>
    <div class="panel">${list.length === 0 ? `<div class="empty">clear</div>` : list.map(flagRow).join("")}</div>`;
  };

  const robotCard = (r) => `
    <div class="card ${r.worstSeverity ? sevClass(r.worstSeverity) : ""}">
      <div class="name">${esc(r.name)} <span class="brand">${esc([r.brand, r.model].filter(Boolean).join(" "))}</span></div>
      <div class="row">
        <span class="dot ${r.connection === "online" ? "on" : "off"}"></span>
        <span>${esc(r.connection)}</span>
        <span>${r.batteryPct !== null ? esc(Math.round(r.batteryPct)) + "%" : "–"}</span>
        <span>${esc(r.missionState ?? "–")}${r.stuck ? " ⚠stuck" : ""}</span>
      </div>
      <div class="last">last: ${esc(ago(r.lastAt, m.nowMs))}${r.flagCount ? ` · ${r.flagCount} flag${r.flagCount > 1 ? "s" : ""}` : ""}</div>
    </div>`;

  const hbStrip = (h) => `
    <div class="hb">
      <span class="conn">${esc(h.connector)}</span>
      <span class="hbstate ${esc(h.state)}">${esc(h.state.toUpperCase())}</span>
      <span class="ticks">${h.recent.map((s) => `<i class="${esc(s)}"></i>`).join("")}</span>
      <span class="t">${esc(ago(h.at, m.nowMs))}</span>
    </div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Botlien</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}
body{background:#0f1115;color:#d5d9e2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:24px;max-width:980px;margin-inline:auto}
h1{font-size:20px;letter-spacing:2px;margin:0}
h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b93a7;margin:22px 0 8px}
.badge{background:#3d2f00;color:#e8b93e;border:1px solid #6b5400;border-radius:4px;padding:2px 8px;font-size:11px;margin-left:10px;vertical-align:middle}
.sub{color:#8b93a7;font-size:12px;margin-top:4px}
.panel{background:#171a21;border:1px solid #232733;border-radius:8px;padding:10px}
.empty{color:#5b6272;font-size:13px;padding:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.card{background:#171a21;border:1px solid #232733;border-radius:8px;padding:10px}
.card.warn{border-color:#6b5400}.card.crit{border-color:#7a2020}
.card .name{font-size:13px;font-weight:600}
.card .brand{color:#8b93a7;font-weight:400;font-size:11px}
.card .row{display:flex;gap:8px;align-items:center;font-size:12px;margin-top:6px;color:#aab1c2}
.card .last{color:#5b6272;font-size:11px;margin-top:6px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.dot.on{background:#37c26a}.dot.off{background:#e05252}
.flag{display:flex;gap:10px;align-items:baseline;padding:6px 4px;font-size:13px;border-bottom:1px solid #1d212b}
.flag:last-child{border-bottom:0}
.flag .sev{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px}
.flag.warn .sev{background:#3d2f00;color:#e8b93e}
.flag.crit .sev{background:#3d1414;color:#ff7b7b}
.flag .rule{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.flag .target{color:#aab1c2}
.flag .detail{color:#5b6272;font-size:11px;font-family:ui-monospace,Menlo,monospace}
.flag .t{margin-left:auto;color:#5b6272;font-size:11px}
.hb{display:flex;gap:10px;align-items:center;padding:6px 4px;font-size:13px}
.hb .conn{font-family:ui-monospace,Menlo,monospace}
.hbstate{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:#12301c;color:#37c26a}
.hbstate.degraded{background:#3d2f00;color:#e8b93e}
.hbstate.down{background:#3d1414;color:#ff7b7b}
.hbstate.unknown{background:#232733;color:#8b93a7}
.ticks i{display:inline-block;width:5px;height:14px;margin-right:2px;background:#1f7a41;border-radius:1px}
.ticks i.degraded{background:#b08900}.ticks i.down{background:#c23737}.ticks i.unknown{background:#2a2f3d}
.hb .t{margin-left:auto;color:#5b6272;font-size:11px}
.summary{display:flex;gap:18px;margin-top:14px;font-size:13px;color:#aab1c2}
.summary b{color:#d5d9e2}
.summary .critn{color:#ff7b7b}
</style></head>
<body>
<h1>BOTLIEN${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="sub">collateral risk monitor · ${esc(new Date(m.nowMs).toLocaleString("en-US"))}</div>
<div class="summary">
  <span><b>${m.summary.robotCount}</b> robots</span>
  <span><b>${m.summary.onlineCount}</b> online</span>
  <span><b>${m.summary.activeFlags}</b> active flags</span>
  <span class="critn"><b>${m.summary.critFlags}</b> critical</span>
</div>
<h2>Fleet</h2>
<div class="cards">${m.robots.map(robotCard).join("")}</div>
${flagSection("pd")}
${flagSection("lgd")}
${flagSection("infra")}
<h2>Connector heartbeat</h2>
<div class="panel">${m.heartbeats.length === 0 ? '<div class="empty">no connectors yet</div>' : m.heartbeats.map(hbStrip).join("")}</div>
<script>setTimeout(() => location.reload(), 5000);</script>
</body></html>`;
}

// Form bodies are read with a hard cap: this server is a dashboard, not an
// upload endpoint, and an unbounded body would buffer straight into memory.
export const MAX_BODY_BYTES = 64 * 1024;

export function readBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startBoard(port, { getState, getOwnerState = null, saveEconomics = null }) {
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        const model = await getState();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderBoardHTML(model));
        return;
      }
      if (req.method === "GET" && path === "/api/state") {
        const model = await getState();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(model));
        return;
      }

      // ---- owner views (only mounted when the callbacks are supplied) ----
      if (getOwnerState) {
        const owner = await import("./owner.mjs");
        if (req.method === "GET" && path === "/owner") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(owner.renderOwnerHTML(await getOwnerState()));
          return;
        }
        if (req.method === "GET" && path === "/api/owner") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(await getOwnerState()));
          return;
        }
        if (req.method === "GET" && path === "/owner/setup") {
          const saved = (req.url ?? "").includes("saved=1");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(owner.renderSetupHTML(await getOwnerState(), { saved }));
          return;
        }
        if (req.method === "POST" && path === "/owner/setup" && saveEconomics) {
          let body;
          try {
            body = await readBody(req);
          } catch {
            res.writeHead(413, { "Content-Type": "text/plain" });
            res.end("form too large");
            return;
          }
          await saveEconomics(new URLSearchParams(body));
          // 303 so a refresh of the board does not repost the form
          res.writeHead(303, { Location: "/owner/setup?saved=1" });
          res.end();
          return;
        }
      }

      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: String(err).slice(0, 200) }));
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
