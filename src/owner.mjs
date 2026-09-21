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
import { robotInterventions, fleetInterventions, interventionSentence, MINUTES_PER_CLEAR } from "./interventions.mjs";
import { buildFloorplan } from "./floorplan.mjs";
import { byBrand, brandSentence } from "./brands.mjs";
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

  // ---- what it costs to keep them running ----
  // The invoice is the only cost anyone hands the owner. It is not the only
  // cost they pay, and the rest of it has been sitting in this database
  // unpriced since the first import.
  const interventionRows = robotViews
    .filter((v) => v.fin)
    .map((v) => {
      const rollups = rollupsByRobot.get(v.id) ?? [];
      const samples = store.stuckSampleCount(v.id, fromMs, toMs);
      const manual = store.manualControlSamples(v.id, fromMs, toMs);
      return robotInterventions({
        robot: { id: v.id, name: v.name },
        rollups,
        wageCentsHour: v.fin.wageCentsHour,
        wageIsBenchmark: v.fin.wageIsBenchmark,
        stuckSamples: samples.stuck,
        totalSamples: samples.total,
        conditionSamples: manual.total,
        activeManualSamples: manual.activeManual,
        activeSamples: manual.activeTotal,
        activeMs: rollups.reduce((n, r) => n + (r.active_ms ?? 0), 0),
        observedMs: rollups.reduce((n, r) => n + (r.bucket_ms ?? 0), 0),
      });
    });
  const interventions = fleetInterventions(interventionRows);

  // ---- the floor ----
  // Queried per site, not per robot: two robots stalling either side of one
  // doorway are one bad doorway. Stall hours are attributed to cells so the
  // map carries the same figure the panel above it states.
  const stalledBySite = new Map();
  const rowById = new Map(interventionRows.map((r) => [r.robotId, r]));
  for (const v of robotViews) {
    const row = rowById.get(v.id);
    if (!row) continue;
    stalledBySite.set(v.site, (stalledBySite.get(v.site) ?? 0) + row.stalledHours);
  }
  const floors = sites
    .map((s) => ({
      site: s.name,
      robotCount: s.robots.length,
      plan: buildFloorplan(
        store.poseGrid(
          s.robots.map((r) => r.id),
          fromMs,
          toMs
        ),
        { stalledHours: stalledBySite.get(s.name) ?? null }
      ),
    }))
    .filter((f) => f.plan !== null);

  // ---- brand against brand ----
  const brands = byBrand(robotViews);

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
    interventions,
    interventionRows,
    interventionSentence: interventionSentence(interventions),
    minutesPerClear: MINUTES_PER_CLEAR,
    floors,
    brands,
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
/* Ported from prototype/src/botlien.part.html (c0c25e0). One committed light
   palette: the page paints its own background and every colour explicitly, so
   it holds whatever theme the viewer is in.

   No status colours anywhere, deliberately. The prototype carries none, and the
   reason is stated in its own copy: a row "holds the coverage figure on its own
   line, so it reads as a problem before the number is even parsed." Shortfall is
   signalled by weight and layout, never by painting a number green or amber.
   Colouring the figure would editorialise it, which is the one thing a statement
   an owner checks by hand must not do. */
:root{
  --page-bg:#F1F2FC;
  --page:linear-gradient(160deg,#EDEFFC 0%,#F4F1FB 45%,#F2F6FD 100%);
  --fg1:#16204A; --fg2:#6B7392; --fg3:#9AA1BC;
  --ink:#0A0A0A; --ink-fg:#FFFFFF;
  --hair:rgba(10,10,10,.10); --hair2:rgba(10,10,10,.16); --hair3:rgba(10,10,10,.28);
  --ghost:rgba(10,10,10,.04); --ghost2:rgba(10,10,10,.05);
  --menu:#F6F6FB;
  --sb-border:hsl(220 13% 91%);
  --mono:ui-monospace,Menlo,"SF Mono",monospace;
  color-scheme:light;
}
*{box-sizing:border-box}
body{background:var(--page-bg);background-image:var(--page);background-attachment:fixed;color:var(--fg1);
  font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  margin:0;padding:32px 24px 64px;max-width:1060px;margin-inline:auto;font-size:14px;line-height:1.5}
h1{font-size:21px;font-weight:700;letter-spacing:-.01em;margin:0;color:var(--fg1)}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--fg3);margin:34px 0 10px}
a{color:var(--fg1);text-underline-offset:3px}
a:hover{color:var(--fg2)}
.badge{background:var(--ghost);color:var(--fg2);border:1px solid var(--hair2);border-radius:3px;padding:2px 7px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-left:10px;vertical-align:middle}
.sub{color:var(--fg2);font-size:12.5px;margin-top:5px}
.nav{margin-top:16px;font-size:12.5px;font-weight:600;display:flex;flex-wrap:wrap;gap:16px}

/* Card frame. One border, one radius, everywhere, so the page reads as one
   surface rather than a stack of unrelated widgets. */
