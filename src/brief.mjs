// The morning brief, as an email. The dashboard's "Before the floor opens"
// card builds the same brief in the browser from the same data contract; this
// is the server's copy of those rules (briefData/briefBlocks in the page), so
// the brief can go out at 5:30 AM when nobody has the dashboard open.
//
// Kept in step with the page on purpose, with two deliberate differences:
// - Credit is only mentioned where the owner entered a lease with an uptime
//   promise. The page falls back to an assumed 95%; an email that says money
//   is owed should not rest on an assumption.
// - A part with no reported life left is not listed as one to order.
// The browser sweep compares the two on the same account.

export const RESPONSE_HOURS = { Locus: 24, Gausium: 48, Fetch: 24 };
const DEFAULT_RESPONSE_HOURS = 24;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MAX_RECIPIENTS = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
export function fmtDown(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} m`;
  return `${h} h${m ? ` ${m} m` : ""}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const brandOf = (r) => r.brand || String(r.model || "").split(" ")[0] || "Unknown";
const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Where a stall happened, named the way the dashboard names it. */
export function placeOf(d) {
  if (d.place) return d.place;
  if (d.pose) return `near ${Math.round(d.pose.x / 2) * 2}, ${Math.round(d.pose.y / 2) * 2} m`;
  return "";
}

/** Recipients the brief may go to: email addresses only (no text messages
 *  yet), at most MAX_RECIPIENTS, none that unsubscribed. */
