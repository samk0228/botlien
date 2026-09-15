// Generates the Botlien Costs action-queue artboards from one template.
// Numbers follow DESIGN_PROMPT_costs_v1/v2/v3 exactly; SVG charts are computed here
// so the mini strips and the full strips share one vertical scale (v2 A1).
import { writeFileSync } from "node:fs";

const FG1 = "#16204A", FG2 = "#6B7392", FG3 = "#9AA1BC";
const HAIR = "rgba(10,10,10,.10)", HAIR2 = "rgba(10,10,10,.16)";

// Stall hours by hour of day (0..23), per kind of work. Sums: picking 29.3h with
// 2p+3p = 11.1h (38%); cleaning 1.7h flat, worst two hours 0.5h.
const picking = Array(24).fill(0);
[0.5, 1.0, 1.5, 1.8, 2.0, 1.9, 1.7, 2.2, 5.2, 5.9, 2.9, 2.7].forEach((v, i) => (picking[6 + i] = v));
const cleaning = Array(24).fill(0);
[0.2, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25].forEach((v, i) => (cleaning[(22 + i) % 24] = v));
const ceiling = Math.max(...picking, ...cleaning); // 5.9, shared by every strip on the page
const sum = (a) => a.reduce((x, y) => x + y, 0);
const f1 = (n) => n.toFixed(1);

// ---- mini strip (110x24, no axis, bracket over the worst two hours) ----
function miniStrip(hours, worst) {
  const W = 110, H = 24, gap = 1, bw = (W - 23 * gap) / 24, top = 5;
  let out = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stall time by hour of day, worst two hours marked">`;
  hours.forEach((h, i) => {
    const bh = ((H - top) * h) / ceiling;
    if (bh <= 0) return;
    const x = i * (bw + gap);
    out += `<rect x="${x.toFixed(2)}" y="${(H - bh).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${FG1}" opacity="${(0.35 + 0.65 * (h / ceiling)).toFixed(2)}"></rect>`;
  });
  if (worst) {
    const x0 = worst[0] * (bw + gap), x1 = (worst[1] + 1) * (bw + gap) - gap;
    out += `<path d="M${x0.toFixed(2)} 3.5 V1.5 H${x1.toFixed(2)} V3.5" fill="none" stroke="${FG1}" stroke-width="1"></path>`;
  }
  return out + `</svg>`;
}

// ---- full strip (fluid width via viewBox, axis, operating wash, bracket + figure) ----
function fullStrip(hours, worst, windowHours, label) {
  const W = 480, H = 96, padB = 18, padT = 22, gap = 2, bw = (W - 23 * gap) / 24;
  const plotH = H - padB - padT;
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto" role="img" aria-label="${label}">`;
  // operating window wash
  for (const [a, b] of windowHours || []) {
    const x0 = a * (bw + gap), x1 = (b + 1) * (bw + gap) - gap;
    out += `<rect x="${x0.toFixed(2)}" y="${padT}" width="${(x1 - x0).toFixed(2)}" height="${plotH}" fill="rgba(10,10,10,.035)"></rect>`;
  }
  out += `<line x1="0" y1="${H - padB + 0.5}" x2="${W}" y2="${H - padB + 0.5}" stroke="${HAIR2}" stroke-width="1"></line>`;
  hours.forEach((h, i) => {
    const bh = (plotH * h) / ceiling;
    if (bh <= 0) return;
    const x = i * (bw + gap);
    out += `<rect x="${x.toFixed(2)}" y="${(H - padB - bh).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="${FG1}" opacity="${(0.35 + 0.65 * (h / ceiling)).toFixed(2)}"></rect>`;
  });
  // axis labels at 12a 6a 12p 6p 12a
  const ticks = [[0, "12a"], [6, "6a"], [12, "12p"], [18, "6p"], [24, "12a"]];
  ticks.forEach(([hh, t]) => {
    const x = Math.min(hh * (bw + gap), W);
    const anchor = hh === 0 ? "start" : hh === 24 ? "end" : "middle";
    out += `<text x="${x.toFixed(2)}" y="${H - 4}" font-size="9" fill="${FG3}" text-anchor="${anchor}" font-family="Inter, system-ui, sans-serif">${t}</text>`;
  });
  if (worst) {
    const x0 = worst[0] * (bw + gap), x1 = (worst[1] + 1) * (bw + gap) - gap;
    const fig = f1(hours[worst[0]] + hours[worst[1]]);
    out += `<path d="M${x0.toFixed(2)} ${padT - 4} V${padT - 9} H${x1.toFixed(2)} V${padT - 4}" fill="none" stroke="${FG1}" stroke-width="1"></path>`;
    out += `<text x="${((x0 + x1) / 2).toFixed(2)}" y="${padT - 12}" font-size="10" font-weight="700" fill="${FG1}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" style="font-variant-numeric:tabular-nums">${fig}h</text>`;
  }
  return out + `</svg>`;
}