.panel{background:transparent;border:1px solid var(--hair);border-radius:6px;padding:4px 18px}
.empty{color:var(--fg3);font-size:13px;padding:14px 4px}

/* The coverage headline. The figure gets its own line at display size; that
   placement, not a colour, is what makes a shortfall read as a problem. */
.headline{background:transparent;border:1px solid var(--hair);border-radius:6px;padding:22px 24px 18px;margin-top:18px}
.headline .cap{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--fg3)}
.headline .big{display:block;font-size:clamp(28px,4.6vw,36px);font-weight:700;letter-spacing:-.03em;line-height:1.1;color:var(--fg1);margin-top:6px;font-variant-numeric:tabular-nums}
.headline .big.under{font-weight:800}
.headline .say{font-size:13.5px;color:var(--fg2);margin-top:12px;line-height:1.65;max-width:64ch}
.headline .say b{color:var(--fg1);font-weight:600}
.headline .why{font-size:13px;color:var(--fg2);margin-top:14px;padding-top:13px;border-top:1px solid var(--hair);line-height:1.65}
.headline .why b{color:var(--fg1);font-weight:600}

.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:14px}
.tile{background:transparent;border:1px solid var(--hair);border-radius:6px;padding:15px 16px}
.tile .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--fg3)}
.tile .v{font-size:26px;font-weight:700;letter-spacing:-.01em;margin-top:6px;color:var(--fg1);font-variant-numeric:tabular-nums}
.tile .n{font-size:11.5px;color:var(--fg3);margin-top:5px;line-height:1.55}

/* Robot rows. Coverage sits on its own line under the name, per the prototype:
   the figure is not squeezed onto the end of a sentence. */
.rob{padding:13px 0;border-bottom:1px solid var(--hair)}
.rob:last-child{border-bottom:0}
.rob .top{display:flex;flex-wrap:wrap;gap:9px;align-items:baseline;font-size:13.5px}
.rob .nm{font-weight:600;color:var(--fg1)}
.rob .mk{color:var(--fg3);font-size:11.5px}
.rob .cov{margin-left:auto;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:var(--fg1)}
.rob .cov.under{font-weight:800}
.rob .cov.none{color:var(--fg3);font-weight:600}
.rob .fml{font-family:var(--mono);font-size:11px;color:var(--fg3);margin-top:7px;line-height:1.6}
.tag{font-size:10px;font-weight:600;letter-spacing:.03em;padding:2px 7px;border-radius:3px;background:var(--ghost);color:var(--fg2);border:1px solid var(--hair)}
.tag.def{background:var(--ghost2);color:var(--fg2)}
.note{color:var(--fg3);font-size:11.5px;margin-top:10px;line-height:1.65}
.honest{margin-top:34px;border-top:1px solid var(--hair);padding-top:15px;color:var(--fg3);font-size:11.5px;line-height:1.75;max-width:80ch}

