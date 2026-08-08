// The owner board: the same telemetry the risk board reads, priced. One page
// answering one question, "are these robots covering what I pay for them", plus
// the onboarding screen that supplies the five numbers the math needs.
//
// Kept out of board.mjs on purpose: that board sells risk monitoring to whoever
// holds the paper, this one sells operating clarity to the owner. Same pipeline,
// different products, so they do not share a renderer.
import { economicsFor, BENCHMARKS, TASK_BASIS, BUSINESS_TYPES, worksFor, defaultWorkFor, businessPreview, DEFAULT_BUSINESS } from "./rates.mjs";
import { robotFinancials, fleetFinancials, byTaskType, formulaLine } from "./finance.mjs";
import { buildTips, profileByHourOfDay, mergeProfiles, peakHours, centsPerActiveHour, chargingShareByHourOfDay } from "./tips.mjs";
import { periodStats, decomposeCoverage, varianceSentence } from "./variance.mjs";
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

export const KV_CONFIRMED = "onboarding.confirmed_at";
export const KV_LAST_IMPORT = "onboarding.last_import";
export const KV_BUSINESS = "owner.business_type";

/** The one thing a telemetry export cannot tell us. */
export function businessType(store) {
  const v = store.getKV(KV_BUSINESS);
  return v && BUSINESS_TYPES[v] ? v : null;
}

export function setBusinessType(store, type) {
  if (!BUSINESS_TYPES[type]) return false;
  store.setKV(KV_BUSINESS, type);
  return true;
}

/** Where the owner is in onboarding, derived from data rather than stored as a
 * wizard step. Nothing to keep in sync, and an owner who abandons and returns
 * lands exactly where they left off because the data says so. */
export function onboardingStep(store) {
  if (!businessType(store)) return "business";
  const hasRollups = store.rollupTimeRange() !== null;
  if (!hasRollups) return "import";
  if (!store.getKV(KV_CONFIRMED)) return "confirm";
  if (store.listRobotEconomics().length === 0) return "setup";
  return "done";
}

const STEP_ORDER = ["business", "import", "confirm", "setup"];
const STEP_LABEL = { business: "your business", import: "connect data", confirm: "confirm fleet", setup: "your numbers" };

/** "step 2 of 4 · connect data", so the owner always knows where they are. */
export function stepLabel(step) {
  const i = STEP_ORDER.indexOf(step);
  if (i < 0) return "";
  return `step ${i + 1} of ${STEP_ORDER.length} · ${STEP_LABEL[step]}`;
}

/** The business-type question. One screen, one question, asked before the
 * upload so every screen after it is already tailored: the right kinds of work
 * on the confirm screen, the right rates and hours on setup, and the right
 * vocabulary on the statement. */
