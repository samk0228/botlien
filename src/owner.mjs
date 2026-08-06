// The owner board: the same telemetry the risk board reads, priced. One page
// answering one question, "are these robots covering what I pay for them", plus
// the onboarding screen that supplies the five numbers the math needs.
//
// Kept out of board.mjs on purpose: that board sells risk monitoring to whoever
// holds the paper, this one sells operating clarity to the owner. Same pipeline,
// different products, so they do not share a renderer.
import { economicsFor, BENCHMARKS, TASK_BASIS } from "./rates.mjs";
import { robotFinancials, fleetFinancials, byTaskType, formulaLine } from "./finance.mjs";
import { esc } from "./board.mjs";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_SITE = "Main site";

export function money(cents) {
  if (cents === null || cents === undefined) return "–";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ratio(x) {
  return x === null || x === undefined ? "–" : `${x.toFixed(2)}x`;
}

export function pct(x) {
  return x === null || x === undefined ? "–" : `${Math.round(x)}%`;
}

function num(x, basis) {
  if (x === null || x === undefined) return "–";
  return basis === TASK_BASIS.ACTIVE_HOUR ? x.toFixed(1) : Math.round(x).toLocaleString("en-US");
}

/** Read model for the owner board. Pure w.r.t. the injected clock, like every
 * other read path here, so tests can pin time. */
export function ownerModel(store, nowMs, config = {}) {
  const windowDays = config.owner?.window_days ?? DEFAULT_WINDOW_DAYS;
  const requestedFrom = nowMs - windowDays * DAY_MS;

  // Clamp the window to the telemetry that actually exists. Without this the
  // invoice prorates across days the robots were never observed, and coverage
  // reads as a catastrophe for reasons that have nothing to do with the robots:
  // a demo whose clock outruns its data, or an owner who just dropped a
  // three-day export, would both open to a near-zero number.
  //
  // The clamp uses the GLOBAL telemetry range, never per robot. A robot that
  // sat dark for three weeks must still owe its full share of the invoice,
  // otherwise downtime would quietly flatter coverage and the utilization
  // warning would never fire.
  const range = store.rollupTimeRange();
  const fromMs = range ? Math.max(requestedFrom, range.minAt) : requestedFrom;
  const toMs = range ? Math.max(fromMs, Math.min(nowMs, range.maxAt)) : nowMs;
  const clamped = range !== null && (fromMs > requestedFrom || toMs < nowMs);
  const observedDays = Math.max(0, (toMs - fromMs) / DAY_MS);

  const robots = store.listRobots();
  const econByRobot = new Map(store.listRobotEconomics().map((r) => [r.robot_id, r]));
  const fleetsById = new Map(store.listFleets().map((f) => [f.id, f]));

  // one read for every robot's buckets, then grouped in memory
  const rollupsByRobot = new Map();
  for (const row of store.rollupsBetweenAll(fromMs, toMs)) {
    if (!rollupsByRobot.has(row.robot_id)) rollupsByRobot.set(row.robot_id, []);
    rollupsByRobot.get(row.robot_id).push(row);
  }

  const robotViews = robots.map((r) => {
    const stored = econByRobot.get(r.id) ?? null;
    const econ = economicsFor(r, stored);
    const fin = robotFinancials(rollupsByRobot.get(r.id) ?? [], econ, { fromMs, toMs });
    return {
      id: r.id,
      key: r.robot_key,
      name: r.display_name ?? r.robot_key,
      brand: r.brand,
      model: r.model,
      category: r.category,
      site: fleetsById.get(r.fleet_id)?.name ?? DEFAULT_SITE,
      configured: stored !== null,
      fin,
      formula: fin ? formulaLine(fin) : "no rate set for this kind of work yet",
      source: store.latestSnapshot(r.id)?.source ?? null,
    };
  });

  // Grouped now even with one site, so multi-site is a render change later.
  const siteNames = [...new Set(robotViews.map((v) => v.site))].sort();
  const sites = siteNames.map((name) => {
    const members = robotViews.filter((v) => v.site === name);
    return { name, robots: members, totals: fleetFinancials(members.map((v) => v.fin)) };
  });

  return {
    nowMs,
    fromMs,
    toMs,
    windowDays,
    observedDays,
    clamped,
    windowLabel: describeWindow({ fromMs, toMs, observedDays, clamped, windowDays }),
    demo: robotViews.some((v) => v.source === "sim"),
    totals: fleetFinancials(robotViews.map((v) => v.fin)),
    // cost per task only means something inside one unit of work, so it is
    // reported per type and never as a fleet-wide average
    byType: byTaskType(robotViews.map((v) => v.fin)),
    sites,
    robots: robotViews,
    defaultCount: robotViews.filter((v) => v.fin && !v.configured).length,
    unpricedCount: robotViews.filter((v) => !v.fin).length,
  };
}

function describeWindow({ fromMs, toMs, observedDays, clamped, windowDays }) {
  const d = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const span = observedDays >= 1 ? `${observedDays.toFixed(observedDays < 10 ? 1 : 0)} days` : `${Math.round(observedDays * 24)} hours`;
  if (!clamped) return `last ${windowDays} days`;
  return `${d(fromMs)} to ${d(toMs)}, the ${span} of telemetry on record. Invoices are prorated to the same period.`;
}

const OWNER_CSS = `
:root{color-scheme:dark}
body{background:#0f1115;color:#d5d9e2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:24px;max-width:980px;margin-inline:auto}
h1{font-size:20px;letter-spacing:2px;margin:0}
h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b93a7;margin:26px 0 8px}
a{color:#7aa2f7}
.badge{background:#3d2f00;color:#e8b93e;border:1px solid #6b5400;border-radius:4px;padding:2px 8px;font-size:11px;margin-left:10px;vertical-align:middle}
.sub{color:#8b93a7;font-size:12px;margin-top:4px}
.nav{margin-top:14px;font-size:12px;display:flex;gap:14px}
.panel{background:#171a21;border:1px solid #232733;border-radius:8px;padding:14px}
.empty{color:#5b6272;font-size:13px;padding:6px}
.headline{background:#141a16;border:1px solid #1f3d2a;border-radius:8px;padding:18px;margin-top:16px}
.headline .big{font-size:40px;font-weight:700;color:#37c26a;line-height:1.1}
.headline .big.under{color:#e8b93e}
.headline .cap{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b93a7}
.headline .say{font-size:14px;color:#aab1c2;margin-top:8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:12px}
.tile{background:#171a21;border:1px solid #232733;border-radius:8px;padding:12px}
.tile .k{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8b93a7}
.tile .v{font-size:24px;font-weight:600;margin-top:4px}
.tile .n{font-size:11px;color:#5b6272;margin-top:4px}
.rob{padding:10px 4px;border-bottom:1px solid #1d212b}
.rob:last-child{border-bottom:0}
.rob .top{display:flex;gap:10px;align-items:baseline;font-size:13px}
.rob .nm{font-weight:600}
.rob .mk{color:#8b93a7;font-size:11px}
.rob .cov{margin-left:auto;font-weight:700}
.rob .cov.ok{color:#37c26a}.rob .cov.under{color:#e8b93e}.rob .cov.none{color:#5b6272}
.rob .fml{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#7d8598;margin-top:5px}
.tag{font-size:10px;padding:1px 6px;border-radius:3px;background:#232733;color:#8b93a7}
.tag.def{background:#3d2f00;color:#e8b93e}
.note{color:#5b6272;font-size:11px;margin-top:8px;line-height:1.6}
.honest{margin-top:26px;border-top:1px solid #1d212b;padding-top:12px;color:#5b6272;font-size:11px;line-height:1.7}
form{display:grid;gap:14px}
fieldset{border:1px solid #232733;border-radius:8px;background:#171a21;padding:14px;margin:0}
legend{font-size:12px;color:#d5d9e2;padding:0 6px}
label{display:block;font-size:11px;color:#8b93a7;margin-bottom:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
input,select{background:#0f1115;color:#d5d9e2;border:1px solid #2b3040;border-radius:5px;padding:7px 8px;font-size:13px;width:100%;box-sizing:border-box}
button{background:#1f7a41;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;justify-self:start}
.hint{font-size:10px;color:#5b6272;margin-top:3px}
`;

const HONESTY_NOTE = `
Botlien prices the work your robots performed, valued at what that work costs to buy elsewhere,
against what you pay to lease them. It does not claim revenue, profit, or labor saved,
because telemetry cannot show what your business would have done without the robots.
Counts come from mission starts reported by the robot, so they read as runs started, not runs completed.
Every figure above shows its arithmetic so you can check it by hand.`;

function shell(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${OWNER_CSS}</style></head>
<body>${body}</body></html>`;
}

export function renderOwnerHTML(m) {
  const covClass = (c) => (c === null ? "none" : c >= 1 ? "ok" : "under");

  const robotRow = (r) => `
    <div class="rob">
      <div class="top">
        <span class="nm">${esc(r.name)}</span>
        <span class="mk">${esc([r.brand, r.model].filter(Boolean).join(" "))}</span>
        ${r.fin && !r.configured ? '<span class="tag def">benchmark default</span>' : ""}
        ${!r.fin ? '<span class="tag">no rate set</span>' : ""}
        <span class="cov ${covClass(r.fin?.coverage ?? null)}">${ratio(r.fin?.coverage ?? null)}</span>
      </div>
      <div class="fml">${esc(r.formula)}</div>
    </div>`;

  const site = (s) => `
    <h2>${esc(s.name)} · ${esc(ratio(s.totals.coverage))} coverage</h2>
    <div class="panel">${s.robots.length === 0 ? '<div class="empty">no robots</div>' : s.robots.map(robotRow).join("")}</div>`;

  const t = m.totals;
  const headline =
    t.coverage === null
      ? `<div class="cap">Coverage</div><div class="big under">–</div>
         <div class="say">Add your monthly invoice on the setup screen and this becomes your coverage number.</div>`
      : `<div class="cap">Coverage · ${esc(m.windowLabel)}</div>
         <div class="big ${t.coverage >= 1 ? "" : "under"}">${esc(ratio(t.coverage))}</div>
         <div class="say">Your robots performed <b>${esc(money(t.workServicedCents))}</b> of work
           against <b>${esc(money(t.invoiceProratedCents))}</b> in lease invoices.</div>`;

  // Cost per task is a headline figure only when the fleet does one kind of
  // work. Mixed fleets get the per-type table below instead, because dividing
  // an invoice by "tray runs plus cleaning hours" produces a unitless number.
  const single = m.byType.length === 1 ? m.byType[0] : null;

  const typeRow = (g) => `
    <div class="rob">
      <div class="top">
        <span class="nm">${esc(g.taskType)}</span>
        <span class="mk">${esc(g.robotCount)} robot${g.robotCount > 1 ? "s" : ""}</span>
        <span class="cov ${g.coverage === null ? "none" : g.coverage >= 1 ? "ok" : "under"}">${esc(ratio(g.coverage))}</span>
      </div>
      <div class="fml">${esc(num(g.tasks, g.basis))} ${esc(g.taskLabel)} · ${esc(money(g.workServicedCents))} of work · ${g.costPerTaskCents === null ? "cost per task n/a" : esc(money(g.costPerTaskCents)) + " per " + esc(g.unit)}</div>
    </div>`;

  return shell(
    "Botlien · owner",
    `<h1>BOTLIEN${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="sub">what your robots serviced · ${esc(new Date(m.nowMs).toLocaleString("en-US"))}</div>
<div class="nav"><a href="/owner/setup">Set your numbers</a><a href="/">Risk board</a><a href="/api/owner">JSON</a></div>

<div class="headline">${headline}</div>

<div class="tiles">
  <div class="tile"><div class="k">Work serviced</div><div class="v">${esc(money(t.workServicedCents))}</div>
    <div class="n">tasks performed, valued at replacement rates</div></div>
  <div class="tile"><div class="k">${single ? "Cost per " + esc(single.unit) : "Cost per task"}</div>
    <div class="v">${single && single.costPerTaskCents !== null ? esc(money(single.costPerTaskCents)) : "–"}</div>
    <div class="n">${single ? "lease invoice divided by work performed" : "shown per kind of work below, since units differ"}</div></div>
  <div class="tile"><div class="k">Utilization</div><div class="v">${esc(pct(t.utilizationPct))}</div>
    <div class="n">${t.overCapacity ? "running beyond the hours you declared, so check your operating hours" : "duty time against the hours you said they run"}</div></div>
  <div class="tile"><div class="k">Lease invoices</div><div class="v">${esc(money(t.invoiceProratedCents))}</div>
    <div class="n">prorated to the period measured</div></div>
</div>

${m.byType.length > 1 ? `<h2>By kind of work</h2><div class="panel">${m.byType.map(typeRow).join("")}</div>` : ""}
${m.defaultCount > 0 ? `<div class="note">${m.defaultCount} robot${m.defaultCount > 1 ? "s are" : " is"} using benchmark rates, not yours. <a href="/owner/setup">Set your real numbers</a> and every figure above updates.</div>` : ""}
${m.unpricedCount > 0 ? `<div class="note">${m.unpricedCount} robot${m.unpricedCount > 1 ? "s have" : " has"} no rate for its kind of work, so ${m.unpricedCount > 1 ? "they are" : "it is"} left out of the totals rather than counted as zero.</div>` : ""}

${m.sites.length === 0 ? '<h2>Robots</h2><div class="panel"><div class="empty">no robots yet</div></div>' : m.sites.map(site).join("")}

<div class="honest">${esc(HONESTY_NOTE.trim())}</div>
<script>setTimeout(() => location.reload(), 15000);</script>`
  );
}

/** The five-input onboarding screen, prefilled so the owner can accept and go. */
export function renderSetupHTML(m, { saved = false } = {}) {
  const row = (r) => {
    const f = r.fin;
    const b = BENCHMARKS[r.category] ?? {};
    const basis = f?.basis ?? b.taskBasis ?? TASK_BASIS.MISSION;
    const rate = f ? (f.rateCents / 100).toFixed(2) : "";
    const invoice = f?.invoiceCentsMonth ? (f.invoiceCentsMonth / 100).toFixed(2) : "";
    const wage = r.wageCentsHour ? (r.wageCentsHour / 100).toFixed(2) : "";
    const hours = f?.capacityMs && f.windowMs ? ((f.capacityMs / f.windowMs) * 24).toFixed(1) : b.operatingHoursDay ?? "";
    const sel = (v) => (basis === v ? " selected" : "");
    return `
    <fieldset>
      <legend>${esc(r.name)} ${r.configured ? "" : '<span class="tag def">using benchmarks</span>'}</legend>
      <div class="grid">
        <div>
          <label for="type-${r.id}">What it does</label>
          <input id="type-${r.id}" name="task_type_${r.id}" value="${esc(f?.taskType ?? b.taskType ?? "")}" placeholder="tray delivery">
        </div>
        <div>
          <label for="basis-${r.id}">Counted as</label>
          <select id="basis-${r.id}" name="task_basis_${r.id}">
            <option value="mission"${sel("mission")}>runs started</option>
            <option value="active_hour"${sel("active_hour")}>hours worked</option>
          </select>
          <div class="hint">hours suits cleaning and laundry</div>
        </div>
        <div>
          <label for="rate-${r.id}">Replacement rate ($ per task)</label>
          <input id="rate-${r.id}" name="rate_${r.id}" value="${esc(rate)}" inputmode="decimal">
          <div class="hint">what that work costs to buy elsewhere</div>
        </div>
        <div>
          <label for="inv-${r.id}">Monthly lease invoice ($)</label>
          <input id="inv-${r.id}" name="invoice_${r.id}" value="${esc(invoice)}" inputmode="decimal">
        </div>
        <div>
          <label for="wage-${r.id}">Loaded hourly wage ($, optional)</label>
          <input id="wage-${r.id}" name="wage_${r.id}" value="${esc(wage)}" inputmode="decimal">
        </div>
        <div>
          <label for="hrs-${r.id}">Operating hours per day</label>
          <input id="hrs-${r.id}" name="hours_${r.id}" value="${esc(String(hours))}" inputmode="decimal">
        </div>
      </div>
    </fieldset>`;
  };

  return shell(
    "Botlien · set your numbers",
    `<h1>BOTLIEN</h1>
<div class="sub">five numbers per robot, then every figure on your board is yours instead of a benchmark</div>
<div class="nav"><a href="/owner">Back to the board</a></div>
${saved ? '<div class="note">Saved.</div>' : ""}
${m.robots.length === 0 ? '<div class="panel"><div class="empty">no robots yet, start the engine first</div></div>' : `<form method="POST" action="/owner/setup">${m.robots.map(row).join("")}<button type="submit">Save and see my numbers</button></form>`}
<div class="honest">${esc(HONESTY_NOTE.trim())}</div>`
  );
}

/** Parse the setup form into per-robot economics. Rejects rather than coerces:
 * a field that is not a sane number leaves that robot untouched, because a
 * silently zeroed rate would render as a confident wrong answer. */
export function parseSetupForm(params, robots) {
  const out = [];
  const errors = [];
  for (const r of robots) {
    const raw = {
      taskType: (params.get(`task_type_${r.id}`) ?? "").trim(),
      taskBasis: (params.get(`task_basis_${r.id}`) ?? "").trim(),
      rate: params.get(`rate_${r.id}`),
      invoice: params.get(`invoice_${r.id}`),
      wage: params.get(`wage_${r.id}`),
      hours: params.get(`hours_${r.id}`),
    };
    // a robot with no fields present at all was simply not on the form
    if (raw.taskType === "" && raw.rate === null) continue;

    const rateCents = toCents(raw.rate);
    if (rateCents === null || rateCents <= 0) {
      errors.push({ robotId: r.id, field: "rate", message: "rate must be a positive amount" });
      continue;
    }
    if (raw.taskBasis !== TASK_BASIS.MISSION && raw.taskBasis !== TASK_BASIS.ACTIVE_HOUR) {
      errors.push({ robotId: r.id, field: "basis", message: "unknown basis" });
      continue;
    }
    const invoiceCents = toCents(raw.invoice);
    const wageCents = toCents(raw.wage);
    const hours = toNumber(raw.hours);
    if (hours !== null && (hours <= 0 || hours > 24)) {
      errors.push({ robotId: r.id, field: "hours", message: "operating hours must fall within a day" });
      continue;
    }
    out.push({
      robotId: r.id,
      econ: {
        taskType: raw.taskType || "task",
        taskBasis: raw.taskBasis,
        rateCents,
        invoiceCentsMonth: invoiceCents,
        wageCentsHour: wageCents,
        operatingHoursDay: hours,
      },
    });
  }
  return { updates: out, errors };
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  // reject NaN, Infinity, and negatives outright rather than clamping them
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toCents(v) {
  const n = toNumber(v);
  if (n === null) return null;
  // a lease invoice above $10M/month is a typo, not a fleet
  if (n > 10_000_000) return null;
  return Math.round(n * 100);
}

export { HOUR_MS, DAY_MS };