// ---- paired bars for the brand row (110x24, cheapest first, longer is more) ----
function pairBars(a, b) {
  const W = 110, H = 24, max = Math.max(a, b);
  const wa = (W * a) / max, wb = (W * b) / max;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost per pick, two brands, longer is more">` +
    `<rect x="0" y="2" width="${wa.toFixed(1)}" height="9" fill="${FG1}" opacity="0.55"></rect>` +
    `<rect x="0" y="13" width="${wb.toFixed(1)}" height="9" fill="${FG1}" opacity="1"></rect></svg>`;
}

const chev = (rot) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex:none;transition:transform .15s;transform:rotate(${rot}deg)"><path d="M6 3l5 5-5 5" stroke="${FG2}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

const mini1 = miniStrip(picking, [14, 15]);
const mini2 = pairBars(0.44, 0.61);
const strip1 = fullStrip(picking, [14, 15], [[6, 17]], "Order picking: stall time by hour of day");
const strip2b = fullStrip(cleaning, null, [[22, 23], [0, 4]], "Floor cleaning: stall time by hour of day");

const hatch = `repeating-linear-gradient(135deg, rgba(10,10,10,.35) 0 2px, rgba(10,10,10,.08) 2px 5px)`;

const css = `
html,body{min-height:100%;margin:0}
body{background:#F1F2FC linear-gradient(160deg,#EDEFFC 0%,#F4F1FB 45%,#F2F6FD 100%) fixed;}
a{color:${FG1};text-underline-offset:3px} a:hover{color:${FG2}}
.page *{box-sizing:border-box}
.tiles{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:12px;margin-top:14px}
.tile{border:1px solid ${HAIR};border-radius:6px;padding:15px 16px;background:transparent}
.tile .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:${FG3}}
.tile .v{font-size:26px;font-weight:700;letter-spacing:-.01em;margin-top:6px;color:${FG1};font-variant-numeric:tabular-nums}
.tile .n{font-size:11.5px;color:${FG3};margin-top:5px;line-height:1.55}
.panel{border:1px solid ${HAIR};border-radius:6px;padding:4px 18px;margin-top:12px;background:transparent}
.rob{padding:13px 0;border-bottom:1px solid ${HAIR}}
.rob:last-child{border-bottom:0}
.rob .top{display:flex;flex-wrap:wrap;gap:9px;align-items:baseline;font-size:13.5px}
.rob .nm{font-weight:600;color:${FG1}}
.rob .mk{color:${FG3};font-size:11.5px}
.rob .cov{margin-left:auto;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:${FG1}}
.rob .fml{font-family:ui-monospace,Menlo,"SF Mono",monospace;font-size:11px;color:${FG3};margin-top:7px;line-height:1.6}
.varsent{font-size:14px;color:${FG1};line-height:1.7;padding:12px 0 4px}
.varfoot{font-size:11px;color:${FG3};margin-top:14px;line-height:1.75}
.h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:${FG3};margin:22px 0 8px}
.legend{font-size:11px;color:${FG3};margin-top:8px;line-height:1.6}
.method{font-size:13px;color:${FG2};line-height:1.7}
.method p{margin:0 0 10px}
.method b{color:${FG1};font-weight:600}
.ctl{display:inline-flex;align-items:center;gap:8px;border:1px solid ${HAIR2};border-radius:4px;padding:2px;background:#fff}
.ctl button{width:44px;height:44px;border:0;background:transparent;color:${FG1};font-size:18px;font-weight:600;border-radius:3px;cursor:pointer;font-family:inherit}
.ctl button:hover{background:rgba(10,10,10,.04)}
.ctl .val{min-width:34px;text-align:center;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:${FG1}}
.rowbtn{display:flex;gap:14px;align-items:baseline;width:100%;text-align:left;background:transparent;border:0;padding:0;cursor:pointer;font-family:inherit;color:inherit}
.shape{flex:none;width:110px;height:24px;display:block}
@media (max-width:640px){
  .tiles{grid-template-columns:minmax(0,1fr)}
  .shape{display:none}
  .hdr{flex-direction:column;align-items:flex-start;gap:10px}
  .hdr-right{width:100%;justify-content:space-between}
  .rowbtn{flex-wrap:nowrap;gap:10px}
  .barlabels{flex-direction:column;gap:2px}
  .barlabels span{text-align:left !important}
}
`;