export function renderBusinessHTML(current = null, { error = null } = {}) {
  const previews = Object.fromEntries(Object.keys(BUSINESS_TYPES).map((k) => [k, businessPreview(k)]));

  const card = (key, b) => {
    const p = previews[key];
    return `
    <label class="pick-card${current === key ? " on" : ""}">
      <input type="radio" name="business" value="${esc(key)}"${current === key ? " checked" : ""}>
      <span class="t">${esc(b.label)}</span>
      <span class="d">${esc(b.blurb)}</span>
      <span class="w">${p.works.map((w) => `<i>${esc(w)}</i>`).join("")}</span>
    </label>`;
  };

  // What the answer buys, stated before the owner commits to it. A question is
  // only worth asking if you can see what it changes.
  const consequence = (p) =>
    p
      ? `We will offer ${esc(p.works.join(", ").toLowerCase())}, ` +
        `starting at <b>$${(p.rateCents / 100).toFixed(2)} per ${esc(p.unit)}</b> ` +
        `over ${esc(p.operatingHoursDay)} hours a day.<br><span class="der">${esc(p.derivation)}</span>`
      : "";

  const start = current ? previews[current] : null;

  return shell(
    "Botlien · your business",
    `<h1>BOTLIEN</h1>
<div class="sub">${esc(stepLabel("business"))}</div>
<h2>What kind of business is this?</h2>
<div class="note">This is the only thing your robots' data cannot tell us. How many robots you run, which brands, how much they did and over what period all come from your export, so we do not ask. This one answer decides what kinds of work we offer, what a unit of that work is worth, and how the numbers read.</div>
${error ? `<div class="err"><b>${esc(error)}</b></div>` : ""}
<form method="POST" action="/owner/business" id="bizform">
  <div class="picks">${Object.entries(BUSINESS_TYPES).map(([k, b]) => card(k, b)).join("")}</div>
  <div class="consequence" id="consequence"${start ? "" : ' hidden'}>${start ? consequence(start) : ""}</div>
  <button type="submit" id="go"${current ? "" : " disabled"}>${current ? `Continue as ${esc(previews[current].label.toLowerCase())}` : "Choose one to continue"}</button>
  <div class="hint">You can change any of this later, per robot, and nothing here is locked in.</div>
</form>
<div class="honest">${esc(HONESTY_NOTE.trim())}</div>
<script>
(function () {
  var data = ${JSON.stringify(previews)};
  var go = document.getElementById('go');
  var box = document.getElementById('consequence');
  function money(c) { return '$' + (c / 100).toFixed(2); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  document.querySelectorAll('input[name=business]').forEach(function (input) {
    input.addEventListener('change', function () {
      var p = data[input.value];
      if (!p) return;
      document.querySelectorAll('.pick-card').forEach(function (c) { c.classList.remove('on'); });
      input.closest('.pick-card').classList.add('on');
      var works = p.works.join(', ').toLowerCase();
      box.innerHTML = 'We will offer ' + esc(works) + ', starting at <b>' + money(p.rateCents) +
        ' per ' + esc(p.unit) + '</b> over ' + esc(p.operatingHoursDay) + ' hours a day.<br>' +
        '<span class="der">' + esc(p.derivation) + '</span>';
      box.hidden = false;
      go.disabled = false;
      go.textContent = 'Continue as ' + p.label.toLowerCase();
    });
  });
})();
</script>`
  );
}

