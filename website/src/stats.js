/* Botlien analytics, modelled on the Comprsly /stats page but rebuilt around
 * a sales-led funnel. Comprsly measures views -> download -> install -> rating,
 * which is a self-serve consumer motion. Botlien has no self-serve step at all:
 * nobody signs up, they book a call. So the stages here are visit -> demo ->
 * engaged with the demo -> asked to talk, and the interesting question is not
 * how many arrived but how deep they went once they did.
 *
 * Everything is counted in DISTINCT sessions, not raw events. One prospect
 * reloading the demo six times is one prospect. */

const DAY = 86400000;
const COOKIE_NAME = "botlien_stats_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/* Events the ingest endpoint will accept. The beacon is on a public page, so
 * the endpoint is public, and an allowlist is what keeps a bored visitor from
 * writing arbitrary rows into the table. */
const ALLOWED_EVENTS = new Set([
  "pageview",
  "lead_submit",
  "demo_open",
  "demo_engage",
  "demo_view",
  "demo_input",
  "demo_time",
  "deck_open",
  "deck_slide",
  "deck_time",
  "session_time",
]);

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/* The cookie carries a hash, never the password itself, so a stolen cookie
 * does not hand over the password that also opens anything else. */
async function tokenFor(password) {
  const data = new TextEncoder().encode("botlien-stats:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Length-independent compare. Overkill for an internal page, but a timing
 * side channel is the kind of thing that is free to close now and awkward
 * to retrofit. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isAuthed(request, env) {
  if (!env.STATS_PASSWORD) return false;
  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie) return false;
  return safeEqual(cookie, await tokenFor(env.STATS_PASSWORD));
}

/* ─────────────────────────  INGEST  ───────────────────────── */

export async function handleEventIngest(request, env) {
  if (!env.ANALYTICS_DB) return new Response(null, { status: 204 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const event = String(body.event || "");
  if (!ALLOWED_EVENTS.has(event)) return new Response(null, { status: 204 });

  // Caps, because every one of these is attacker-controlled free text.
  const session = String(body.session || "").slice(0, 40);
  const label = body.label == null ? null : String(body.label).slice(0, 80);
  const path = String(body.path || "").slice(0, 200);
  const value = Number.isFinite(Number(body.value)) ? Number(body.value) : null;

  // Referrer is read from the payload (the page knows its own document.referrer)
  // but host-only, so we store "news.ycombinator.com" and never a full URL with
  // whatever query string the sender happened to be carrying.
  let referrer = "direct";
  try {
    const raw = String(body.referrer || "");
    if (raw) {
      const h = new URL(raw).hostname.replace(/^www\./, "");
      if (h && h !== "botlien.com") referrer = h;
    }
  } catch {
    /* keep "direct" */
  }

  const country = request.headers.get("CF-IPCountry") || "??";

  try {
    await env.ANALYTICS_DB.prepare(
      "INSERT INTO events (event, ts, session, value, label, path, referrer, country) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(event, Date.now(), session, value, label, path, referrer, country)
      .run();
  } catch {
    // Analytics must never break the page it is measuring.
  }

  return new Response(null, { status: 204 });
}

/* ─────────────────────────  QUERIES  ───────────────────────── */

/* Distinct sessions that fired `event` since `since`. This is the unit for
 * every funnel stage and every headline count. */
async function sessionsSince(db, event, since) {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT session) AS n FROM events WHERE event = ? AND ts >= ?")
    .bind(event, since)
    .first();
  return row ? row.n : 0;
}

async function windowedCounts(db, event, now) {
  const [last24h, last7d, last30d, allTime] = await Promise.all([
    sessionsSince(db, event, now - DAY),
    sessionsSince(db, event, now - 7 * DAY),
    sessionsSince(db, event, now - 30 * DAY),
    sessionsSince(db, event, 0),
  ]);
  return { last24h, last7d, last30d, allTime };
}

/* Share of demo sessions that reached a given thing, which is the number that
 * actually says whether the demo is working. */
async function demoDepth(db, since) {
  const demoSessions = await sessionsSince(db, "demo_open", since);
  if (demoSessions === 0) {
    return { sessions: 0, avgSeconds: null, tabs: [], changedInput: 0, engaged: 0 };
  }

  const [avgRow, tabRows, inputSessions, engagedSessions] = await Promise.all([
    db
      .prepare("SELECT AVG(value) AS avg FROM events WHERE event = 'demo_time' AND ts >= ? AND value > 0")
      .bind(since)
      .first(),
    db
      .prepare(
        `SELECT label, COUNT(DISTINCT session) AS n FROM events
         WHERE event = 'demo_view' AND ts >= ? AND label IS NOT NULL
         GROUP BY label ORDER BY n DESC`
      )
      .bind(since)
      .all(),
    sessionsSince(db, "demo_input", since),
    sessionsSince(db, "demo_engage", since),
  ]);

  return {
    sessions: demoSessions,
    avgSeconds: avgRow && avgRow.avg ? Math.round(avgRow.avg) : null,
    tabs: (tabRows.results || []).map((r) => ({
      label: r.label,
      sessions: r.n,
      pct: Math.round((r.n / demoSessions) * 1000) / 10,
    })),
    changedInput: Math.round((inputSessions / demoSessions) * 1000) / 10,
    engaged: engagedSessions,
  };
}

async function deckStats(db, since) {
  const opens = await sessionsSince(db, "deck_open", since);
  if (opens === 0) return { opens: 0, avgSeconds: null, avgSlide: null, slides: [] };

  const [avgTime, deepest, slideRows] = await Promise.all([
    db
      .prepare("SELECT AVG(value) AS avg FROM events WHERE event = 'deck_time' AND ts >= ? AND value > 0")
      .bind(since)
      .first(),
    // How far the average reader actually got, per session, not per event.
    db
      .prepare(
        `SELECT AVG(deepest) AS avg FROM (
           SELECT session, MAX(value) AS deepest FROM events
           WHERE event = 'deck_slide' AND ts >= ? GROUP BY session)`
      )
      .bind(since)
      .first(),
    db
      .prepare(
        `SELECT value AS slide, COUNT(DISTINCT session) AS n FROM events
         WHERE event = 'deck_slide' AND ts >= ? GROUP BY value ORDER BY value ASC`
      )
      .bind(since)
      .all(),
  ]);

  return {
    opens,
    avgSeconds: avgTime && avgTime.avg ? Math.round(avgTime.avg) : null,
    avgSlide: deepest && deepest.avg ? Math.round(deepest.avg * 10) / 10 : null,
    slides: (slideRows.results || []).map((r) => ({
      slide: r.slide,
      sessions: r.n,
      pct: Math.round((r.n / opens) * 1000) / 10,
    })),
  };
}

async function topBy(db, column, since, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT ${column} AS k, COUNT(DISTINCT session) AS n FROM events
       WHERE ts >= ? AND event = 'pageview' AND ${column} IS NOT NULL
       GROUP BY ${column} ORDER BY n DESC LIMIT ?`
    )
    .bind(since, limit)
    .all();
  return (results || []).map((r) => ({ label: r.k, sessions: r.n }));
}

export async function handleStatsApi(request, env) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: "unauthorized" }, { status: 403 });
  }
  if (!env.ANALYTICS_DB) {
    return Response.json({ error: "Analytics database is not bound." }, { status: 500 });
  }

  const db = env.ANALYTICS_DB;
  const now = Date.now();
  const since30d = now - 30 * DAY;

  const [visits, demoOpens, demoEngaged, leads, deckOpens, depth, deck, referrers, countries] =
    await Promise.all([
      windowedCounts(db, "pageview", now),
      windowedCounts(db, "demo_open", now),
      windowedCounts(db, "demo_engage", now),
      windowedCounts(db, "lead_submit", now),
      windowedCounts(db, "deck_open", now),
      demoDepth(db, since30d),
      deckStats(db, since30d),
      topBy(db, "referrer", since30d),
      topBy(db, "country", since30d),
    ]);

  /* Daily series, distinct sessions per day per event. Zero-filled so the
   * chart has a point for every day rather than skipping quiet ones. */
  const { results: dailyRows } = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, event,
              COUNT(DISTINCT session) AS n
       FROM events WHERE ts >= ? AND event IN ('pageview','demo_open','lead_submit')
       GROUP BY day, event ORDER BY day ASC`
    )
    .bind(since30d)
    .all();

  const dayMap = {};
  for (const r of dailyRows || []) {
    dayMap[r.day] = dayMap[r.day] || {};
    dayMap[r.day][r.event] = r.n;
  }
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const key = new Date(now - i * DAY).toISOString().slice(0, 10);
    const row = dayMap[key] || {};
    daily.push({
      date: key,
      visits: row.pageview || 0,
      demoOpens: row.demo_open || 0,
      leads: row.lead_submit || 0,
    });
  }

  /* Previous 30 days, so each headline can show whether it is moving. */
  const prevWindow = async (event) => {
    const row = await db
      .prepare("SELECT COUNT(DISTINCT session) AS n FROM events WHERE event = ? AND ts >= ? AND ts < ?")
      .bind(event, now - 60 * DAY, since30d)
      .first();
    return row ? row.n : 0;
  };
  const [prevVisits, prevDemo, prevLeads] = await Promise.all([
    prevWindow("pageview"),
    prevWindow("demo_open"),
    prevWindow("lead_submit"),
  ]);

  return Response.json({
    generatedAt: now,
    totals: { visits, demoOpens, demoEngaged, leads, deckOpens },
    previous30d: { visits: prevVisits, demoOpens: prevDemo, leads: prevLeads },
    daily,
    funnel: [
      { label: "Site visits", value: visits.last30d },
      { label: "Demo opened", value: demoOpens.last30d },
      { label: "Demo engaged", value: demoEngaged.last30d },
      { label: "Let's talk sent", value: leads.last30d },
    ],
    demo: depth,
    deck,
    referrers,
    countries,
  });
}

/* ─────────────────────────  AUTH ROUTES  ───────────────────────── */

export async function handleStatsLogin(request, env) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  if (!env.STATS_PASSWORD || !safeEqual(password, env.STATS_PASSWORD)) {
    return Response.redirect(new URL("/stats?error=1", request.url).toString(), 303);
  }
  const token = await tokenFor(env.STATS_PASSWORD);
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/stats", request.url).toString(),
      "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
    },
  });
}