export function briefRecipients(settings, unsubscribed = []) {
  const off = new Set(unsubscribed.map((e) => e.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const raw of settings?.to ?? []) {
    const e = String(raw ?? "").trim().toLowerCase();
    if (!EMAIL.test(e) || off.has(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length === MAX_RECIPIENTS) break;
  }
  return out;
}

/** The brief for one account, from its data contract and saved inputs.
 *  `siteFlags` is the brief's site toggles in contract site order (missing
 *  means on). Returns null when there is no fleet to brief on. */
export function buildBrief(contract, { inputs = { account: {}, robots: {} }, siteFlags = [] } = {}) {
  const c = contract;
  if (!c?.robots?.length) return null;
  const siteIdx = new Map(c.sites.map((s, i) => [s.id, i]));
  const onSite = (i) => siteFlags[i] === undefined || Boolean(siteFlags[i]);
  const sitesOn = c.sites.filter((_, i) => onSite(i));
  const multi = sitesOn.length > 1;
  const excluded = inputs.robots?.excluded ?? {};
  const robots = c.robots.filter((r) => onSite(siteIdx.get(r.siteId) ?? 0) && !excluded[r.id]);
  if (!robots.length) return null;
  const ids = new Set(robots.map((r) => r.id));
  const siteName = (r) => c.sites[siteIdx.get(r.siteId) ?? 0]?.name ?? "";
  const siteOf = (r) => (multi ? `, ${siteName(r)}` : "");
  const open = c.periods[0];
  const down = c.downtime.filter((d) => ids.has(d.robotId));
  const byId = new Map(robots.map((r) => [r.id, r]));

  // The last day the data holds, and the seven days up to it.
  const lastKey = down.reduce((m, d) => (d.date > m ? d.date : m), "") || open.end;
  const last7 = new Set(Array.from({ length: 7 }, (_, k) => addDaysKey(lastKey, -k)));
  const briefKey = addDaysKey(lastKey, 1);
  const dow = new Date(`${briefKey}T00:00:00Z`).getUTCDay();

  // Watch today: the robot under its lease with the most time down this week.
  const watch = robots
    .filter((r) => r.coverage !== null && r.coverage < 1)
    .map((r) => {
      const d = down.filter((x) => x.robotId === r.id && last7.has(x.date));
      return { r, mins: d.reduce((a, x) => a + x.minutes, 0), stuck: d.filter((x) => x.kind === "stuck").length };
    })
    .sort((a, b) => b.mins - a.mins)[0] ?? null;

  // Where they got stuck this week, by site and place.
  const fixes = inputs.account?.fixes ?? {};
  const fixKey = (r, place) => `${slug(siteName(r))}:${place}`;
  const spotMap = new Map();
  for (const x of down) {
    if (x.kind !== "stuck" || !last7.has(x.date)) continue;
    const r = byId.get(x.robotId), place = placeOf(x);
    if (!place) continue;
    const k = `${siteName(r)}|${place}`;
    const e = spotMap.get(k) ?? { r, place, n: 0, mins: 0 };
    e.n++;
    e.mins += x.minutes;
    spotMap.set(k, e);
  }
  const spots = [...spotMap.values()].sort((a, b) => b.n - a.n || b.mins - a.mins).slice(0, 3);

  // Parts to order: under a quarter of their life left.
  const parts = [];
  for (const r of robots) {
    const perDay = open.days > 0 ? (r.activeHours ?? 0) / open.days : 0;
    for (const p of r.parts ?? []) {
      if (p.remainingPct == null || p.remainingPct >= 25) continue;
      const left = p.usedHours != null && p.lifeHours != null ? p.lifeHours - p.usedHours : null;
      parts.push({ r, p, left, days: left != null && perDay > 0 ? left / perDay : null });
    }
  }
  parts.sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  const silent = [...new Set(robots.filter((r) => !r.parts?.length).map(brandOf))];

  // Money waiting on a vendor: credit owed this period and not claimed, and
  // tickets past the vendor's response time.
  const claims = inputs.account?.claims ?? {};
  const rowOf = new Map(robots.map((r, i) => [r.id, c.robots.indexOf(r)]));
  const credits = (open.robots ?? [])
    .filter((f) => ids.has(f.robotId) && f.creditCents > 0 && (claims[rowOf.get(f.robotId)] ?? "not claimed") === "not claimed")
    .map((f) => ({ r: byId.get(f.robotId), cents: f.creditCents }));
  const nowMs = c.asOf;
  const tickets = c.tickets
    .filter((t) => ids.has(t.robotId) && t.status === "open" && !t.respondedAt)
    .map((t) => ({ t, waited: (nowMs - t.openedAt) / 3.6e6 }))
    .filter((x) => x.waited > (RESPONSE_HOURS[x.t.brand] ?? DEFAULT_RESPONSE_HOURS));

  // One thing to do: the open spot with the most time lost this period.
  const fixMap = new Map();
  for (const x of down) {
    if (x.kind !== "stuck") continue;
    const r = byId.get(x.robotId), place = placeOf(x);
    if (!place) continue;
    const k = `${siteName(r)}|${place}`;
    const e = fixMap.get(k) ?? { r, place, times: 0, mins: 0, robots: new Set() };
    e.times++;
    e.mins += x.minutes;
    e.robots.add(x.robotId);
    fixMap.set(k, e);
  }
  const fix = [...fixMap.values()]
    .map((e) => ({ ...e, status: fixes[fixKey(e.r, e.place)]?.status ?? "open" }))
    .sort((a, b) => b.mins - a.mins)
    .find((e) => e.status !== "done") ?? null;

  const blocks = [];
  if (watch) {
    blocks.push({ id: "watch", title: "Watch today", items: [{
      text: `${watch.r.name}${siteOf(watch.r)}`,
      sub: `under its lease at ${watch.r.coverage.toFixed(2)}x, stuck ${plural(watch.stuck, "time")} in the last 7 days, ${fmtDown(watch.mins)} down`,
    }] });
  }
  if (spots.length) {
    blocks.push({ id: "spots", title: "Where they got stuck", items: spots.map((s) => {
      const fx = fixes[fixKey(s.r, s.place)];
      return { text: `${capFirst(s.place)}${siteOf(s.r)}`, sub: `${plural(s.n, "stall")}, ${fmtDown(s.mins)} down${fx?.status === "in progress" ? " · fix in progress" : ""}` };
    }) });
  }
  if (parts.length) {
    blocks.push({ id: "parts", title: "Parts to order", items: parts.map((x) => ({
      text: `${x.r.name}: ${x.p.name}`,
      sub: x.left == null ? `${Math.round(x.p.remainingPct)}% left` : x.left <= 0 ? `past its rating by ${Math.round(-x.left)} h` : `${Math.round(x.left)} h left, about ${Math.max(1, Math.round(x.days ?? 0))} days at the current rate`,
    })) });
  } else if (silent.length) {
    blocks.push({ id: "parts", title: "Parts to order", items: [{ text: `${silent.join(", ")} ${silent.length === 1 ? "does" : "do"} not send wear data.`, sub: "" }] });
  }
  if (credits.length || tickets.length) {
    blocks.push({ id: "money", title: "Money waiting on a vendor", items: [
      ...credits.map((x) => ({ text: `Credit owed for ${x.r.name}`, sub: `${brandOf(x.r)}, not claimed yet: ${money(x.cents)} so far this period` })),
      ...tickets.map((x) => ({ text: `${x.t.ref ?? `T-${x.t.id}`} with ${x.t.brand}`, sub: `${x.t.title}, ${Math.round(x.waited)} h waited, past the ${RESPONSE_HOURS[x.t.brand] ?? DEFAULT_RESPONSE_HOURS}-hour response time` })),
    ] });
  }
  if (fix) {
    const who = fix.robots.size === 1 ? fix.r.name : `${fix.robots.size} robots`;
    blocks.push({ id: "fix", title: "One thing to do", items: [{
      // An unnamed spot already reads "near x, y m".
      text: `Clear the path ${fix.place.startsWith("near ") ? "" : "at "}${fix.place}${siteOf(fix.r)}. It stopped ${who} ${plural(fix.times, "time")} this period.`,
      sub: fix.status === "in progress" ? "fix in progress" : "",
    }] });
  }

  return {
    dateKey: briefKey,
    dateLabel: `${DAY_NAMES[dow]}, ${shortDate(briefKey)}, before first shift`,
    throughKey: lastKey,
    sites: sitesOn.map((s) => s.name),
    blocks,
    // The fields the parity check compares with the page's own briefData().
    parity: {
      watch: watch ? { robotId: watch.r.id, mins: watch.mins, stuck: watch.stuck } : null,
      spots: spots.map((s) => ({ place: s.place, n: s.n, mins: s.mins })),
      fix: fix ? { place: fix.place, times: fix.times } : null,
    },
  };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/** One Botlien email: a title, a subtitle, titled blocks of items, a button
 *  to the dashboard and a stop link. Text and HTML from the same content. */
export function renderEmail({ title, subtitle = "", blocks = [], empty = "", appUrl, stopUrl, stopLabel = "Stop these emails", footer = "", cta = "Open the dashboard" }) {
  const text = [
    `Botlien: ${title}${subtitle ? `, ${subtitle}` : ""}`,
    "",
    ...(blocks.length
      ? blocks.flatMap((b) => [b.title.toUpperCase(), ...b.items.map((i) => `- ${i.text}${i.sub ? ` (${i.sub})` : ""}`), ""])
      : [empty, ""]),
    `${cta}: ${appUrl}`,
    ...(footer ? [footer] : []),
    `${stopLabel}: ${stopUrl}`,
  ].join("\n");
  const block = (b) =>
    `<div style="margin:18px 0 0"><div style="font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#6b6b6b">${escHtml(b.title)}</div>` +
    b.items.map((i) => `<div style="padding:8px 0;border-bottom:1px solid #eee"><div style="font-size:14px;color:#111">${escHtml(i.text)}</div>${i.sub ? `<div style="font-size:13px;color:#555;margin-top:2px">${escHtml(i.sub)}</div>` : ""}</div>`).join("") +
    `</div>`;
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e4dc;border-radius:8px;padding:24px 28px">` +
    `<div style="font-size:17px;font-weight:600;color:#111">${escHtml(title)}</div>` +
    (subtitle ? `<div style="font-size:13px;color:#6b6b6b;margin-top:4px">${escHtml(subtitle)}</div>` : "") +
    (blocks.length ? blocks.map(block).join("") : `<p style="font-size:14px;color:#333;margin:18px 0 0">${escHtml(empty)}</p>`) +
    `<div style="margin-top:22px"><a href="${escHtml(appUrl)}" style="display:inline-block;background:#3760C9;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px">${escHtml(cta)}</a></div>` +
    `<div style="font-size:12px;color:#888;margin-top:18px;line-height:1.6">${footer ? `${escHtml(footer)} ` : ""}<a href="${escHtml(stopUrl)}" style="color:#888">${escHtml(stopLabel)}</a>.</div>` +
    `</div></body></html>`;
  return { text, html };
}

/** Subject, plain text and HTML for one recipient. */
export function briefEmail(brief, { appUrl, unsubscribeUrl, business = "" }) {
  const subject = `${business ? `${business}: ` : ""}before the floor opens, ${brief.dateLabel.split(",").slice(0, 2).join(",")}`;
  const body = renderEmail({
    title: "Before the floor opens",
    subtitle: `${brief.dateLabel}${brief.sites.length > 1 ? ` · ${brief.sites.join(", ")}` : ""}`,
    blocks: brief.blocks,
    empty: "Nothing to flag. No robot is under its lease with time down this week, and no stall spot, part or vendor needs you.",
    appUrl,
    stopUrl: unsubscribeUrl,
    footer: `Built from your robots' data through ${shortDate(brief.throughKey)}.`,
  });
  return { subject, ...body };
}