export function lastImport(store) {
  const raw = store.getKV(KV_LAST_IMPORT);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function recordImport(store, summary) {
  store.setKV(KV_LAST_IMPORT, JSON.stringify(summary));
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
  // Anchor the window to the END of the telemetry, not to now. Intersecting
  // [now - windowDays, now] with the data range collapses to nothing whenever
  // the telemetry is entirely older than the window, which is precisely what an
  // owner dropping a historical export produces: a statement of zeros over data
  // that is sitting right there. Anchoring instead reports the last windowDays
  // of telemetry that actually exists.
  const range = store.rollupTimeRange();
  const toMs = range ? Math.min(nowMs, range.maxAt) : nowMs;
  const fromMs = range ? Math.max(range.minAt, toMs - windowDays * DAY_MS) : requestedFrom;
  const clamped = range !== null && (fromMs > requestedFrom || toMs < nowMs);
  const observedDays = Math.max(0, (toMs - fromMs) / DAY_MS);

  // Excluded robots leave the statement entirely. They are not priced at zero,
  // because a robot the owner no longer leases is not a robot earning nothing.
  const excluded = new Set(store.listExclusions());
  const robots = store.listRobots().filter((r) => !excluded.has(r.id));
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

  // ---- tips: what to actually do about any of this ----
  // Peaks are computed WITHIN a kind of work, never fleet-wide. A night
  // scrubber scored against the dining room's dinner rush reads as permanently
  // idle, and the board would confidently tell the owner to fix a robot that is
  // doing exactly what it is supposed to at exactly the right hour.
  const tipCtxs = robotViews
    .filter((v) => v.fin)
    .map((v) => {
      const rollups = rollupsByRobot.get(v.id) ?? [];
      return {
        robot: { id: v.id, name: v.name },
        fin: v.fin,
        rollups,
        profile: profileByHourOfDay(rollups),
        observedMs: rollups.reduce((s, r) => s + (r.bucket_ms ?? 0), 0),
        totalSamples: rollups.reduce((s, r) => s + (r.sample_count ?? 0), 0),
        perHourCents: centsPerActiveHour(v.fin),
        chargingByHourOfDay: chargingShareByHourOfDay(store.chargingByHour(v.id, fromMs, toMs)),
        hotspots: store.stallHotspots(v.id, fromMs, toMs),
        stallSamples: store.stallSampleCount(v.id, fromMs, toMs),
      };
    });

  const peaksByType = new Map();
  for (const taskType of new Set(tipCtxs.map((c) => c.fin.taskType))) {
    const group = tipCtxs.filter((c) => c.fin.taskType === taskType);
    peaksByType.set(taskType, peakHours(mergeProfiles(group.map((c) => c.profile))));
  }
  for (const c of tipCtxs) c.peaks = peaksByType.get(c.fin.taskType) ?? [];

  const tipResult = buildTips(tipCtxs, { periodLabel: `over the ${Math.round(observedDays)} days measured` });

  // ---- period over period: why the number moved ----
  // The comparison SPLITS THE OBSERVED WINDOW IN HALF rather than reaching back
  // for a full prior window of equal length. Reaching back is the textbook
  // shape and it is the wrong product: it needs twice the history before it can
  // say anything, so an owner who drops a 30-day export gets an empty panel and
  // no explanation of why. Halves always work with whatever history exists, and
  // the panel states exactly which two periods it compared.
  const halfMs = (toMs - fromMs) / 2;
  const midMs = toMs - halfMs;
  const inWindow = (rows, a, b) => (rows ?? []).filter((r) => r.bucket_start_at >= a && r.bucket_start_at < b);
  const variance = decomposeCoverage(
    robots
      .map((r) => {
        const econ = economicsFor(r, econByRobot.get(r.id) ?? null);
        if (!econ) return null;
        const rows = rollupsByRobot.get(r.id) ?? [];
        return {
          robot: { id: r.id, name: r.display_name ?? r.robot_key },
          priorStats: periodStats(inWindow(rows, fromMs, midMs), econ, { fromMs, toMs: midMs }),
          currentStats: periodStats(inWindow(rows, midMs, toMs), econ, { fromMs: midMs, toMs }),
        };
      })
      .filter(Boolean),
    { periodDays: halfMs / DAY_MS }
  );

  return {
    nowMs,
    fromMs,
    toMs,
    windowDays,
    observedDays,
    clamped,
    tips: tipResult.tips,
    tipsHidden: tipResult.hidden,
    tipsUpsideCents: tipResult.totalUpsideCents,
    variance,
    varianceSentence: varianceSentence(variance),
    step: onboardingStep(store),
    firstRun: onboardingStep(store) !== "done",
    lastImport: lastImport(store),
    excludedCount: excluded.size,
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
fieldset.excluded{opacity:.5}
fieldset.excluded legend .tag{background:#232733;color:#8b93a7}
.drop{border:1px dashed #2b3040;border-radius:10px;background:#131820;padding:44px 20px;text-align:center}
.drop .big{font-size:17px;font-weight:600}
.drop .sm{font-size:12.5px;color:#8b93a7;margin-top:8px;line-height:1.6;max-width:46ch;margin-inline:auto}
.drop .pick{margin-top:16px}
.second{margin-top:22px;border-top:1px solid #1d212b;padding-top:16px;color:#8b93a7;font-size:12.5px;line-height:1.6}
.second b{color:#d5d9e2;font-weight:600}
.cols{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#aab1c2;line-height:1.8}
.err{border-left:3px solid #e05252;background:#1e1416;padding:12px 14px;font-size:13px;margin-bottom:16px}
.steps{display:flex;gap:8px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5b6272;margin-top:12px}
.steps b{color:#37c26a;font-weight:600}
.picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.pick-card{display:block;background:#171a21;border:1px solid #232733;border-radius:8px;padding:14px;cursor:pointer}
.pick-card:hover{border-color:#2f3646}
.pick-card.on{border-color:#37c26a;background:#141a16}
.pick-card input{position:absolute;opacity:0;pointer-events:none}
.pick-card .t{display:block;font-size:14px;font-weight:600}
.pick-card .d{display:block;font-size:12px;color:#8b93a7;margin-top:5px;line-height:1.5}
.pick-card .w{display:flex;flex-wrap:wrap;gap:4px;margin-top:9px}
.pick-card .w i{font-style:normal;font-size:10px;letter-spacing:.03em;color:#8b93a7;background:#0f1115;border:1px solid #232733;border-radius:3px;padding:2px 6px}
.consequence{background:#141a16;border:1px solid #1f3d2a;border-radius:8px;padding:13px 15px;margin-top:14px;font-size:13px;color:#aab1c2;line-height:1.6}
.consequence b{color:#d5d9e2}
.consequence .der{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#7d8598}
button[disabled]{opacity:.45;cursor:default}
.pick-card:has(input:checked){border-color:#37c26a;background:#141a16}

/* Tips. Visually the loudest thing under the headline on purpose: it is the
   only part of the page that tells the owner to do something. */
.tip{border-left:2px solid #2f3646;padding:12px 0 12px 13px;margin-bottom:2px}
.tip+.tip{border-top:1px solid #1d212b}
.tip.money{border-left-color:#37c26a}
.tip.risk{border-left-color:#e8b93e}
.tip .h{display:flex;gap:12px;align-items:baseline}
.tip .ti{font-size:14px;font-weight:600;color:#e6eaf2}
.tip .amt{margin-left:auto;font-size:15px;font-weight:700;color:#37c26a;white-space:nowrap}
.tip.risk .amt{color:#e8b93e}
.tip .amt small{display:block;font-size:9px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:#5b6272;text-align:right;margin-top:2px}
.tip .f{font-size:13px;color:#aab1c2;line-height:1.6;margin-top:7px}
.tip .a{font-size:13px;color:#d5d9e2;line-height:1.6;margin-top:7px}
.tip .a b{color:#37c26a;font-weight:600}
.tip .b{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#6b7383;margin-top:8px;line-height:1.6}
.tip .bd{font-size:10.5px;color:#5b6272;margin-top:4px;line-height:1.6;font-style:italic}
.tipsum{font-size:12px;color:#8b93a7;margin-top:10px;line-height:1.6}
.tipsum b{color:#37c26a}

/* Period-over-period. Bars are signed and share one scale so a small effect
   next to a large one looks small. */
.varsent{font-size:14px;color:#d5d9e2;line-height:1.65}
.vartable{margin-top:14px;display:grid;gap:7px}
.varrow{display:grid;grid-template-columns:150px 1fr 74px;gap:10px;align-items:center;font-size:12px}
.varrow .lb{color:#aab1c2}
.varrow .tr{position:relative;height:16px;background:#12151c;border-radius:3px;overflow:hidden}
.varrow .tr i{position:absolute;top:0;bottom:0;display:block}
.varrow .tr i.pos{background:#1f7a41;left:50%}
.varrow .tr i.neg{background:#8f3030;right:50%}
.varrow .tr .mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#2b3040}
.varrow .dv{text-align:right;font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
.varrow .dv.pos{color:#37c26a}.varrow .dv.neg{color:#e07a7a}
.varfoot{font-size:11px;color:#5b6272;margin-top:12px;line-height:1.7}
.varwho{font-size:12px;color:#8b93a7;margin-top:12px;line-height:1.7}
.varwho b{color:#d5d9e2}
.headline .why{font-size:13px;color:#8b93a7;margin-top:10px;padding-top:10px;border-top:1px solid #1f3d2a;line-height:1.6}
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
           against <b>${esc(money(t.invoiceProratedCents))}</b> in lease invoices.</div>
         ${
           m.variance
             ? `<div class="why">${m.variance.direction === "up" ? "Up" : "Down"} from
                <b>${esc(ratio(m.variance.priorCoverage))}</b> over the previous
                ${Math.round(m.variance.periodDays)} days. <a href="#why">Why it moved</a></div>`
             : ""
         }`;

  // ---- what to do about it ----
  const tipCard = (tip) => {
    const atRisk = tip.valueKind === "at_risk";
    const amount =
      tip.valueCents === null
        ? ""
        : `<span class="amt">${esc(money(tip.valueCents))}<small>${atRisk ? "counted, not earned" : "up to, " + esc(tip.valuePeriod)}</small></span>`;
    return `
    <div class="tip ${atRisk ? "risk" : "money"}">
      <div class="h"><span class="ti">${esc(tip.title)}</span>${amount}</div>
      <div class="f">${esc(tip.finding)}</div>
      ${
        tip.alsoRobots?.length
          ? `<div class="f">Same pattern on ${esc(tip.alsoRobots.join(", "))}, worth about ${esc(money(tip.alsoValueCents))} more. Priced once here, since it is one thing to fix.</div>`
          : ""
      }
      <div class="a"><b>Do this:</b> ${esc(tip.action)}</div>
      <div class="b">${esc(tip.basis)}</div>
      <div class="bd">${esc(tip.bound)}</div>
    </div>`;
  };

  const tipsPanel =
    m.tips.length === 0
      ? ""
      : `<h2>What to fix first</h2>
<div class="panel">${m.tips.map(tipCard).join("")}</div>
<div class="tipsum">${
          m.tipsUpsideCents > 0
            ? `Acting on all of these is worth up to <b>${esc(money(m.tipsUpsideCents))}</b> ${esc(m.tips[0].valuePeriod)}. `
            : ""
        }Every figure here is your own robot's observed rate applied to hours it did not work, never a vendor throughput claim. ${
          m.tipsHidden > 0 ? `${m.tipsHidden} smaller finding${m.tipsHidden > 1 ? "s" : ""} not shown.` : ""
        }</div>`;

  // ---- why the number moved ----
  const v = m.variance;
  const variancePanel = !v
    ? ""
    : (() => {
        const scale = Math.max(...v.effects.map((e) => Math.abs(e.coverage)), 0.01);
        const row = (e) => {
          const w = Math.min(50, (Math.abs(e.coverage) / scale) * 50);
          const pos = e.coverage >= 0;
          return `
          <div class="varrow">
            <span class="lb">${esc(e.label)}</span>
            <span class="tr"><span class="mid"></span><i class="${pos ? "pos" : "neg"}" style="width:${w.toFixed(1)}%"></i></span>
            <span class="dv ${pos ? "pos" : "neg"}">${pos ? "+" : "−"}${Math.abs(e.coverage).toFixed(2)}x</span>
          </div>`;
        };
        const who = v.contributors
          .filter((c) => Math.abs(c.workCents) > 100)
          .map(
            (c) =>
              `<b>${esc(c.name)}</b> ${c.workCents >= 0 ? "added" : "lost"} ${esc(money(Math.abs(c.workCents)))} of work, mostly through ${esc(
                c.driver === "availability" ? "hours online" : "work done per hour online"
              )}`
          );
        return `<h2 id="why">Why it moved</h2>
<div class="panel">
  <div class="varsent">${esc(m.varianceSentence ?? "")}</div>
  <div class="vartable">${v.effects.map(row).join("")}</div>
  ${who.length ? `<div class="varwho">${who.join(".<br>")}.</div>` : ""}
  <div class="varfoot">
    These add up to the whole move (${v.priorCoverage.toFixed(2)}x → ${v.currentCoverage.toFixed(2)}x), with nothing left in a residual.
    Hours online is availability: the robot was reachable or it was not. Work per hour online is what it got through while it was up.
    Your replacement rate and invoice are stored as one current figure per robot with no history, so changing them on the setup screen
    restates both periods together and this panel will never show a rate effect. That is a limitation, not a reading.
  </div>
</div>`;
      })();

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
  <div class="tile"><div class="k">Same work by hand</div>
    <div class="v">${t.laborEquivalentHours === null ? "–" : esc(Math.round(t.laborEquivalentHours).toLocaleString("en-US")) + " hrs"}</div>
    <div class="n">${
      t.laborEquivalentHours === null
        ? "add a loaded hourly wage on the setup screen"
        : `hours of <b>this one task</b> at ${t.anyBenchmarkWage ? "a benchmark" : "your"} loaded wage. Not a headcount, and not labor saved${t.laborHoursPartial ? "; robots with no wage set are left out" : ""}`
    }</div></div>
  <div class="tile"><div class="k">Utilization</div><div class="v">${esc(pct(t.utilizationPct))}</div>
    <div class="n">${t.overCapacity ? "running beyond the hours you declared, so check your operating hours" : "duty time against the hours you said they run"}</div></div>
  <div class="tile"><div class="k">Lease invoices</div><div class="v">${esc(money(t.invoiceProratedCents))}</div>
    <div class="n">prorated to the period measured</div></div>
</div>

${tipsPanel}
${variancePanel}

${m.byType.length > 1 ? `<h2>By kind of work</h2><div class="panel">${m.byType.map(typeRow).join("")}</div>` : ""}
${m.defaultCount > 0 ? `<div class="note">${m.defaultCount} robot${m.defaultCount > 1 ? "s are" : " is"} using benchmark rates, not yours. <a href="/owner/setup">Set your real numbers</a> and every figure above updates.</div>` : ""}
${m.unpricedCount > 0 ? `<div class="note">${m.unpricedCount} robot${m.unpricedCount > 1 ? "s have" : " has"} no rate for its kind of work, so ${m.unpricedCount > 1 ? "they are" : "it is"} left out of the totals rather than counted as zero.</div>` : ""}

${m.sites.length === 0 ? '<h2>Robots</h2><div class="panel"><div class="empty">no robots yet</div></div>' : m.sites.map(site).join("")}

<div class="honest">${esc(HONESTY_NOTE.trim())}</div>
<script>setTimeout(() => location.reload(), 15000);</script>`
  );
}

export const ACCEPTED_COLUMNS = {
  "Robot id": ["external_id", "robot_id", "robot_key", "robot", "serial"],
  Timestamp: ["at", "timestamp", "time", "ts"],
};

/** The import screen. Leads with the file drop because vendors issue API
 * credentials manually and slowly, and a funnel that stalls for days at the
 * moment of highest intent is a funnel that has already lost the owner. */
export function renderImportHTML({ error = null, sample = null, business = null } = {}) {
  const b = BUSINESS_TYPES[business] ?? null;
  const cols = Object.entries(ACCEPTED_COLUMNS)
    .map(([k, v]) => `${esc(k)}: ${v.map((c) => esc(c)).join(", ")}`)
    .join("<br>");

  return shell(
    "Botlien · import your usage",
    `<h1>BOTLIEN</h1>
<div class="sub">${esc(stepLabel("import"))}${b ? " · " + esc(b.label) : ""}</div>
${error ? `<div class="err"><b>${esc(error)}</b><div class="cols" style="margin-top:10px">${cols}</div>${sample ? `<div class="cols" style="margin-top:10px;color:#5b6272">we saw: ${esc(sample)}</div>` : ""}</div>` : ""}

<div class="drop" id="drop">
  <div class="big">Drop your usage export here</div>
  <div class="sm">A CSV from ${esc(b?.exportHint ?? "your robot vendor's console")} is enough. Your coverage statement fills in within minutes, history included, no credentials to chase.</div>
  <div class="pick"><input type="file" id="file" accept=".csv,.jsonl,text/csv,text/plain"></div>
  <div class="sm" id="status"></div>
</div>

<div class="second">
  <b>Connect your robot API for live data</b><br>
  Once the statement is running, live telemetry keeps it current daily instead of per export.
  Vendor credentials can take weeks, so this comes second.
</div>

<div class="second">
  <b>What we can read</b>
  <div class="cols" style="margin-top:8px">${cols}</div>
</div>

<div class="honest">${esc(HONESTY_NOTE.trim())}</div>
<script>
(function () {
  var drop = document.getElementById('drop');
  var input = document.getElementById('file');
  var status = document.getElementById('status');
  function send(file) {
    if (!file) return;
    status.textContent = 'Reading ' + file.name + '…';
    file.text().then(function (text) {
      return fetch('/owner/import?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text
      });
    }).then(function (res) {
      if (res.redirected) { window.location = res.url; return; }
      if (res.ok) { window.location = '/owner/confirm'; return; }
      return res.text().then(function (t) { status.textContent = t || 'That file could not be read.'; });
    }).catch(function () { status.textContent = 'That file could not be read.'; });
  }
  input.addEventListener('change', function () { send(input.files[0]); });
  ['dragenter','dragover'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (ev) { send(ev.dataTransfer.files[0]); });
})();
</script>`
  );
}

/** Read model for the confirm-fleet screen. Shows every robot the import found,
 * including excluded ones, so an exclusion can be undone. */
export function confirmModel(store, nowMs) {
  const excluded = new Set(store.listExclusions());
  const robots = store.listRobots().map((r) => {
    const range = store.robotTimeRange(r.id);
    return {
      id: r.id,
      key: r.robot_key,
      name: r.display_name ?? r.robot_key,
      brand: r.brand,
      model: r.model,
      category: r.category,
      excluded: excluded.has(r.id),
      range,
      rangeLabel: range ? `${shortDate(range.minAt)} to ${shortDate(range.maxAt)}` : "no telemetry",
    };
  });
  // Only the kinds of work this business actually does. A restaurant should not
  // be scrolling past "putaway and replenishment" to find "bussing".
  const business = businessType(store) ?? DEFAULT_BUSINESS;
  return {
    nowMs,
    robots,
    lastImport: lastImport(store),
    business,
    businessLabel: BUSINESS_TYPES[business].label,
    categories: worksFor(business),
  };
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const CATEGORY_LABEL = Object.fromEntries(Object.entries(BENCHMARKS).map(([k, b]) => [k, b.label]));

export function renderConfirmHTML(m) {
  const imp = m.lastImport;
  const row = (r) => `
    <fieldset${r.excluded ? ' class="excluded"' : ""}>
      <legend>${esc(r.name)} ${r.excluded ? '<span class="tag">excluded</span>' : ""}</legend>
      <div class="grid">
        <div>
          <label for="name-${r.id}">Call it</label>
          <input id="name-${r.id}" name="name_${r.id}" value="${esc(r.name)}">
          <div class="hint">${esc([r.brand, r.model].filter(Boolean).join(" ") || r.key)} · ${esc(r.rangeLabel)}</div>
        </div>
        <div>
          <label for="cat-${r.id}">Kind of work</label>
          <select id="cat-${r.id}" name="category_${r.id}">
            ${m.categories.map((c) => `<option value="${esc(c)}"${c === r.category ? " selected" : ""}>${esc(CATEGORY_LABEL[c] ?? c)}</option>`).join("")}
          </select>
          <div class="hint">this decides whether it is priced per run or per hour</div>
        </div>
        <div>
          <label for="exc-${r.id}">Still leasing it?</label>
          <select id="exc-${r.id}" name="excluded_${r.id}">
            <option value="0"${r.excluded ? "" : " selected"}>Yes, include it</option>
            <option value="1"${r.excluded ? " selected" : ""}>No, leave it out</option>
          </select>
        </div>
      </div>
    </fieldset>`;

  return shell(
    "Botlien · confirm your fleet",
    `<h1>BOTLIEN</h1>
<div class="sub">${esc(stepLabel("confirm"))} · ${esc(m.businessLabel)}</div>
${imp ? `<div class="note">Read ${esc(Number(imp.rows).toLocaleString("en-US"))} rows across ${esc(imp.robots)} robot${imp.robots === 1 ? "" : "s"}${imp.rangeLabel ? " · " + esc(imp.rangeLabel) : ""}${imp.skipped > 0 ? `<br>${esc(imp.skipped)} row${imp.skipped === 1 ? "" : "s"} skipped: ${esc(skipDetail(imp.skipReasons))}.` : ""}</div>` : ""}
<h2>We found ${m.robots.length} robot${m.robots.length === 1 ? "" : "s"}. Is this your fleet?</h2>
<div class="note">A telemetry export does not say what kind of work a robot does, so everything came in as ${esc(CATEGORY_LABEL[m.categories[0]] ?? m.categories[0]).toLowerCase()}. Correct anything that is not: the kind of work decides whether a robot is priced per task or per hour, which changes its numbers by an order of magnitude.</div>
${m.robots.length === 0 ? '<div class="panel"><div class="empty">no robots found</div></div>' : `<form method="POST" action="/owner/confirm">${m.robots.map(row).join("")}<button type="submit">Yes, set my numbers</button></form>`}
<div class="honest">${esc(HONESTY_NOTE.trim())}</div>`
  );
}

function skipDetail(reasons) {
  if (!reasons) return "unreadable";
  const parts = [];
  if (reasons.noTimestamp) parts.push(`${reasons.noTimestamp} with no timestamp`);
  if (reasons.noRobotId) parts.push(`${reasons.noRobotId} with no robot id`);
  return parts.join(", ") || "unreadable";
}

/** Apply the confirm form. Renames, recategorizes, and excludes in one pass. */
export function parseConfirmForm(params, robots) {
  const changes = [];
  for (const r of robots) {
    const name = (params.get(`name_${r.id}`) ?? "").trim();
    const category = (params.get(`category_${r.id}`) ?? "").trim();
    const excluded = params.get(`excluded_${r.id}`) === "1";
    if (name === "" && category === "") continue;
    changes.push({
      robotId: r.id,
      // an empty name means "leave it alone", never means "erase the name"
      name: name || null,
      category: BENCHMARKS[category] ? category : null,
      excluded,
    });
  }
  return changes;
}

export function applyConfirm(store, changes, nowMs) {
  for (const c of changes) {
    if (c.name) store.renameRobot(c.robotId, c.name);
    if (c.category) store.setRobotCategory(c.robotId, c.category);
    if (c.excluded) store.excludeRobot(c.robotId, nowMs);
    else store.includeRobot(c.robotId);
  }
  store.setKV(KV_CONFIRMED, String(nowMs));
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