form{display:grid;gap:16px}
fieldset{border:1px solid var(--hair);border-radius:6px;background:transparent;padding:16px;margin:0}
legend{font-size:12.5px;font-weight:600;color:var(--fg1);padding:0 7px}
label{display:block;font-size:11px;font-weight:600;letter-spacing:.03em;color:var(--fg2);margin-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
input,select{background:#fff;color:var(--fg1);border:1px solid var(--hair2);border-radius:4px;padding:9px 10px;font-size:13px;width:100%;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--hair3)}
button{background:var(--ink);color:var(--ink-fg);border:0;border-radius:4px;padding:12px 20px;font-size:13.5px;font-weight:700;cursor:pointer;justify-self:start;font-family:inherit}
button:hover{opacity:.88}
button[disabled]{opacity:.4;cursor:default}
.hint{font-size:10.5px;color:var(--fg3);margin-top:4px;line-height:1.55}
fieldset.excluded{opacity:.5}
fieldset.excluded legend .tag{background:var(--ghost);color:var(--fg2)}

.drop{border:1px dashed var(--hair2);border-radius:6px;background:transparent;padding:48px 20px;text-align:center}
.drop .big{font-size:17px;font-weight:700;color:var(--fg1)}
.drop .sm{font-size:12.5px;color:var(--fg2);margin-top:9px;line-height:1.65;max-width:48ch;margin-inline:auto}
.drop .pick{margin-top:18px}
.second{margin-top:24px;border-top:1px solid var(--hair);padding-top:18px;color:var(--fg2);font-size:12.5px;line-height:1.65}
.second b{color:var(--fg1);font-weight:600}
.cols{font-family:var(--mono);font-size:11.5px;color:var(--fg2);line-height:1.8}
.err{border-left:2px solid var(--fg1);background:var(--ghost);padding:13px 15px;font-size:13px;margin-bottom:18px;border-radius:0 4px 4px 0}
.steps{display:flex;flex-wrap:wrap;gap:10px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--fg3);margin-top:14px}
.steps b{color:var(--fg1);font-weight:700}

.picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.pick-card{display:block;background:transparent;border:1px solid var(--hair);border-radius:6px;padding:16px;cursor:pointer}
.pick-card:hover{border-color:var(--hair2);background:var(--ghost)}
.pick-card.on,.pick-card:has(input:checked){border-color:var(--hair3);background:var(--ghost2);box-shadow:inset 0 0 0 1px var(--hair2)}
.pick-card input{position:absolute;opacity:0;pointer-events:none}
.pick-card .t{display:block;font-size:14px;font-weight:700;color:var(--fg1)}
.pick-card .d{display:block;font-size:12.5px;color:var(--fg2);margin-top:6px;line-height:1.55}
.pick-card .w{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.pick-card .w i{font-style:normal;font-size:10px;letter-spacing:.03em;color:var(--fg2);background:var(--ghost);border:1px solid var(--hair);border-radius:3px;padding:2px 7px}
.consequence{background:transparent;border:1px solid var(--hair);border-radius:6px;padding:15px 17px;margin-top:16px;font-size:13px;color:var(--fg2);line-height:1.65}
.consequence b{color:var(--fg1);font-weight:600}
.consequence .der{font-family:var(--mono);font-size:11px;color:var(--fg3)}

/* Tips. Visually the loudest thing under the headline on purpose: it is the
   only part of the page that tells the owner to do something. Emphasis comes
   from the rule and the type scale, not from colour. */
.tip{border-left:2px solid var(--hair2);padding:14px 0 14px 15px;margin-bottom:2px}
.tip+.tip{border-top:1px solid var(--hair)}
.tip.money{border-left-color:var(--fg1)}
.tip.risk{border-left-color:var(--fg1);border-left-style:dashed}
.tip .h{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}
.tip .ti{font-size:14.5px;font-weight:700;color:var(--fg1)}
.tip .amt{margin-left:auto;font-size:16px;font-weight:700;color:var(--fg1);white-space:nowrap;font-variant-numeric:tabular-nums}
.tip .amt small{display:block;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg3);text-align:right;margin-top:3px}
.tip .f{font-size:13px;color:var(--fg2);line-height:1.65;margin-top:8px}
.tip .a{font-size:13px;color:var(--fg1);line-height:1.65;margin-top:8px}
.tip .a b{color:var(--fg1);font-weight:700}
.tip .b{font-family:var(--mono);font-size:10.5px;color:var(--fg3);margin-top:9px;line-height:1.65}
.tip .bd{font-size:10.5px;color:var(--fg3);margin-top:5px;line-height:1.6;font-style:italic}
.tipsum{font-size:12px;color:var(--fg2);margin-top:12px;line-height:1.65}
.tipsum b{color:var(--fg1);font-weight:700}

/* Period-over-period. Bars are signed and share one scale so a small effect
   next to a large one looks small. Direction is carried by which side of the
   midline the bar sits on and by the sign on the figure, not by hue. */
.varsent{font-size:14px;color:var(--fg1);line-height:1.7}
.vartable{margin-top:16px;display:grid;gap:8px}
.varrow{display:grid;grid-template-columns:minmax(120px,150px) 1fr 74px;gap:12px;align-items:center;font-size:12px}
.varrow .lb{color:var(--fg2)}
.varrow .tr{position:relative;height:16px;background:var(--ghost);border-radius:3px;overflow:hidden;border:1px solid var(--hair)}
.varrow .tr i{position:absolute;top:0;bottom:0;display:block}
.varrow .tr i.pos{background:var(--fg1);left:50%}
.varrow .tr i.neg{background:var(--fg3);right:50%}
.varrow .tr .mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--hair3);z-index:1}
.varrow .dv{text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--fg1);font-variant-numeric:tabular-nums}
.varrow .dv.neg{color:var(--fg2)}
.varfoot{font-size:11px;color:var(--fg3);margin-top:14px;line-height:1.75}
.varwho{font-size:12px;color:var(--fg2);margin-top:14px;line-height:1.75}
.varwho b{color:var(--fg1);font-weight:600}

/* The floor map. Monochrome on purpose: the page carries no status colours
   anywhere (see the note at the top of this stylesheet), so stall density is
   carried by ink opacity, never by a red-to-green ramp. It also has to survive
   being printed and handed to a shift lead, which is the actual use. */
.map{margin-top:2px;padding:16px 2px 6px}
.map svg{display:block;width:100%;height:auto;max-height:380px;overflow:visible}
.map .ground{fill:var(--fg1)}
.map .stall{fill:var(--fg1)}
.map .lbl{font-family:var(--mono);font-size:.34px;font-weight:700;text-anchor:middle;dominant-baseline:central}
.maplegend{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin-top:14px;font-size:11px;color:var(--fg3)}
.maplegend i{display:inline-block;width:11px;height:11px;border:1px solid var(--hair2);vertical-align:-1px;margin-right:6px}
.maplegend i.g{background:rgba(22,32,74,.09)}
.maplegend i.s{background:rgba(22,32,74,.72)}
.mapsite{font-size:12px;color:var(--fg2);margin-top:14px}
.mapsite b{color:var(--fg1);font-weight:600}