function template({ openDefault, periodDefault }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap">
  <style>${css}</style>
</helmet>
<div class="page" style="min-height: 100%; background: transparent; color: ${FG1}; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; font-size: 14px; line-height: 1.5; padding: 32px 24px 64px;">
<div style="max-width: 1060px; margin: 0 auto;">

  <div class="hdr" style="display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px;">
    <div style="display: flex; align-items: baseline; gap: 10px;">
      <h1 style="font-size: 27px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: ${FG1};">Costs</h1>
      <span style="background: rgba(10,10,10,.04); color: ${FG2}; border: 1px solid ${HAIR2}; border-radius: 3px; padding: 2px 7px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;">DEMO · SIMULATED FLEET</span>
    </div>
    <div class="hdr-right" style="display: flex; align-items: center; gap: 10px;">
      <button type="button" style="display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${FG1}; background: transparent; border: 1px solid ${HAIR}; border-radius: 4px; padding: 8px 12px; cursor: pointer;">All 3 sites <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="${FG2}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
      <span style="font-size: 12.5px; font-weight: 700; color: ${FG1}; border: 1px solid ${HAIR}; border-radius: 4px; padding: 8px 14px; font-variant-numeric: tabular-nums;">Aug 10 – 31, 2026</span>
    </div>
  </div>

  <div style="border: 1px solid ${HAIR}; border-radius: 6px; padding: 22px 24px 20px; margin-top: 18px;">
    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: ${FG3};">Beyond the lease</div>
    <div style="font-size: 36px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; color: ${FG1}; margin-top: 6px; font-variant-numeric: tabular-nums;">{{ totalMoney }}</div>
    <div style="display: flex; height: 14px; margin-top: 16px; border-radius: 2px; overflow: hidden; gap: 2px;">
      <div style="width: {{ leasePct }}%; background: ${FG1}; opacity: 0.28;"></div>
      <div style="width: {{ manualPct }}%; background: ${FG1};"></div>
      <div style="width: {{ clearPct }}%; background: ${hatch};"></div>
    </div>
    <div class="barlabels" style="display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 11.5px; color: ${FG3}; font-variant-numeric: tabular-nums;">
      <span>lease <b style="color: ${FG2}; font-weight: 600;">$16,700.00</b></span>
      <span style="text-align: right;">measured <b style="color: ${FG2}; font-weight: 600;">{{ manualMoney }}</b> &nbsp;·&nbsp; estimated <b style="color: ${FG2}; font-weight: 600;">{{ clearMoney }}</b></span>
    </div>
  </div>

  <sc-if value="{{ hasFindings }}" hint-placeholder-val="{{ true }}">
  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: ${FG3}; margin: 34px 0 10px;">What to do</div>

  <div style="border-left: 2px solid ${FG1}; padding: 14px 0 14px 15px;">
    <button type="button" class="rowbtn" onClick="{{ toggle1 }}">
      <span style="flex: none; width: 14px; font-family: ui-monospace, Menlo, 'SF Mono', monospace; font-size: 11px; color: ${FG3}; font-variant-numeric: tabular-nums;">1</span>
      <span style="flex: 1 1 auto; min-width: 0; font-size: 14.5px; font-weight: 700; color: ${FG1};">Go watch the 2pm shift</span>
      <span class="amt" style="margin-left: auto; font-size: 16px; font-weight: 700; color: ${FG1}; white-space: nowrap; font-variant-numeric: tabular-nums;">{{ totalMoney }}</span>
      <span class="shape" style="margin-left: 18px;">${mini1}</span>
      <span style="flex: none; display: inline-flex; align-items: center; transform: rotate({{ chev1 }}deg); transition: transform .15s;">${chev(0)}</span>
    </button>
    <div style="font-size: 13px; color: ${FG2}; line-height: 1.65; margin-top: 6px; padding-left: 28px;">38% of it lands between 2p and 4p</div>

    <sc-if value="{{ open1 }}" hint-placeholder-val="{{ false }}">
    <div style="padding: 6px 0 4px 28px;">
      <div class="tiles">
        <div class="tile"><div class="k">Clearing stalls</div><div class="v">{{ clearMoney }}</div><div class="n">210 stalls, counted from telemetry, at an assumed {{ minutes }} minutes of someone's time each</div></div>
        <div class="tile"><div class="k">Driving by hand</div><div class="v">$444.00</div><div class="n">18.5 hours with a person on the controls, measured directly, no assumption</div></div>
        <div class="tile"><div class="k">On top of the lease</div><div class="v">{{ totalMoney }}</div><div class="n">labour your invoice never shows, over the same period as every other figure here</div></div>
      </div>
      <div class="panel">
        <div class="varsent">210 stalls cleared by hand, about {{ clearHoursRound }} hours, plus 18.5 hours with someone driving the robot directly.</div>
        <div class="rob"><div class="top"><span class="nm">Scrubber 1 (nights)</span><span class="mk">driven by hand</span><span class="cov">$444.00</span></div><div class="fml">18.5 h driven by hand × $24.00/h</div></div>
        <div class="rob"><div class="top"><span class="nm">Picker 2 (Zone B)</span><span class="mk">142 stalls</span><span class="cov">{{ picker2Money }}</span></div><div class="fml">{{ picker2Hours }} h clearing × $24.00/h · robot itself stalled 19.4 h</div></div>
        <div class="rob"><div class="top"><span class="nm">Picker 5 (Zone A)</span><span class="mk">68 stalls</span><span class="cov">{{ picker5Money }}</span></div><div class="fml">{{ picker5Hours }} h clearing × $24.00/h · robot itself stalled 9.6 h</div></div>
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 14px 0 12px; border-top: 1px solid ${HAIR};">
          <span style="font-size: 12.5px; color: ${FG2};">Minutes of someone's time per stall</span>
          <span class="ctl"><button type="button" onClick="{{ decMinutes }}" aria-label="Fewer minutes">−</button><span class="val">{{ minutes }}</span><button type="button" onClick="{{ incMinutes }}" aria-label="More minutes">+</button></span>
          <span style="font-size: 11.5px; color: ${FG3};">assumed, not measured · moves the clearing figure and the total</span>
        </div>
      </div>

      <div class="h3">When they get stuck</div>
      <div class="panel" style="padding: 16px 18px 14px;">
        <div class="varsent" style="padding: 0 0 12px;">Your robots lost <b>31.0 hours</b> to stalls this period. Here is when.</div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12.5px;"><span style="font-weight: 600; color: ${FG1};">Order picking</span><span style="color: ${FG3}; font-variant-numeric: tabular-nums;">29.3 h lost</span></div>
        <div style="margin-top: 6px;">${strip1}</div>
        <div style="font-size: 13px; color: ${FG2}; line-height: 1.65; margin-top: 8px;"><b style="color: ${FG1}; font-weight: 600;">11.1 of them, 38%, fell between 2pm and 4pm</b>, which is only 17% of your working hours. In that window robots lost 4.4% of their working time to being stuck, against 1.9% across the day, so it is <b style="color: ${FG1}; font-weight: 600;">2.3 times worse than a normal hour</b>. That is the shift to go and watch.</div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12.5px; margin-top: 22px;"><span style="font-weight: 600; color: ${FG1};">Floor cleaning</span><span style="color: ${FG3}; font-variant-numeric: tabular-nums;">1.7 h lost</span></div>
        <div style="margin-top: 6px;">${strip2b}</div>
        <div style="font-size: 13px; color: ${FG2}; line-height: 1.65; margin-top: 8px;">Spread evenly across the night shift. No shift to go and watch here; if anything, this points at the machines or the routes.</div>
        <div class="legend">shaded band is the operating window · bracket marks the worst two hours · every strip shares one scale, tallest bar = ${f1(ceiling)}h</div>
      </div>
    </div>
    </sc-if>
  </div>

  <div style="border-left: 2px dashed ${FG1}; padding: 14px 0 14px 15px; margin-top: 8px; border-top: 1px solid ${HAIR};">
    <button type="button" class="rowbtn" onClick="{{ toggle2 }}">
      <span style="flex: none; width: 14px; font-family: ui-monospace, Menlo, 'SF Mono', monospace; font-size: 11px; color: ${FG3}; font-variant-numeric: tabular-nums;">2</span>
      <span style="flex: 1 1 auto; min-width: 0; font-size: 14.5px; font-weight: 700; color: ${FG1};">Try Locus on the Fetch routes</span>
      <span class="amt" style="margin-left: auto; font-size: 16px; font-weight: 700; color: ${FG1}; white-space: nowrap; font-variant-numeric: tabular-nums;">$2,533</span>
      <span class="shape" style="margin-left: 18px;">${mini2}</span>
      <span style="flex: none; display: inline-flex; align-items: center; transform: rotate({{ chev2 }}deg); transition: transform .15s;">${chev(0)}</span>
    </button>
    <div style="font-size: 13px; color: ${FG2}; line-height: 1.65; margin-top: 6px; padding-left: 28px;">if it is the machine, not the route</div>

    <sc-if value="{{ open2 }}" hint-placeholder-val="{{ false }}">
    <div style="padding: 6px 0 4px 28px;">
      <div class="panel">
        <div class="varsent">Your Locus machines do the same job for 44 cents per pick. Your Fetch machines cost 61 cents, 39% more.</div>
        <div class="rob"><div class="top"><span class="nm">Locus</span><span class="mk">6 robots</span><span class="cov">$0.44</span></div><div class="fml">41,200 picks started · 388 active hours · $18,128.00 of invoice · 2.61x coverage</div></div>
        <div class="rob"><div class="top"><span class="nm">Fetch</span><span class="mk">3 robots</span><span class="cov">$0.61</span></div><div class="fml">14,900 picks started · 152 active hours · $9,089.00 of invoice · 1.88x coverage</div></div>
        <div class="varfoot">Cost per pick is the same figure used everywhere else on this page, invoice divided by work performed, so a brand row can be checked against the robot rows it came from. At the volume your Fetch machines actually ran, that gap is worth about $2,533 over this period. Compared inside order picking only; floor cleaning runs one make, so it has no table.</div>
      </div>
    </div>
    </sc-if>
  </div>
  </sc-if>

  <sc-if value="{{ isQuiet }}" hint-placeholder-val="{{ false }}">
  <div style="border: 1px solid ${HAIR}; border-radius: 6px; padding: 22px 24px; margin-top: 34px;">
    <div style="font-size: 14.5px; font-weight: 700; color: ${FG1};">Nothing to chase this period.</div>
    <div style="font-size: 13.5px; color: ${FG2}; line-height: 1.65; margin-top: 6px; max-width: 64ch;">Your robots cost {{ totalMoney }} in staff time across 22 days, which is noise. The detail is still here if you want it.</div>
  </div>
  </sc-if>

  <div style="margin-top: 22px; display: flex; justify-content: flex-end;">
    <button type="button" onClick="{{ toggleHow }}" style="display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; padding: 10px 0; font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${FG2}; cursor: pointer;">how we count <span style="display: inline-flex; transform: rotate({{ chevHow }}deg); transition: transform .15s;">${chev(0)}</span></button>
  </div>

  <sc-if value="{{ openHow }}" hint-placeholder-val="{{ false }}">
  <div class="method" style="border-top: 1px solid ${HAIR}; padding-top: 18px; max-width: 78ch;">
    <p><b>Solid fill is measured. Hatched fill is estimated</b> from a stated assumption. Paired bars always compare money, and longer is more. A <b>solid left rule</b> is money already spent; a <b>dashed left rule</b> is money you only get if you act. Ink carries magnitude; there are no status colours anywhere.</p>
    <p><b>The stall count is measured. The minutes per stall are not.</b> They are our assumption about how long a person takes to notice, walk over, free the machine and walk back. Halve it and the clearing figure halves. The control sits next to the figure it changes.</p>
    <p><b>Stalled robot hours are shown and never billed as labour.</b> Your coverage figure already counts them as work the robot did not perform, and billing the same hours twice would flatter this page.</p>
    <p><b>Peaks are found inside one kind of work, never across the fleet.</b> A night scrubber scored against the day shift's picking peak would read as permanently idle. The share of running time inside the bracket is assumed rather than measured in this prototype.</p>
    <p><b>A brand gap is an observation, not an experiment.</b> Two brands in one fleet are rarely given the same routes, shifts or floors, so the gap only becomes a verdict on the machines once they have run the same work. Swapping them for a fortnight settles it. When a brand figure rests on a single machine, the row says so by name.</p>
    <p>Every figure shows its arithmetic so it can be checked on paper. Counts are mission starts reported by the robot, so they read as runs started. Work is valued at replacement rates, never at what an order was worth.</p>
  </div>
  </sc-if>

</div>
</div>
</x-dc>
<script data-dc-script data-props='{"openRow":{"editor":"enum","options":["none","1","2","how"],"default":"${openDefault}","section":"State"},"period":{"editor":"enum","options":["findings","quiet"],"default":"${periodDefault}","section":"State"},"$preview":{"width":1180,"height":640}}'>
class Component extends DCLogic {
  renderVals() {
    var s = this.state || {};
    var propOpen = this.props.openRow || "none";
    var open = s.open === undefined ? (propOpen === "none" ? null : propOpen) : s.open;
    var quiet = (this.props.period || "findings") === "quiet";
    var minutes = s.minutes === undefined ? 6 : s.minutes;
    var money = function (c) { return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var stalls = quiet ? 10 : 210, manualCents = quiet ? 3720 : 44400;
    var clearHours = stalls * minutes / 60;
    var clearCents = Math.round(clearHours * 2400);
    var totalCents = clearCents + manualCents;
    var leaseCents = 1670000, all = leaseCents + totalCents;
    var p2h = 142 * minutes / 60, p5h = 68 * minutes / 60;
    var self = this;
    var toggle = function (k) { return function () { self.setState({ open: open === k ? null : k }); }; };
    return {
      hasFindings: !quiet, isQuiet: quiet,
      open1: open === "1", open2: open === "2", openHow: open === "how",
      chev1: open === "1" ? 90 : 0, chev2: open === "2" ? 90 : 0, chevHow: open === "how" ? 90 : 0,
      toggle1: toggle("1"), toggle2: toggle("2"), toggleHow: toggle("how"),
      minutes: minutes,
      decMinutes: function () { self.setState({ minutes: Math.max(1, minutes - 1) }); },
      incMinutes: function () { self.setState({ minutes: Math.min(30, minutes + 1) }); },
      totalMoney: money(totalCents), clearMoney: money(clearCents), manualMoney: money(manualCents),
      clearHoursRound: Math.round(clearHours),
      picker2Money: money(Math.round(p2h * 2400)), picker2Hours: p2h.toFixed(1),
      picker5Money: money(Math.round(p5h * 2400)), picker5Hours: p5h.toFixed(1),
      leasePct: (100 * leaseCents / all).toFixed(2),
      manualPct: (100 * manualCents / all).toFixed(2),
      clearPct: (100 * clearCents / all).toFixed(2)
    };
  }
}
</script>
</body>
</html>
`;
}

writeFileSync("Main.dc.html", template({ openDefault: "none", periodDefault: "findings" }));
writeFileSync("Detail.dc.html", template({ openDefault: "1", periodDefault: "findings" }));
writeFileSync("Brands.dc.html", template({ openDefault: "2", periodDefault: "findings" }));
writeFileSync("Method.dc.html", template({ openDefault: "how", periodDefault: "findings" }));
writeFileSync("Quiet.dc.html", template({ openDefault: "none", periodDefault: "quiet" }));
writeFileSync("Phone.dc.html", template({ openDefault: "none", periodDefault: "findings" }));

const canvas = {
  artboards: [
    { file: "Main.dc.html", title: "Costs · default (56 words)", x: 0, y: 0, w: 1180, h: 640, is_interactive: true },
    { file: "Quiet.dc.html", title: "Costs · nothing to chase", x: 1260, y: 0, w: 1180, h: 520, is_interactive: true },
    { file: "Phone.dc.html", title: "Costs · phone", x: 2520, y: 0, w: 390, h: 844, is_interactive: true },
    { file: "Detail.dc.html", title: "Row 1 open · cost of keeping them running", x: 0, y: 1000, w: 1180, h: 1820, is_interactive: true },
    { file: "Brands.dc.html", title: "Row 2 open · brand against brand", x: 1260, y: 1000, w: 1180, h: 900, is_interactive: true },
    { file: "Method.dc.html", title: "How we count", x: 2520, y: 1000, w: 1180, h: 1020, is_interactive: true }
  ],
  annotations: [
    { id: "brief", x: 0, y: -170, w: 560, text: "Costs screen, v3 action queue. Default view is under 60 words; every sentence from the old screen survives one layer down. Solid left rule = cost already spent, dashed = upside if you act. Costs rank before opportunities regardless of size. Click a row or 'how we count' on any artboard to expand in place." }
  ],
  launch: { view: "canvas" }
};
writeFileSync("canvas.json", JSON.stringify(canvas, null, 2));
console.log("wrote 6 artboards + canvas.json; ceiling =", ceiling, "h; picking =", f1(sum(picking)), "cleaning =", f1(sum(cleaning)));