export async function handleStats(request, env) {
  const html = (await isAuthed(request, env)) ? DASHBOARD_HTML : LOGIN_HTML;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Internal page. Keep it out of search results and out of caches.
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}

/* ─────────────────────────  PAGES  ───────────────────────── */

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">`;

const LOGIN_HTML = `<!doctype html>
<html lang="en"><head>${HEAD}<title>Sign in · Botlien Analytics</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:#0A0A0A;
       font-family:-apple-system,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  header{max-width:400px;margin:0 auto;padding:32px 24px 0}
  .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#0A0A0A}
  .brand img{width:22px;height:auto}
  .brand span{font-size:17px;font-weight:600;letter-spacing:-0.01em}
  main{max-width:400px;margin:0 auto;padding:44px 24px 64px}
  h1{font-size:22px;font-weight:700;letter-spacing:-0.015em;margin:0 0 6px}
  p.sub{font-size:14px;color:#6A6A6A;margin:0 0 24px}
  form{display:flex;flex-direction:column;gap:10px}
  input{font-size:16px;padding:12px 14px;border:1px solid #E3E3E3;border-radius:10px;
        font-family:inherit;outline:none}
  input:focus{border-color:#0A0A0A}
  button{appearance:none;border:none;background:#0A0A0A;color:#fff;font-size:14px;font-weight:600;
         padding:13px 14px;border-radius:10px;cursor:pointer;min-height:44px}
  #err{display:none;font-size:13px;color:#3D3D3D;margin:12px 0 0}
</style></head>
<body>
  <header><a class="brand" href="/" aria-label="Botlien home">
    <img src="/logo-mark-88.png" alt=""><span>Botlien</span></a></header>
  <main>
    <h1>Analytics sign in</h1>
    <p class="sub">Internal, not indexed. Enter the password to continue.</p>
    <form method="POST" action="/stats/login">
      <input type="password" name="password" autofocus placeholder="Password" autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>
    <p id="err">Wrong password, try again.</p>
  </main>
<script>
if (new URLSearchParams(location.search).get("error")) {
  document.getElementById("err").style.display = "block";
  history.replaceState(null, "", "/stats");
}
</script>
</body></html>`;