/* Brand rows reuse .rob wholesale; only the small print differs. */
.brandnote{font-size:11px;color:var(--fg3);margin-top:6px;line-height:1.6;font-style:italic}

/* ---- app shell ----
   Measurements taken from the prototype's render() / appRail() / appStage() at
   c0c25e0, not approximated: 256px is shadcn's SIDEBAR_WIDTH, which is what
   that design is built against. The page gradient covers the whole frame, and
   every screen's body sits inside one transparent bordered card. */
body{padding:0;max-width:none;margin-inline:0}
.frame{position:relative;min-height:100vh;background:var(--page);display:grid;align-items:start}
body.app .frame{grid-template-columns:256px minmax(0,1fr)}
body.solo .frame{grid-template-columns:minmax(0,1fr)}

.stage{padding:36px 34px 44px 0;min-width:0}
body.solo .stage{padding:56px 34px 80px;display:flex;justify-content:center}
body.solo .stage-card{width:100%;max-width:860px}
.stage-card{background:transparent;border:1px solid var(--hair);border-radius:4px;padding:40px 40px 44px}

.foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;margin-top:36px;padding-top:28px;border-top:1px solid var(--hair)}
.foot .fn{font-size:12.5px;color:var(--fg3);max-width:62ch}
.foot .fl{display:flex;gap:20px;align-items:center}
.foot .fl a{font-size:13px;font-weight:600;text-decoration:none}
.foot .fl span{font-size:12.5px;color:var(--fg3)}

/* Rail. Item metrics are the prototype's: 32px tall, 8px pad, 8px radius,
   14px type, 500 idle / 600 active, shadcn sidebar tokens for the states. */
.rail{position:sticky;top:0;min-height:100vh;display:flex;flex-direction:column;gap:4px;padding:16px 12px;background:var(--sb-bg);border-right:1px solid var(--sb-border)}
.rail .brand{padding:8px 8px 20px}
.rail .wm{display:block;font-size:12px;font-weight:800;letter-spacing:.14em;color:var(--fg1)}
.rail .org{display:block;font-size:11.5px;font-weight:500;color:var(--fg3);margin-top:4px}
.rail .nav-list{display:flex;flex-direction:column;gap:2px}
.rail .ni{position:relative;display:flex;align-items:center;box-sizing:border-box;width:100%;height:32px;gap:8px;padding:8px;
  border-radius:8px;font-size:14px;font-weight:500;color:var(--sb-fg);background:transparent;text-decoration:none}
.rail .ni:hover{background:var(--sb-accent);color:var(--sb-accent-fg)}
.rail .ni.on{background:var(--sb-accent);color:var(--sb-accent-fg);font-weight:600}
.rail .nb{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--sb-accent-fg);color:var(--sb-bg);
  font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.rail .railout{margin-top:auto;padding:8px}
.linkish{background:none;border:0;padding:0;color:var(--fg3);font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.linkish:hover{color:var(--fg1);opacity:1}

/* Cards carry a hairline and nothing else. The prototype fills none of them;
   the page gradient is what shows through, and that is the whole surface
   treatment. */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;align-items:start;margin-top:18px}
.card{border:1px solid var(--hair);border-radius:6px;padding:22px 24px 18px}
.card.wide{grid-column:1/-1}
.card>h3{font-size:13.5px;font-weight:700;color:var(--fg1);margin:0 0 3px}
.card>.cs{font-size:12px;color:var(--fg3);margin-bottom:12px;line-height:1.55}

.ph{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;justify-content:space-between}
.ph h1{font-size:27px;letter-spacing:-.02em}
.ph .per{font-size:12.5px;font-weight:700;color:var(--fg1);border:1px solid var(--hair);border-radius:4px;padding:8px 14px}

/* Fleet rows carry a proportional bar, drawn against the strongest robot in
   the fleet so the shape of the list is the finding, not any one number. */
.fl{display:grid;grid-template-columns:minmax(0,1fr) 120px 68px;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--hair)}
.fl:last-child{border-bottom:0}
.fl .who .nm{font-size:13.5px;font-weight:600;color:var(--fg1)}
.fl .who .mk{font-size:11.5px;color:var(--fg3);margin-top:3px}
.fl .bar{height:8px;background:var(--ghost);border:1px solid var(--hair);border-radius:4px;overflow:hidden}
.fl .bar i{display:block;height:100%;background:var(--fg1)}
.fl .bar i.short{background:var(--fg3)}
.fl .cv{text-align:right;font-size:14px;font-weight:700;color:var(--fg1);font-variant-numeric:tabular-nums}
.fl .cv.under{font-weight:800}
.fl .cv.none{color:var(--fg3);font-weight:600;font-size:12.5px}

