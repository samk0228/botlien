// What a technician sees at /app: the robots now and the last week's stops,
// with codes, causes and minutes. No dollar figure can appear, because the
// page is built only from the agents' answers after the role rules have run
// over them. The full dashboard leads with money on almost every screen, so a
// technician gets this until it has a view of its own.
import { esc } from "./board.mjs";

const STATE = { working: "Working", waiting: "Waiting", stopped: "Stopped", paused: "Paused", idle: "Idle", off: "Off", offline: "Offline", unknown: "No data yet" };

function when(ms, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

export function renderTechnicianHTML({ line, stops, viewer, owner, tz = "America/Los_Angeles" }) {
  const robots = line.robots
    .map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.model ?? "")}</td><td class="${r.state === "stopped" || r.state === "offline" ? "bad" : ""}">${esc(STATE[r.state] ?? r.state)}</td><td>${r.lagSeconds === null ? "" : r.live ? "live" : `${Math.round(r.lagSeconds / 60)} min ago`}</td></tr>`)
    .join("");
  const rows = stops.stops
    .map((s) => {
      const waiting = s.context.leftWaiting.map((w) => `${esc(w.name)} ${w.minutes} min`).join(", ");
      const jams = s.context.machineJamsBefore.map((j) => esc(j.station)).join(", ");
      return `<tr><td>${esc(when(s.startedAt, tz))}</td><td>${esc(s.robot.name)}</td><td>${esc(s.label)}${s.code ? ` <code>${esc(s.code)}</code>` : ""}${s.description ? `<div class="sub">${esc(s.description)}</div>` : ""}</td><td>${s.minutes.value} min${s.open ? " so far" : ""}${s.repeats > 1 ? `<div class="sub">${s.repeats} in a row</div>` : ""}</td><td>${waiting || ""}${jams ? `<div class="sub">Machine held the line just before: ${jams}</div>` : ""}</td><td>${s.claimedBy ? esc(s.claimedBy) : ""}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Botlien · Floor</title>
<style>
:root{--fg:#111;--fg2:#555;--line:#e5e5e5;--bg:#fff;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--fg2:#aaa;--line:#333;--bg:#141414;--bad:#f97066}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.sub{color:var(--fg2);font-size:13px}.bad{color:var(--bad);font-weight:600}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:13px;color:var(--fg2);font-weight:500}code{font-size:13px}
form{display:inline}button{font:inherit;background:none;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:4px 10px;cursor:pointer}
</style></head><body><main>
<h1>The floor</h1>
<p class="sub">Signed in as ${esc(viewer.email)}, technician on ${esc(owner)}'s account. Read only: Botlien never controls a robot. <form method="post" action="/signout"><button>Sign out</button></form></p>
<h2>Robots now</h2>
<div class="wrap"><table><thead><tr><th>Robot</th><th>Model</th><th>State</th><th>Last heard</th></tr></thead><tbody>${robots || `<tr><td colspan="4" class="sub">No robots yet.</td></tr>`}</tbody></table></div>
<h2>Stops, last 7 days</h2>
<div class="wrap"><table><thead><tr><th>Started</th><th>Robot</th><th>What it reported</th><th>Down</th><th>Left waiting</th><th>Claimed by</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="sub">No stops in the last 7 days.</td></tr>`}</tbody></table></div>
<p class="sub">What a stop left waiting is a pattern from the logged history, not a diagnosis.</p>
</main></body></html>`;
}