const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head>${HEAD}<title>Botlien Analytics</title>
<style>
  :root{color-scheme:light;--ink:#0A0A0A;--dim:#6A6A6A;--faint:#9A9A9A;--line:#E9E9EA;--bg:#fff;--soft:#F7F7F8}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:-apple-system,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 22px 80px}
  .top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
  h1{font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0}
  h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
     color:var(--faint);margin:38px 0 12px}
  #updated{font-size:12.5px;color:var(--faint)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:18px}
  .card{border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .card .label{font-size:12px;font-weight:700;color:var(--dim);margin-bottom:10px}
  .row{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;
       color:var(--dim);padding:4px 0}
  .row .n{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
  .big{font-size:30px;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
  .delta{font-size:12px;font-weight:700}
  .up{color:#1B7F4B}.down{color:#A33}.flat{color:var(--faint)}
  .funnel-row{display:grid;grid-template-columns:150px 1fr 64px;gap:12px;align-items:center;
              padding:7px 0;font-size:13px}
  .track{background:var(--soft);border-radius:6px;overflow:hidden;height:30px}
  .fill{background:var(--ink);height:100%;display:flex;align-items:center;padding:0 10px;
        color:#fff;font-size:12.5px;font-weight:700;border-radius:6px;min-width:2px}
  .conv{font-size:12.5px;font-weight:700;color:var(--dim);text-align:right;
        font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:9px 4px;border-bottom:1px solid var(--line)}
  td.n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .bars div{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px}
  .bars .bt{flex:1;height:8px;background:var(--soft);border-radius:4px;overflow:hidden}
  .bars .bf{height:100%;background:var(--ink);border-radius:4px}
  .bars .bv{width:56px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .empty{color:var(--faint);font-size:13px;padding:14px 0}
  svg{display:block;width:100%;height:auto;overflow:visible}
  .axis{display:flex;justify-content:space-between;font-size:11.5px;color:var(--faint);margin-top:6px}
  .legend{display:flex;gap:16px;font-size:12px;color:var(--dim);margin-bottom:8px}
  .legend i{display:inline-block;width:10px;height:2px;vertical-align:middle;margin-right:5px}
  @media (max-width:600px){
    .funnel-row{grid-template-columns:1fr;gap:4px}
    .conv{text-align:left}
    .wrap{padding:20px 16px 64px}
  }
</style></head>
<body><div class="wrap">
  <div class="top"><h1>Analytics</h1><div id="updated"></div></div>
  <div class="cards" id="cards"></div>

  <h2>Conversion funnel &middot; last 30 days</h2>
  <div id="funnel"></div>

  <h2>Last 30 days</h2>
  <div class="legend"><span><i style="background:#0A0A0A"></i>Visits</span>
    <span><i style="background:#8A8A87"></i>Demo opens</span>
    <span><i style="background:#C9C9C6"></i>Let's talk</span></div>
  <div id="chart"></div><div class="axis" id="axis"></div>

  <h2>Inside the demo &middot; last 30 days</h2>
  <div id="demo"></div>

  <h2>Investor deck &middot; last 30 days</h2>
  <div id="deck"></div>

  <h2>Top referrers</h2><div id="referrers"></div>
  <h2>Top countries</h2><div id="countries"></div>
</div>
<script>
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());
const secs = (s) => {
  if (s == null) return "—";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m + "m " + String(s % 60).padStart(2, "0") + "s";
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "—");

function delta(curr, prev) {
  if (!prev) return '<span class="delta flat">no prior data</span>';
  const d = ((curr - prev) / prev) * 100;
  const cls = d > 0.5 ? "up" : d < -0.5 ? "down" : "flat";
  const sign = d > 0 ? "+" : "";
  return '<span class="delta ' + cls + '">' + sign + d.toFixed(1) + "% vs prior 30d</span>";
}

function windowRows(t) {
  return ['<div class="row"><span>Last 24h</span><span class="n">' + fmt(t.last24h) + "</span></div>",
    '<div class="row"><span>Last 7d</span><span class="n">' + fmt(t.last7d) + "</span></div>",
    '<div class="row"><span>Last 30d</span><span class="n">' + fmt(t.last30d) + "</span></div>",
    '<div class="row"><span>All time</span><span class="n">' + fmt(t.allTime) + "</span></div>"].join("");
}

function renderCards(d) {
  const t = d.totals, p = d.previous30d;
  document.getElementById("cards").innerHTML = [
    '<div class="card"><div class="label">Site visits</div><div class="big">' + fmt(t.visits.last30d) +
      "</div>" + delta(t.visits.last30d, p.visits) + windowRows(t.visits) + "</div>",
    '<div class="card"><div class="label">Demo opened</div><div class="big">' + fmt(t.demoOpens.last30d) +
      "</div>" + delta(t.demoOpens.last30d, p.demoOpens) + windowRows(t.demoOpens) + "</div>",
    '<div class="card"><div class="label">Let\\'s talk sent</div><div class="big">' + fmt(t.leads.last30d) +
      "</div>" + delta(t.leads.last30d, p.leads) + windowRows(t.leads) + "</div>",
    '<div class="card"><div class="label">Visit &rarr; demo rate</div><div class="big">' +
      pct(t.demoOpens.last30d, t.visits.last30d) + '</div><div class="row"><span>Last 7d</span><span class="n">' +
      pct(t.demoOpens.last7d, t.visits.last7d) + '</span></div><div class="row"><span>All time</span><span class="n">' +
      pct(t.demoOpens.allTime, t.visits.allTime) + "</span></div></div>",
  ].join("");
}

function renderFunnel(stages) {
  const max = Math.max(1, stages[0].value);
  document.getElementById("funnel").innerHTML = stages.map((s, i) => {
    const w = Math.max((s.value / max) * 100, s.value > 0 ? 5 : 0);
    const conv = i === 0 ? "" : pct(s.value, stages[i - 1].value);
    return '<div class="funnel-row"><div>' + esc(s.label) + '</div>' +
      '<div class="track"><div class="fill" style="width:' + w + '%">' + fmt(s.value) + "</div></div>" +
      '<div class="conv">' + conv + "</div></div>";
  }).join("");
}

function renderChart(daily) {
  const W = 900, H = 200;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.visits, d.demoOpens, d.leads)));
  const x = (i) => (i / Math.max(1, daily.length - 1)) * W;
  const y = (v) => H - (v / max) * H;
  const line = (key) => daily.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(d[key]).toFixed(1)).join(" ");
  document.getElementById("chart").innerHTML =
    '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" style="height:200px">' +
    '<path d="' + line("visits") + '" fill="none" stroke="#0A0A0A" stroke-width="2"/>' +
    '<path d="' + line("demoOpens") + '" fill="none" stroke="#8A8A87" stroke-width="2"/>' +
    '<path d="' + line("leads") + '" fill="none" stroke="#C9C9C6" stroke-width="2"/></svg>';
  const f = (s) => s.slice(5).replace("-", "/");
  document.getElementById("axis").innerHTML =
    "<span>" + f(daily[0].date) + "</span><span>peak " + fmt(max) + "</span><span>" + f(daily[daily.length - 1].date) + "</span>";
}

function bars(rows, labelKey, valueKey, pctKey) {
  if (!rows.length) return '<div class="empty">Nothing recorded yet.</div>';
  const max = Math.max(...rows.map((r) => r[valueKey]), 1);
  return '<div class="bars">' + rows.map((r) =>
    "<div><span style='flex:0 0 150px'>" + esc(r[labelKey]) + "</span>" +
    "<span class='bt'><span class='bf' style='width:" + (r[valueKey] / max) * 100 + "%'></span></span>" +
    "<span class='bv'>" + (pctKey ? r[pctKey] + "%" : fmt(r[valueKey])) + "</span></div>").join("") + "</div>";
}

function renderDemo(d) {
  const el = document.getElementById("demo");
  if (!d.sessions) { el.innerHTML = '<div class="empty">No demo sessions in the last 30 days.</div>'; return; }
  el.innerHTML =
    '<div class="cards" style="margin-top:0">' +
      '<div class="card"><div class="label">Demo sessions</div><div class="big">' + fmt(d.sessions) + "</div></div>" +
      '<div class="card"><div class="label">Engaged (clicked something)</div><div class="big">' +
        pct(d.engaged, d.sessions) + '</div><div class="row"><span>Sessions</span><span class="n">' + fmt(d.engaged) + "</span></div></div>" +
      '<div class="card"><div class="label">Avg. time in demo</div><div class="big">' + secs(d.avgSeconds) + "</div></div>" +
      '<div class="card"><div class="label">Changed an input</div><div class="big">' + d.changedInput + "%</div>" +
        '<div class="row" style="color:#9A9A9A">Typed a wage or rate of their own.</div></div>' +
    "</div>" +
    "<h2 style='margin-top:26px'>Which tabs they opened</h2>" + bars(d.tabs, "label", "sessions", "pct");
}

function renderDeck(d) {
  const el = document.getElementById("deck");
  if (!d.opens) { el.innerHTML = '<div class="empty">No deck opens in the last 30 days. The deck is only tracked once it is served from botlien.com/deck.</div>'; return; }
  el.innerHTML =
    '<div class="cards" style="margin-top:0">' +
      '<div class="card"><div class="label">Deck opens</div><div class="big">' + fmt(d.opens) + "</div></div>" +
      '<div class="card"><div class="label">Avg. time reading</div><div class="big">' + secs(d.avgSeconds) + "</div></div>" +
      '<div class="card"><div class="label">Avg. slide reached</div><div class="big">' + (d.avgSlide ?? "—") + "</div></div>" +
    "</div>" +
    "<h2 style='margin-top:26px'>How far they got</h2>" +
    bars(d.slides.map((s) => ({ label: "Slide " + s.slide, sessions: s.sessions, pct: s.pct })), "label", "sessions", "pct");
}

function table(rows) {
  if (!rows.length) return '<div class="empty">Nothing recorded yet.</div>';
  return "<table>" + rows.map((r) =>
    "<tr><td>" + esc(r.label) + '</td><td class="n">' + fmt(r.sessions) + "</td></tr>").join("") + "</table>";
}

async function load() {
  const res = await fetch("/stats/api", { credentials: "same-origin" });
  if (!res.ok) { document.querySelector(".wrap").innerHTML = "<p>Session expired. <a href='/stats'>Sign in again</a>.</p>"; return; }
  const d = await res.json();
  document.getElementById("updated").textContent =
    "Updated " + new Date(d.generatedAt).toLocaleString() + " · counted in unique sessions";
  renderCards(d);
  renderFunnel(d.funnel);
  renderChart(d.daily);
  renderDemo(d.demo);
  renderDeck(d.deck);
  document.getElementById("referrers").innerHTML = table(d.referrers);
  document.getElementById("countries").innerHTML = table(d.countries);
}
load();
</script>
</body></html>`;

/* ─────────────────────────  SERVER-SIDE RECORDING  ───────────────────────── */

/* Used for events the server is the only honest witness to. A lead is the one
 * that matters: the client could fire a "lead_submit" beacon, but then a
 * failed send would still be counted, and the funnel's last stage would
 * overstate itself. Recorded here only after Resend accepted the message.
 * ctx.waitUntil so the visitor's response is never held up by a write. */
export function recordEvent(env, ctx, request, event, extra = {}) {
  if (!env.ANALYTICS_DB) return;
  const write = env.ANALYTICS_DB.prepare(
    "INSERT INTO events (event, ts, session, value, label, path, referrer, country) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(
      event,
      Date.now(),
      String(extra.session || "").slice(0, 40),
      extra.value ?? null,
      extra.label ?? null,
      extra.path ?? null,
      extra.referrer ?? "direct",
      request.headers.get("CF-IPCountry") || "??"
    )
    .run()
    .catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(write);
}

/* ─────────────────────────  CLIENT BEACON  ───────────────────────── */

/* Injected into every HTML page the worker serves. One script covers three
 * page kinds because they share a session id: a visitor who lands on the site,
 * opens the demo and then reads the deck is one session across all three, so
 * the funnel can actually follow them.
 *
 * No cookies, no fingerprinting, no third party. The session id lives in
 * sessionStorage, so it dies with the tab and cannot track anyone between
 * visits, which is all this needs to answer "did this person go deeper".
 * Everything is wrapped so that an analytics failure can never take a page
 * down with it. */
export const BEACON = `<script>(function(){try{
var K='botlien_sid',sid=sessionStorage.getItem(K);
if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem(K,sid);}
var p=location.pathname;
function send(ev,label,value){try{
  var b=JSON.stringify({event:ev,session:sid,label:label,value:value,path:p,referrer:document.referrer});
  if(navigator.sendBeacon){navigator.sendBeacon('/api/event',new Blob([b],{type:'application/json'}));}
  else{fetch('/api/event',{method:'POST',body:b,keepalive:true,headers:{'Content-Type':'application/json'}});}
}catch(e){}}
var isDemo=p.indexOf('/demo')===0||p.indexOf('/software')===0,isDeck=p.indexOf('/deck')===0;
send(isDemo?'demo_open':isDeck?'deck_open':'pageview');
var t0=Date.now(),engaged=false,typed=false;
var NAMES={dashv2:'Dashboard',robots:'Fleet',setup:'Numbers'};
if(isDemo){
  send('demo_view','Dashboard');
  addEventListener('click',function(e){
    if(!engaged){engaged=true;send('demo_engage');}
    var el=e.target&&e.target.closest?e.target.closest('[data-view]'):null;
    if(el&&el.getAttribute('data-view')){var v=el.getAttribute('data-view');send('demo_view',NAMES[v]||v);}
  },{passive:true,capture:true});
  addEventListener('change',function(){if(!typed){typed=true;send('demo_input');}},{passive:true,capture:true});
}
if(isDeck){
  var seen={};
  function slide(){var n=parseInt((location.hash||'#1').slice(1),10);
    if(n>0&&!seen[n]){seen[n]=1;send('deck_slide',null,n);}}
  slide();addEventListener('hashchange',slide);
}
/* pagehide rather than unload: unload does not fire on iOS Safari, which is
   exactly where a deck or demo gets read. */
addEventListener('pagehide',function(){
  var s=Math.round((Date.now()-t0)/1000);
  if(s>0&&s<7200){send(isDemo?'demo_time':isDeck?'deck_time':'session_time',null,s);}
});
}catch(e){}})();</script>`;