@media (max-width:860px){
  body.app{grid-template-columns:1fr}
  .rail{position:static;height:auto;flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--sb-border)}
  .rail .brand{padding:0 8px 0 0}
  .rail .org{display:none}
  .rail .nav-list{flex-direction:row}
  .rail .railout{margin-top:0;margin-left:auto;padding:0 4px}
}
@media (max-width:640px){
  body{padding:20px 16px 48px}
  body.app{padding:0}
  body.app .content{padding:22px 16px 48px}
  .headline{padding:20px 18px}
  .headline .big{font-size:42px}
  .ph h1{font-size:23px}
  .varrow{grid-template-columns:1fr;gap:4px}
  .varrow .dv{text-align:left}
  .fl{grid-template-columns:minmax(0,1fr) 68px}
  .fl .bar{display:none}
}
`;

const HONESTY_NOTE = `
Botlien prices the work your robots performed, valued at what that work costs to buy elsewhere,
against what you pay to lease them. It does not claim revenue, profit, or labor saved,
because telemetry cannot show what your business would have done without the robots.
Counts come from mission starts reported by the robot, so they read as runs started, not runs completed.
Every figure above shows its arithmetic so you can check it by hand.`;

// The rail is the product, so it appears on the three app screens and nowhere
// else. First run gets no rail on purpose: a nav pointing at a statement that
// cannot be rendered yet invites a click that can only bounce back, and the
// prototype makes the same call for the same reason.
/** Short range for the period pill. The long sentence explaining the clamp
 *  belongs in the headline caption, where it can be read once; repeating it in
 *  a chip turns a label into a paragraph. */
function periodPill(m) {
  const f = { month: "short", day: "numeric" };
  const from = new Date(m.fromMs).toLocaleDateString("en-US", f);
  const to = new Date(m.toMs).toLocaleDateString("en-US", { ...f, year: "numeric" });
  return `${from} – ${to}`;
}

const NAV_ITEMS = [
  { key: "dashboard", href: "/owner", label: "Dashboard" },
  { key: "fleet", href: "/owner/fleet", label: "Fleet" },
  { key: "costs", href: "/owner/costs", label: "Costs" },
  { key: "numbers", href: "/owner/setup", label: "Numbers" },
];

function rail({ active, fleetBadge = 0, businessLabel = null }) {
  const item = (n) => {
    const on = n.key === active;
    // Live count of robots under their lease, matching the prototype's
    // attnCount: an edit on Numbers that pushes a robot under, or pulls it
    // back over, shows up here the same instant it shows up on Fleet.
    const badge =
      n.key === "fleet" && fleetBadge > 0 ? `<span class="nb">${fleetBadge}</span>` : "";
    return `<a class="ni${on ? " on" : ""}" href="${n.href}"${on ? ' aria-current="page"' : ""}>${esc(n.label)}${badge}</a>`;
  };
  return `<nav class="rail">
  <div class="brand"><span class="wm">BOTLIEN</span>${businessLabel ? `<span class="org">${esc(businessLabel)}</span>` : ""}</div>
  <div class="nav-list">${NAV_ITEMS.map(item).join("")}</div>
  <form class="railout" method="post" action="/signout"><button type="submit" class="linkish">Sign out</button></form>
</nav>`;
}

// Footer sits inside the content card, not under it, exactly as appStage()
// composes it in the prototype.
const STAGE_FOOT = `<div class="foot">
  <div class="fn">Counts are mission starts reported by the robot, so they read as runs started. Work is valued at replacement rates, never at what an order was worth.</div>
  <div class="fl"><a href="mailto:info@botlien.com">info@botlien.com</a><span>© 2026 Botlien</span></div>
</div>`;

/** Frame from the prototype's render(): a full-height gradient page, a
 *  256px rail beside a content column, and every screen's body inside one
 *  transparent bordered card. Onboarding drops the rail and centres its own
 *  column, because there is nothing to navigate to until a fleet exists. */
function shell(title, body, { nav = null } = {}) {
  const inner = `<div class="stage"><div class="stage-card">${body}${STAGE_FOOT}</div></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${OWNER_CSS}</style></head>
