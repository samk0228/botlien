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
    const wear = store.latestComponentWear(r.id);
    const condition = store.latestCondition(r.id);
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
      // Vendor extras — null everywhere except Gausium, so every consumer of
      // this model has to tolerate their absence.
      manualControlling: condition?.manual_controlling === 1,
      batteryTempC: condition?.battery_temp_c ?? null,
      localizationState: condition?.localization_state ?? null,
      wearAt: wear.length ? wear[0].at : null,
      wear: wear.map((w) => ({
        component: w.component,
        remainingPct: w.remaining_pct,
        levelPct: w.level_pct,
        enabled: w.enabled === 1,
      })),
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
      // Fleet-wide count of parts past rated life. Zero is a real answer and is
      // shown as such; null would mean "no robot reports wear at all".
      spentParts: robotViews.some((r) => r.wear.length)
        ? robotViews.reduce(
            (n, r) => n + r.wear.filter((w) => w.remainingPct !== null && w.remainingPct <= 0).length,
            0
          )
        : null,
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
      ${r.manualControlling || r.batteryTempC !== null || r.localizationState ? `<div class="row sub2">
        ${r.manualControlling ? '<span class="tag manual">manual</span>' : ""}
        ${r.batteryTempC !== null ? `<span>${esc(Math.round(r.batteryTempC))}°C</span>` : ""}
        ${r.localizationState ? `<span>${esc(String(r.localizationState).toLowerCase())}</span>` : ""}
      </div>` : ""}
      <div class="last">last: ${esc(ago(r.lastAt, m.nowMs))}${r.flagCount ? ` · ${r.flagCount} flag${r.flagCount > 1 ? "s" : ""}` : ""}</div>
    </div>`;

  // Wear bars read left-to-right as life remaining. Overrun (a part past its
  // rated life) is shown as an empty bar labelled with how far past it is,
  // because "0%" and "40% over" are different conversations with a borrower.
  const wearRow = (r) => {
    const part = (w) => {
      if (w.remainingPct === null) {
        return `<div class="part"><span class="pname">${esc(w.component)}</span>
          <span class="bar"><i class="unknown" style="width:100%"></i></span>
          <span class="pct dim">n/a</span></div>`;
      }
      const pct = w.remainingPct;
      const cls = pct <= 0 ? "crit" : pct <= 15 ? "warn" : "ok";
      const width = Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
      // A part at 0.4% remaining must not round to a bare "0%": that reads as
      // spent while the summary count correctly excludes it, and the two
      // disagreeing on screen is worse than either being imprecise.
      const label = pct <= 0 ? `${Math.round(-pct)}% over` : pct < 1 ? "<1%" : `${Math.round(pct)}%`;
      return `<div class="part"><span class="pname">${esc(w.component)}</span>
        <span class="bar"><i class="${cls}" style="width:${width}%"></i></span>
        <span class="pct ${cls}">${esc(label)}</span></div>`;
    };
    return `
    <div class="wearrow">
      <div class="wearhead">${esc(r.name)} <span class="t">read ${esc(ago(r.wearAt, m.nowMs))}</span></div>
      <div class="parts">${r.wear.map(part).join("")}</div>
    </div>`;
  };

  const withWear = m.robots.filter((r) => r.wear.length > 0);

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
.card .sub2{color:#8b93a7;font-size:11px;margin-top:4px}
.tag{font-size:9px;font-weight:700;letter-spacing:.5px;padding:1px 5px;border-radius:3px;text-transform:uppercase}
.tag.manual{background:#3d2f00;color:#e8b93e}
.wearrow{padding:8px 4px;border-bottom:1px solid #1d212b}
.wearrow:last-child{border-bottom:0}
.wearhead{font-size:12px;color:#aab1c2;margin-bottom:6px}
.wearhead .t{color:#5b6272;font-size:11px;margin-left:6px}
.parts{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 16px}
.part{display:flex;align-items:center;gap:8px;font-size:11px}
.part .pname{color:#8b93a7;width:96px;flex:none;font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.part .bar{flex:1;height:6px;background:#232733;border-radius:3px;overflow:hidden}
.part .bar i{display:block;height:100%;border-radius:3px}
.part .bar i.ok{background:#37c26a}.part .bar i.warn{background:#b08900}
.part .bar i.crit{background:#c23737}.part .bar i.unknown{background:#2a2f3d}
.part .pct{width:56px;flex:none;text-align:right;font-variant-numeric:tabular-nums}
.part .pct.ok{color:#8b93a7}.part .pct.warn{color:#e8b93e}.part .pct.crit{color:#ff7b7b}
.part .pct.dim{color:#5b6272}
</style></head>
<body>
<h1>BOTLIEN${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="sub">collateral risk monitor · ${esc(new Date(m.nowMs).toLocaleString("en-US"))}</div>
<div class="summary">
  <span><b>${m.summary.robotCount}</b> robots</span>
  <span><b>${m.summary.onlineCount}</b> online</span>
  <span><b>${m.summary.activeFlags}</b> active flags</span>
  <span class="critn"><b>${m.summary.critFlags}</b> critical</span>
  ${m.summary.spentParts !== null ? `<span${m.summary.spentParts > 0 ? ' class="critn"' : ""}><b>${m.summary.spentParts}</b> parts past life</span>` : ""}
</div>
<h2>Fleet</h2>
<div class="cards">${m.robots.map(robotCard).join("")}</div>
${withWear.length > 0 ? `
<h2>Asset condition — consumable life remaining, the collateral's real state</h2>
<div class="panel">${withWear.map(wearRow).join("")}</div>` : ""}
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

// Telemetry exports are megabytes, not form fields. Kept separate from the
// 64KB default so a stray POST elsewhere still cannot balloon memory.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * `tenancy`, when supplied, turns this from a single-fleet board into the
 * multi-tenant product: the front door moves to `/`, the ops board to `/ops`,
 * and every `/owner` route resolves the signed-in account's own store before
 * any of the handlers below run. Omit it and behaviour is exactly as before,
 * which is what `npm run demo` and the existing tests rely on.
 */
export function startBoard(port, {
  getState,
  getOwnerState: baseGetOwnerState = null,
  getFleetContract: baseGetFleetContract = null,
  saveOwnerInputs: baseSaveOwnerInputs = null,
  saveEconomics: baseSaveEconomics = null,
  onboarding: baseOnboarding = null,
  tenancy = null,
  host = process.env.BOTLIEN_HOST ?? "127.0.0.1",
}) {
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];

      // Answered before anything else, and deliberately before the session
      // check, because a health probe carries no cookie: routed any later it
      // would 303 to /signin and the platform would read a redirect as a dead
      // machine and restart a perfectly healthy one, forever.
      if (path === "/health") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, uptime_s: Math.round(process.uptime()) }));
        return;
      }

      // Per-request bindings. Without tenancy these are the single store the
      // process was started with; with it, they are the account's own.
      let getOwnerState = baseGetOwnerState;
      let getFleetContract = baseGetFleetContract;
      let signedIn = null;
      let saveOwnerInputs = baseSaveOwnerInputs;
      let setupStep = null;
      let setupState = null;
      let saveSites = null;
      let connections = null;
      let saveEconomics = baseSaveEconomics;
      let onboarding = baseOnboarding;

      if (tenancy) {
        const { handlePublicRoute, requiresSession } = await import("./gate.mjs");
        if (await handlePublicRoute(req, res, path, tenancy.ctx)) return;

        if (requiresSession(path)) {
          const { currentAccount } = await import("./auth.mjs");
          const account = currentAccount(tenancy.ctx.control, req.headers.cookie, tenancy.ctx.now());
          if (!account) {
            res.writeHead(303, { Location: "/signin" });
            res.end();
            return;
          }
          // The ops board and its JSON show the operator's own connector-fed
          // fleet, not the signed-in owner's. A session is necessary but not
          // sufficient: only an allowlisted operator may see it. A non-operator
          // gets the same 404 as a route that does not exist, so the board's
          // existence is not advertised to customers.
          if ((path === "/ops" || path === "/api/state") && !tenancy.ctx.isOperator(account.email)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
            return;
          }
          const bound = tenancy.forAccount(account);
          getOwnerState = bound.getOwnerState;
          getFleetContract = bound.getFleetContract;
          signedIn = account;
          saveOwnerInputs = bound.saveOwnerInputs ?? null;
          setupStep = bound.step ?? null;
          setupState = bound.setupState ?? null;
          saveSites = bound.saveSites ?? null;
          connections = bound.connections ?? null;
          saveEconomics = bound.saveEconomics;
          onboarding = bound.onboarding;
        }
      }

      // The ops board is ours, not a customer's. It keeps `/` only when there
      // is no public site in front of it.
      const opsPath = tenancy ? path === "/ops" : path === "/" || path === "/index.html";
      if (req.method === "GET" && opsPath) {
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

      // ---- the data contract: every table the dashboard reads, as JSON ----
      if (getFleetContract && req.method === "GET" && path === "/api/v1/fleet") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(await getFleetContract()));
        return;
      }

      // ---- first run, as JSON for the dashboard's own screens ----
      if (setupState && onboarding && path.startsWith("/api/v1/setup")) {
        const reply = (code, body) => {
          res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "GET" && path === "/api/v1/setup") return reply(200, setupState());
        if (req.method === "POST" && path === "/api/v1/setup/business") {
          let body = {};
          try { body = JSON.parse(await readBody(req, 4096)); } catch { return reply(400, { error: "Send JSON: { business }." }); }
          if (!onboarding.saveBusiness(String(body.business ?? ""))) {
            return reply(400, { error: body.business ? "That is not one of the options. Pick the closest match, you can change it later." : "Choose the kind of business this is so we know what your robots' work is worth." });
          }
          return reply(200, setupState());
        }
        if (req.method === "POST" && path === "/api/v1/setup/import") {
          let text;
          try { text = await readBody(req, MAX_UPLOAD_BYTES); } catch { return reply(413, { error: "That file is larger than 25MB." }); }
          const name = new URL(req.url, "http://127.0.0.1").searchParams.get("name") ?? "upload.csv";
          const result = onboarding.importText(text, name);
          if (!result.ok) return reply(400, { error: result.message });
          return reply(200, setupState());
        }
        if (req.method === "POST" && path === "/api/v1/setup/confirm") {
          let body = {};
          try { body = JSON.parse(await readBody(req, 256 * 1024)); } catch { return reply(400, { error: "Send JSON: { robots: [{ id, name, category, excluded }] }." }); }
          // The same form the server page posts, so both paths share one parser.
          const form = new URLSearchParams();
          for (const r of Array.isArray(body.robots) ? body.robots : []) {
            if (r?.id == null) continue;
            form.set(`name_${r.id}`, String(r.name ?? ""));
            form.set(`category_${r.id}`, String(r.category ?? ""));
            if (r.excluded) form.set(`excluded_${r.id}`, "1");
          }
          onboarding.saveConfirm(form);
          return reply(200, setupState());
        }
        if (req.method === "POST" && path === "/api/v1/setup/sites" && saveSites) {
          let body = {};
          try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch { return reply(400, { error: "Send JSON: { sites: [names], robots: { id: site } }." }); }
          try {
            return reply(200, saveSites(body));
          } catch (err) {
            return reply(400, { error: String(err?.message ?? err) });
          }
        }
        return reply(404, { error: "not a setup step" });
      }

      // ---- what the owner types on the dashboard ----
      if (saveOwnerInputs && req.method === "POST" && path === "/api/v1/inputs") {
        const reply = (code, body) => {
          res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(body));
        };
        let body;
        try {
          body = JSON.parse(await readBody(req, 512 * 1024));
        } catch {
          return reply(400, { error: "Send JSON: { account, robots }." });
        }
        try {
          return reply(200, { ok: true, saved: saveOwnerInputs(body) });
        } catch (err) {
          return reply(err?.constructor?.name === "InputError" ? 400 : 500, { error: String(err?.message ?? err) });
        }
      }

      // ---- data sources: an account's own vendor connections ----
      if (connections) {
        const sendJSON = (code, body) => {
          res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "GET" && path === "/api/v1/connections") return sendJSON(200, connections.list());
        if (req.method === "POST" && path === "/api/v1/connections") {
          let body;
          try {
            body = JSON.parse(await readBody(req, 16_384));
          } catch {
            return sendJSON(400, { error: "Send JSON: { vendor, credentials }." });
          }
          try {
            const out = await connections.connect(String(body?.vendor ?? ""), body?.credentials ?? {});
            return sendJSON(200, { ok: true, robotCount: out.robotCount, robots: out.robots, sources: connections.list() });
          } catch (err) {
            return sendJSON(err?.name === "ConnectionError" || err?.constructor?.name === "ConnectionError" ? 400 : 500, { error: String(err?.message ?? err) });
          }
        }
        const del = path.match(/^\/api\/v1\/connections\/([a-z0-9_-]+)$/);
        if (req.method === "DELETE" && del) return sendJSON(connections.disconnect(del[1]) ? 200 : 404, { sources: connections.list() });

        if (path === "/owner/sources") {
          const owner = await import("./owner.mjs");
          const page = (code, opts) => {
            res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(owner.renderSourcesHTML(connections.list(), opts));
          };
          if (req.method === "GET") {
            const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
            return page(200, { connected: q.get("connected"), disconnected: q.get("disconnected") });
          }
          if (req.method === "POST") {
            const form = new URLSearchParams(await readBody(req, 16_384));
            const vendor = form.get("vendor") ?? "";
            if (form.get("action") === "disconnect") {
              connections.disconnect(vendor);
              res.writeHead(303, { Location: `/owner/sources?disconnected=${encodeURIComponent(vendor)}` });
              res.end();
              return;
            }
            try {
              await connections.connect(vendor, Object.fromEntries(form));
              res.writeHead(303, { Location: `/owner/sources?connected=${encodeURIComponent(vendor)}` });
              res.end();
            } catch (err) {
              page(400, { error: String(err?.message ?? err), errorVendor: vendor });
            }
            return;
          }
        }
      }

      // ---- the dashboard: the Demo's screens on this account's data ----
      if (getFleetContract && req.method === "GET" && path === "/app") {
        const { renderAppHTML } = await import("./app.mjs");
        const demo = /[?&]demo=1(&|$)/.test(req.url ?? "");
        // An account with no fleet yet has nothing to show here: send it to
        // the first-run step that gets it one (business, then connect or
        // upload, then confirm). Numbers is not a gate; /app has its own.
        const step = !demo && setupStep ? setupStep() : "done";
        const { pageRunsFirstRun } = await import("./app.mjs");
        if ((step === "business" || step === "import" || step === "confirm") && !pageRunsFirstRun()) {
          res.writeHead(303, { Location: `/owner/${step}` });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(renderAppHTML({ contract: demo ? null : await getFleetContract(), account: signedIn }));
        return;
      }

      // ---- owner views (only mounted when the callbacks are supplied) ----
      if (getOwnerState) {
        const owner = await import("./owner.mjs");

        // ---- onboarding flow ----
        if (onboarding) {
          if (req.method === "GET" && path === "/owner/business") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(owner.renderBusinessHTML(onboarding.getBusiness()));
            return;
          }
          if (req.method === "POST" && path === "/owner/business") {
            let body;
            try {
              body = await readBody(req);
            } catch {
              res.writeHead(413, { "Content-Type": "text/plain" });
              res.end("form too large");
              return;
            }
            const picked = new URLSearchParams(body).get("business");
            if (!onboarding.saveBusiness(picked)) {
              // Re-render WITH a reason. A 400 that silently repaints the same
              // page leaves the owner clicking the same button again.
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end(
                owner.renderBusinessHTML(onboarding.getBusiness(), {
                  error: picked
                    ? "That is not one of the options. Pick the closest match, you can change it later."
                    : "Choose the kind of business this is so we know what your robots' work is worth.",
                })
              );
              return;
            }
            res.writeHead(303, { Location: "/owner/import" });
            res.end();
            return;
          }
          if (req.method === "GET" && path === "/owner/import") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(owner.renderImportHTML({ business: onboarding.getBusiness() }));
            return;
          }
          if (req.method === "POST" && path === "/owner/import") {
            let body;
            try {
              body = await readBody(req, MAX_UPLOAD_BYTES);
            } catch {
              res.writeHead(413, { "Content-Type": "text/plain" });
              res.end("That file is larger than 25MB.");
              return;
            }
            const name = new URL(req.url, "http://127.0.0.1").searchParams.get("name") ?? "upload.csv";
            const result = onboarding.importText(body, name);
            if (!result.ok) {
              res.writeHead(400, { "Content-Type": "text/plain" });
              res.end(result.message);
              return;
            }
            res.writeHead(303, { Location: "/owner/confirm" });
            res.end();
            return;
          }
          if (req.method === "GET" && path === "/owner/confirm") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(owner.renderConfirmHTML(onboarding.confirmState()));
            return;
          }
          if (req.method === "POST" && path === "/owner/confirm") {
            let body;
            try {
              body = await readBody(req);
            } catch {
              res.writeHead(413, { "Content-Type": "text/plain" });
              res.end("form too large");
              return;
            }
            onboarding.saveConfirm(new URLSearchParams(body));
            // Confirmed: the fleet exists, so the dashboard is home from here.
            res.writeHead(303, { Location: "/app" });
            res.end();
            return;
          }
        }

        // The old statement pages are now screens in /app. A signed-in owner
        // with a fleet is forwarded to the same screen there; ?demo=1 and a
        // process without accounts keep the old pages as they were.
        const OLD_PAGES = { "/owner": "dashv2", "/owner/fleet": "robots", "/owner/costs": "costs" };
        if (req.method === "GET" && setupStep && OLD_PAGES[path] && !(req.url ?? "").includes("demo=1")) {
          const step = setupStep();
          if (step === "setup" || step === "done") {
            res.writeHead(303, { Location: `/app?view=${OLD_PAGES[path]}` });
            res.end();
            return;
          }
        }
        if (req.method === "GET" && path === "/owner") {
          const model = await getOwnerState();
          // Never render a zeroed statement: send the owner to the step that
          // actually moves them forward.
          if (onboarding && model.step !== "done" && !(req.url ?? "").includes("demo=1")) {
            res.writeHead(303, { Location: `/owner/${model.step}` });
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(owner.renderOwnerHTML(model));
          return;
        }
        if (req.method === "GET" && path === "/api/owner") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(await getOwnerState()));
          return;
        }
        if (req.method === "GET" && path === "/owner/fleet") {
          const model = await getOwnerState();
          // Same first-run guard as /owner. A fleet list before anything is
          // imported is an empty page reachable from the rail, so send the
          // owner to the step that actually moves them forward instead.
          if (onboarding && model.step !== "done" && !(req.url ?? "").includes("demo=1")) {
            res.writeHead(303, { Location: `/owner/${model.step}` });
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(owner.renderFleetHTML(model));
          return;
        }
        if (req.method === "GET" && path === "/owner/costs") {
          const model = await getOwnerState();
          // Same first-run guard as /owner and /owner/fleet: a costs page before
          // anything is imported is an empty page reachable from the rail.
          if (onboarding && model.step !== "done" && !(req.url ?? "").includes("demo=1")) {
            res.writeHead(303, { Location: `/owner/${model.step}` });
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(owner.renderCostsHTML(model));
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
  // Localhost by default so a laptop never accidentally serves the internet;
  // production sets BOTLIEN_HOST=0.0.0.0 behind the host's TLS terminator.
  server.listen(port, host);
  return server;
}