<body class="${nav ? "app" : "solo"}"><div class="frame">${nav ? rail(nav) : ""}${inner}</div></body></html>`;
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
    `<div class="ph"><h1>Dashboard${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="per">${esc(periodPill(m))}</div></div>
<div class="sub">what your robots serviced · ${esc(new Date(m.nowMs).toLocaleString("en-US"))}</div>
<div class="nav"><a href="/">Risk board</a><a href="/api/owner">JSON</a></div>

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
<script>setTimeout(() => location.reload(), 15000);</script>`,
    { nav: { active: "dashboard", fleetBadge: underLeaseCount(m) } }
  );
}

/** Robots priced below their own lease. Unpriced robots are not counted: a
 *  robot with no rate has not been shown to be under anything, and padding the
 *  badge with unknowns would train the owner to ignore it. */
export function underLeaseCount(m) {
  return m.robots.filter((r) => r.fin && r.fin.coverage !== null && r.fin.coverage < 1).length;
}

/** The Costs page.
 *
 *  One tab rather than three, because these three panels answer one question
 *  between them: what is this fleet really costing, and where is it leaking?
 *  Splitting them would put three metrics in a rail that otherwise lists
 *  places (the summary, the robots, the settings), and two of the three do not
 *  render for every operator: the brand table needs a fleet running more than
 *  one make, and the map needs a feed that reports position. As tabs those
 *  would be dead tabs. As sections they simply are not there, and the page says
 *  what would bring them back.
 */
export function renderCostsHTML(m) {
  // ---- what it costs to keep them running ----
  // Two figures kept strictly apart, because one is measured and one is not.
  // Driving by hand comes off the wire. Clearing a stall is a count off the
  // wire multiplied by an assumption about a person, and the panel says which
  // is which rather than blending them into one confident total.
  const iv = m.interventions;
  const hrs = (h) => (h === null || h === undefined ? "–" : h >= 10 ? Math.round(h).toLocaleString("en-US") : h.toFixed(1));
  // Prose rounds; the formula line does not. Every derivation on this page is
  // meant to survive being checked on paper, and "13 h × $25.00/h = $315.00"
  // does not survive it.
  const exact = (h) => (h === null || h === undefined ? "–" : h.toFixed(1));
  const interventionsPanel = !iv || !iv.material
    ? ""
    : `<h2>What it costs to keep them running</h2>
<div class="tiles">
  <div class="tile"><div class="k">Clearing stalls</div><div class="v">${esc(money(iv.clearCents))}</div>
    <div class="n">${esc(iv.clears.toLocaleString("en-US"))} stalls, counted from telemetry, at an assumed ${m.minutesPerClear} minutes of someone's time each</div></div>
  <div class="tile"><div class="k">Driving by hand</div>
    <div class="v">${iv.hasManualFeed ? esc(money(iv.manualCents)) : "–"}</div>
    <div class="n">${
      iv.hasManualFeed
        ? `${esc(hrs(iv.manualHours))} hours with a person on the controls, measured directly, no assumption`
        : "your feed does not report manual control, so this one is unknown rather than zero"
    }</div></div>
  <div class="tile"><div class="k">On top of the lease</div><div class="v">${esc(money(iv.totalCents))}</div>
    <div class="n">labour your invoice never shows, over the same period as every other figure here</div></div>
</div>
<div class="panel">
  ${m.interventionSentence ? `<div class="varsent">${esc(m.interventionSentence)}</div>` : ""}
  ${iv.worst
    .map(
      (r) => `
    <div class="rob">
      <div class="top">
        <span class="nm">${esc(r.robotName)}</span>
        <span class="mk">${
          r.clears > 0 ? `${esc(r.clears.toLocaleString("en-US"))} stall${r.clears === 1 ? "" : "s"}` : "driven by hand"
        }</span>
        <span class="cov">${esc(money(r.totalCents))}</span>
      </div>
      <div class="fml">${
        // Zero terms are dropped rather than printed. A robot whose whole cost
        // is somebody steering it should not read "0.0 h clearing", and one
        // that never stalled should not carry a trailing "stalled 0.0 h".
        [
          r.clears > 0 ? `${esc(exact(r.clearHours))} h clearing` : null,
          r.manualHours !== null && r.manualHours > 0.05 ? `${esc(exact(r.manualHours))} h driven by hand` : null,
        ]
          .filter(Boolean)
          .join(" + ")
      }${r.wageCentsHour ? ` × ${esc(money(r.wageCentsHour))}/h` : ""}${
        r.stalledHours > 0.05 ? ` · robot itself stalled ${esc(exact(r.stalledHours))} h` : ""
      }</div>
    </div>`
    )
    .join("")}
  <div class="varfoot">
    The stall count is measured. The ${m.minutesPerClear} minutes per stall is not: it is our assumption about how long a
    person takes to notice, walk over, free the machine and walk back${
      iv.anyBenchmarkWage ? ", and some robots are priced at a benchmark wage rather than yours" : ""
    }. Halve it and this figure halves. The hours the robot spent stalled are shown for context and are deliberately not
    charged here as labour, because your coverage figure already counts them as work the robot did not really perform,
    and billing the same hours twice would flatter this panel.
    ${iv.unpricedCount > 0 ? `${iv.unpricedCount} robot${iv.unpricedCount > 1 ? "s are" : " is"} left out of the money for want of an hourly wage.` : ""}
  </div>
</div>`;

  // ---- the floor ----
  // The stall tip already names the worst spot and prices it. Words make an
  // owner nod; a picture of their own building makes someone walk out to the
  // aisle. Same numbers, drawn.
  const floorSvg = (plan) => {
    const pad = 0.6;
    const w = plan.cols + pad * 2;
    const h = plan.rows + pad * 2;
    const ground = plan.cells
      .map(
        (c) =>
          `<rect class="ground" x="${(c.x + pad).toFixed(2)}" y="${(c.y + pad).toFixed(2)}" width="1" height="1" opacity="${(0.03 + c.presence * 0.09).toFixed(3)}"/>`
      )
      .join("");
    const stalls = plan.cells
      .filter((c) => c.stuck > 0)
      .map(
        (c) =>
          `<rect class="stall" x="${(c.x + pad).toFixed(2)}" y="${(c.y + pad).toFixed(2)}" width="1" height="1" opacity="${(0.1 + c.weight * 0.72).toFixed(3)}"/>`
      )
      .join("");
    const labels = plan.cells
      .filter((c) => c.label && c.hours !== null && c.hours >= 0.5)
      .map(
        (c) =>
          `<text class="lbl" x="${(c.x + pad + 0.5).toFixed(2)}" y="${(c.y + pad + 0.5).toFixed(2)}" fill="${
            c.weight > 0.55 ? "#FFFFFF" : "#16204A"
          }">${esc(hrs(c.hours))}h</text>`
      )
      .join("");
    return `<svg viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="Map of where the robots drive and where they get stuck">${ground}${stalls}${labels}</svg>`;
  };

  const floorPanel =
    (m.floors ?? []).length === 0
      ? ""
      : `<h2>Where they get stuck</h2>
${m.floors
  .map(
    (f) => `<div class="panel">
  <div class="mapsite"><b>${esc(f.site)}</b> · ${esc(f.robotCount)} robot${f.robotCount === 1 ? "" : "s"} · about ${esc(
      Math.round(f.plan.widthMeters)
    )} m by ${esc(Math.round(f.plan.heightMeters))} m of floor actually driven</div>
  <div class="map">${floorSvg(f.plan)}</div>
  <div class="maplegend">
    <span><i class="g"></i>where the robots drive</span>
    <span><i class="s"></i>where they get stuck, darker is worse</span>
    <span>each square is ${esc(f.plan.gridMeters)} m</span>
  </div>
  <div class="varfoot">
    No floor plan was uploaded and none is needed. The shape above is simply everywhere your robots have driven, so it is
    their map rather than the building's. ${Math.round(f.plan.top3Share * 100)}% of the stall time at this site landed in
    the three darkest squares${
      f.plan.hottest && f.plan.hottest.hours !== null ? `, the worst of them holding about ${esc(hrs(f.plan.hottest.hours))} hours on its own` : ""
    }.
    ${
      f.plan.top3Share >= 0.5
        ? "That is concentrated enough to walk to: a door that swings shut, a pallet corner, a mat edge, a blind turn the robot's map does not know about."
        : "That is spread out rather than concentrated, which points at the traffic or the machines themselves rather than at one bad spot in the building."
    }
  </div>
</div>`
  )
  .join("")}`;

  // ---- brand against brand ----
  // The one comparison a manufacturer structurally cannot ship, because a
  // vendor dashboard can only ever see that vendor's own machines.
  const brandGroups = (m.brands?.groups ?? []).filter((g) => g.comparable);
  const brandPanel =
    brandGroups.length === 0
      ? ""
      : `<h2>Brand against brand</h2>
${brandGroups
  .map(
    (g) => `<div class="panel">
  <div class="varsent">${esc(brandSentence(g) ?? "")}</div>
  ${g.brands
    .map(
      (b) => `
    <div class="rob">
      <div class="top">
        <span class="nm">${esc(b.brand)}</span>
        <span class="mk">${esc(b.robotCount)} robot${b.robotCount === 1 ? "" : "s"}${
        b.thin ? " · too little work here to read as a finding" : ""
      }</span>
        <span class="cov">${esc(money(b.costPerTaskCents))}</span>
      </div>
      <div class="fml">${esc(num(b.tasks, g.basis))} ${esc(g.taskLabel)} · ${esc(hrs(b.activeHours))} active hours · ${esc(
        money(b.invoiceCents)
      )} of invoice · ${esc(ratio(b.coverage))} coverage</div>
    </div>`
    )
    .join("")}
  <div class="varfoot">
    Cost per ${esc(g.unit)} is the same figure used everywhere else on this page, invoice divided by work performed, so a
    brand row can be checked against the robot rows it came from. At the volume your ${esc(g.worst.brand)} machines
    actually ran, that gap is worth about ${esc(money(g.gapValueCents))} over this period.
  </div>
  <div class="brandnote">
    ${
      g.singleMachineBrands.length
        ? `Your ${g.singleMachineBrands.map((b) => esc(b)).join(" and ")} figure rests on a single machine, so it may be telling you about that machine rather than about the brand. `
        : ""
    }This is an observation, not an experiment. Two brands in one fleet are rarely given the same routes, shifts or floors,
    so the gap only becomes a verdict on the machines once they have run the same work. Swapping them for a fortnight
    settles it, and that is a thing you can do that nobody else can measure for you.
  </div>
</div>`
  )
  .join("")}`;

  const nothing = !interventionsPanel && !floorPanel && !brandPanel;

  return shell(
    "Botlien · costs",
    `<div class="ph"><h1>Costs${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="per">${esc(periodPill(m))}</div></div>
<div class="sub">what the fleet costs beyond the invoice · ${esc(new Date(m.nowMs).toLocaleString("en-US"))}</div>
<div class="nav"><a href="/owner">Dashboard</a><a href="/owner/fleet">Fleet</a><a href="/owner/setup">Set your numbers</a></div>

${
  nothing
    ? `<div class="panel"><div class="empty">Nothing to show for this period yet.</div></div>
<div class="varfoot">
  This page fills in from telemetry you may already have. Stall clearing needs a stuck or error field and at least a
  few stalls in the window. The floor map needs position on each reading. The brand comparison needs a fleet running
  more than one make, priced. Anything your export does not carry is left blank here rather than guessed at.
</div>`
    : `<div class="headline">
  <span class="cap">Beyond the lease invoice</span>
  <span class="big">${esc(money(m.interventions?.totalCents ?? null))}</span>
  <div class="say">
    Labour spent keeping the robots working over this period, which arrives on no invoice and appears in no vendor
    dashboard. It sits <b>on top of</b> the lease payments already counted in your coverage figure, not inside them.
  </div>
</div>

${interventionsPanel}
${floorPanel}
${brandPanel}`
}

<div class="honest">${esc(HONESTY_NOTE.trim())}</div>`,
    { nav: { active: "costs", fleetBadge: underLeaseCount(m) } }
  );
}

export function renderFleetHTML(m) {
  const covClass = (c) => (c === null ? "none" : c >= 1 ? "ok" : "under");
  // Bars are drawn against the strongest robot present, not against 1.00x, so
  // the list keeps its shape when every robot clears its lease comfortably.
  const top = Math.max(...m.robots.map((r) => r.fin?.coverage ?? 0), 1);

  const row = (r) => {
    const c = r.fin?.coverage ?? null;
    const w = c === null ? 0 : Math.max(2, Math.min(100, (c / top) * 100));
    return `
    <div class="fl">
      <div class="who">
        <div class="nm">${esc(r.name)}${r.fin && !r.configured ? ' <span class="tag def">benchmark default</span>' : ""}${!r.fin ? ' <span class="tag">no rate set</span>' : ""}</div>
        <div class="mk">${esc([r.brand, r.model].filter(Boolean).join(" ")) || "—"}</div>
      </div>
      <div class="bar">${c === null ? "" : `<i class="${c < 1 ? "short" : ""}" style="width:${w.toFixed(1)}%"></i>`}</div>
      <div class="cv ${covClass(c)}">${c === null ? "no rate" : esc(ratio(c))}</div>
    </div>`;
  };

  const under = underLeaseCount(m);
  const siteBlock = (s) => `<h2>${esc(s.name)} · ${esc(ratio(s.totals.coverage))} coverage</h2>
<div class="panel">${s.robots.length === 0 ? '<div class="empty">no robots</div>' : s.robots.map(row).join("")}</div>`;

  return shell(
    "Botlien · fleet",
    `<div class="ph"><h1>Fleet${m.demo ? '<span class="badge">DEMO — simulated fleet</span>' : ""}</h1>
<div class="per">${esc(periodPill(m))}</div></div>
<div class="sub">${
      m.robots.length === 0
        ? "no robots yet"
        : `${m.robots.length} robot${m.robots.length > 1 ? "s" : ""} · ${
            under === 0 ? "every priced robot is covering its lease" : `${under} running under its lease`
          }`
    }</div>
<div class="nav"><a href="/owner">Dashboard</a><a href="/owner/setup">Set your numbers</a></div>

${m.sites.length === 0 ? '<h2>Robots</h2><div class="panel"><div class="empty">no robots yet</div></div>' : m.sites.map(siteBlock).join("")}

${
  m.unpricedCount > 0
    ? `<div class="note">${m.unpricedCount} robot${m.unpricedCount > 1 ? "s have" : " has"} no rate set, so ${m.unpricedCount > 1 ? "they are" : "it is"} left out of every figure rather than counted as zero. <a href="/owner/setup">Set your numbers</a>.</div>`
    : ""
}

<div class="honest">${esc(HONESTY_NOTE.trim())}</div>`,
    { nav: { active: "fleet", fleetBadge: under } }
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
    `<div class="ph"><h1>Numbers</h1></div>
<div class="sub">five numbers per robot, then every figure on your board is yours instead of a benchmark</div>
${saved ? '<div class="note">Saved.</div>' : ""}
${m.robots.length === 0 ? '<div class="panel"><div class="empty">no robots yet, start the engine first</div></div>' : `<form method="POST" action="/owner/setup">${m.robots.map(row).join("")}<button type="submit">Save and see my numbers</button></form>`}
<div class="honest">${esc(HONESTY_NOTE.trim())}</div>`,
    { nav: { active: "numbers", fleetBadge: underLeaseCount(m) } }
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
