// Alert emails: the rules on the dashboard's Alerts page, sent to the
// account's owner. Grouped so one event is one email:
// - A period closes: one "statement ready" email that also names the robots
//   under their lease for the period and any credit owed (three of the
//   page's rules).
// - Once a day: parts at or under 15% life, parts past their rating on a
//   robot that is still running, and duty time that collapsed (under 20% of
//   the scheduled hours for seven days running), bundled into one email.
// - A vendor sync that has been down for half an hour: one email, and none
//   again until it has recovered.
// "A promise is missed" (payback) goes in the daily email, once per robot,
// only when the contract's measured payback says so: every month since the
// lease began has data and the robot passed its promised month unpaid. With
// months before the data began, it cannot know, so it does not say.
//
// Every finding has a key, remembered once sent, so nothing repeats: a low
// part once until it is replaced, a past-rating part or a collapsed robot at
// most once a week, a close once. On an account's first run the periods
// already closed are marked as told, so switching alerts on never sends a
// burst of old statements. Nothing is emailed unless `send` is true
// (BOTLIEN_ALERTS_SEND=1); off, the job logs what it would have sent.
import { fleetContract, dateKey, KV_TZ } from "./contract.mjs";
import { activeMs } from "./finance.mjs";
import { onboardingStep } from "./owner.mjs";
import { renderEmail, fmtDown } from "./brief.mjs";
import { stopLink, KV_ALERTS_STOPPED } from "./brief-job.mjs";

export const KV_ALERTS_SENT = "alerts.sent"; // { key: at }
export const KV_ALERTS_LOG = "alerts.log"; // { page rule name: { at, summary } }
export const KV_ALERTS_DAILY = "alerts.daily"; // local date of the last daily check
const DEFAULT_TZ = "America/Los_Angeles";
const DAY_MS = 86_400_000;
const DAILY_AFTER_MIN = 7 * 60; // daily findings go out from 7 AM local
const DOWN_AFTER_MS = 30 * 60_000;
const PART_LOW_PCT = 15;
const PART_RESET_PCT = 50; // above this a part has been replaced
const DUTY_FLOOR = 0.2;

// The page's rule names, so the Alerts table can show when each last went out.
export const RULE = {
  under: "A robot falls under its lease",
  credit: "A credit is owed",
  statement: "Statement ready",
  low: "A consumable runs out",
  deferred: "Maintenance is being deferred",
  duty: "Duty time collapses",
  sync: "An import fails",
  payback: "A promise is missed",
};

const json = (store, key, fallback) => {
  try {
    return JSON.parse(store.getKV(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** ISO week, so "at most once a week" has a key. */
function weekKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function localMinute(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  return Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
}

/** The statement email for one newly closed period. */
export function closeFindings(contract, period) {
  const t = period.totals ?? {};
  const under = period.robots.filter((r) => r.coverage !== null && r.coverage < 1).sort((a, b) => a.coverage - b.coverage);
  const owed = period.robots.filter((r) => r.creditCents > 0).sort((a, b) => b.creditCents - a.creditCents);
  const blocks = [{
    title: "The period",
    items: [
      { text: `Coverage ${t.coverage == null ? "not worked out" : `${t.coverage.toFixed(2)}x`}`, sub: `work valued at ${money(t.workCents ?? 0)} against ${money(t.invoiceCents ?? 0)} of invoices, ${plural(t.robots ?? 0, "robot")}` },
      { text: `${plural(t.incidents ?? 0, "stop")}, ${fmtDown(t.downtimeMinutes ?? 0)} down`, sub: "" },
    ],
  }];
  if (under.length) blocks.push({ title: "Under their lease", items: under.map((r) => ({ text: r.name, sub: `${r.coverage.toFixed(2)}x, ${r.site}` })) });
  if (owed.length) blocks.push({ title: "Credit owed", items: owed.map((r) => ({ text: `${r.name}: ${money(r.creditCents)}`, sub: `${r.deliveredUptimePct}% delivered against the ${r.promisedUptimePct}% promised` })) });
  const rules = [RULE.statement, ...(under.length ? [RULE.under] : []), ...(owed.length ? [RULE.credit] : [])];
  return {
    key: `close:${period.start}`,
    rules,
    subject: `${period.label} is closed${owed.length ? `: ${money(owed.reduce((a, r) => a + r.creditCents, 0))} in credit owed` : under.length ? `: ${plural(under.length, "robot")} under lease` : ""}`,
    title: "Statement ready",
    subtitle: `${period.label}. These numbers are locked now.`,
    blocks,
    summary: `${period.label} closed`,
  };
}

/** The daily findings for one account, each with the key that stops it
 *  repeating. `sent` is what has gone out already. */
export function dailyFindings(store, contract, { nowMs, tz, sent }) {
  const today = dateKey(nowMs, tz);
  const week = weekKey(today);
  const out = [];
  const reset = [];
  const range = store.rollupTimeRange();
  const fresh = range && nowMs - range.maxAt < DAY_MS;
  const since7 = nowMs - 7 * DAY_MS;
  const rollups = fresh ? store.rollupsBetweenAll(since7, nowMs) : [];

  const money = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
  for (const p of contract.payback ?? []) {
    const key = `payback:${p.robotId}`;
    if (p.status !== "missed" || sent[key]) continue;
    const r = contract.robots.find((x) => x.id === p.robotId);
    out.push({ key, rule: RULE.payback, text: `${r?.name ?? "A robot"} passed its ${p.promisedMonths}-month payback without paying back`, sub: `${money(p.earnedCents)} earned of ${money(p.priceCents)} after ${p.monthsSinceStart} months${p.paceMonths ? `; at this pace it pays back in month ${p.paceMonths}` : ""}` });
  }
  for (const r of contract.robots) {
    const own = rollups.filter((x) => x.robot_id === r.id);
    const ranThisWeek = activeMs(own) > 0;
    for (const p of r.parts ?? []) {
      const base = `part:${r.id}:${p.name}`;
      if (p.remainingPct == null) continue;
      if (p.remainingPct > PART_RESET_PCT && sent[`${base}:low`]) reset.push(`${base}:low`);
      if (p.remainingPct <= 0 && ranThisWeek) {
        const key = `${base}:past:${week}`;
        if (!sent[key]) out.push({ key, rule: RULE.deferred, text: `${r.name}: ${p.name} is past its rated life`, sub: p.usedHours != null && p.lifeHours != null ? `${Math.round(p.usedHours - p.lifeHours)} h over, and the robot is still running` : "and the robot is still running" });
      } else if (p.remainingPct <= PART_LOW_PCT && p.remainingPct > 0 && !sent[`${base}:low`]) {
        out.push({ key: `${base}:low`, rule: RULE.low, text: `${r.name}: ${p.name} has ${Math.round(p.remainingPct)}% of its life left`, sub: p.usedHours != null && p.lifeHours != null ? `${Math.round(p.lifeHours - p.usedHours)} h to go` : "" });
      }
    }
    // Duty collapse: every one of the last seven days under a fifth of the
    // scheduled hours. Only when the feed itself is fresh, so a vendor outage
    // is not read as seven idle robots.
    // And only once the robot has its two-week baseline: before that a slow
    // first week reads as a collapse.
    const hoursDay = r.scheduledHoursDay;
    if (fresh && hoursDay > 0 && r.baselineReady) {
      let collapsed = true;
      for (let k = 1; k <= 7 && collapsed; k++) {
        const to = nowMs - (k - 1) * DAY_MS, from = to - DAY_MS;
        const day = own.filter((x) => x.bucket_start_at >= from && x.bucket_start_at < to);
        if (activeMs(day) >= DUTY_FLOOR * hoursDay * 3_600_000) collapsed = false;
      }
      const key = `duty:${r.id}:${week}`;
      if (collapsed && !sent[key]) out.push({ key, rule: RULE.duty, text: `${r.name} has run under ${Math.round(DUTY_FLOOR * hoursDay * 10) / 10} h a day all week`, sub: `a fifth of the ${hoursDay} h a day you scheduled` });
    }
  }
  return { findings: out, reset };
}

/** Vendor syncs down for half an hour, and ones that have recovered. */
export function syncFindings(control, accountId, { nowMs, sent }) {
  const out = [], reset = [];
  for (const c of control.connectionsForAccount(accountId)) {
    const key = `down:${c.vendor}`;
    const down = c.status === "active" && c.last_state === "down" && nowMs - (c.last_ok_at ?? c.created_at) >= DOWN_AFTER_MS;
    if (down && !sent[key]) out.push({ key, rule: RULE.sync, text: `${c.vendor} has not synced since ${c.last_ok_at ? new Date(c.last_ok_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "it was connected"}`, sub: c.last_error ?? "" });
    if (!down && sent[key]) reset.push(key);
  }
  return { findings: out, reset };
}

export function createAlertsJob({ control, tenants, mailer, vault, config = {}, baseUrl, send = false, log = () => {} }) {
  async function deliver(account, store, mail, keys, rules, summary, nowMs) {
    // Remembered before it goes, like the brief: a crash never sends twice.
    const sent = json(store, KV_ALERTS_SENT, {});
    for (const k of keys) sent[k] = nowMs;
    store.setKV(KV_ALERTS_SENT, JSON.stringify(sent));
    const stopUrl = stopLink(baseUrl, vault, account.id, account.email, "alerts");
    const body = renderEmail({ ...mail, appUrl: `${baseUrl}/app`, stopUrl, stopLabel: "Stop alert emails" });
    if (!send) {
      log(`alert (not sent, BOTLIEN_ALERTS_SEND is off) account ${account.id}: ${mail.subject}`);
      return;
    }
    const r = await mailer.send({ to: account.email, subject: mail.subject, text: body.text, html: body.html, headers: { "List-Unsubscribe": `<${stopUrl}>` } });
    if (!r.ok) {
      log(`account ${account.id} alert failed: ${r.error}`, "needs_user");
      return;
    }
    const logged = json(store, KV_ALERTS_LOG, {});
    for (const rule of rules) logged[rule] = { at: nowMs, summary };
    store.setKV(KV_ALERTS_LOG, JSON.stringify(logged));
  }

  return {
    async tick(nowMs) {
      const results = [];
      for (const account of control.listAccounts()) {
        try {
          const store = tenants.get(account.id);
          if (onboardingStep(store) !== "done") continue;
          if (store.getKV(KV_ALERTS_STOPPED)) continue;
          if (!vault?.ready) {
            results.push({ accountId: account.id, skip: "no secret to sign stop links" });
            continue;
          }
          const tz = store.getKV(KV_TZ) || config.owner?.tz || DEFAULT_TZ;
          const contract = fleetContract(store, nowMs, config);
          let sent = json(store, KV_ALERTS_SENT, null);

          // First run: what is already closed was never news to this owner.
          if (sent === null) {
            sent = {};
            for (const p of contract.periods) if (p.frozen) sent[`close:${p.start}`] = nowMs;
            store.setKV(KV_ALERTS_SENT, JSON.stringify(sent));
          }

          for (const p of contract.periods) {
            if (!p.frozen || sent[`close:${p.start}`]) continue;
            const f = closeFindings(contract, p);
            await deliver(account, store, f, [f.key], f.rules, f.summary, nowMs);
            results.push({ accountId: account.id, sent: f.key });
          }

          const sync = syncFindings(control, account.id, { nowMs, sent: json(store, KV_ALERTS_SENT, {}) });
          if (sync.reset.length) {
            const s = json(store, KV_ALERTS_SENT, {});
            for (const k of sync.reset) delete s[k];
            store.setKV(KV_ALERTS_SENT, JSON.stringify(s));
          }
          if (sync.findings.length) {
            await deliver(account, store, {
              subject: sync.findings.length === 1 ? `${sync.findings[0].text}` : `${plural(sync.findings.length, "robot feed")} stopped syncing`,
              title: "A robot feed stopped",
              subtitle: "Your dashboard is not getting new data from this vendor.",
              blocks: [{ title: "Not syncing", items: sync.findings.map((f) => ({ text: f.text, sub: f.sub })) }],
              footer: "Check the keys on Data sources. We will email again only after it has recovered and stopped again.",
            }, sync.findings.map((f) => f.key), [RULE.sync], sync.findings[0].text, nowMs);
            results.push({ accountId: account.id, sent: "sync" });
          }

          const today = dateKey(nowMs, tz);
          if (store.getKV(KV_ALERTS_DAILY) !== today && localMinute(nowMs, tz) >= DAILY_AFTER_MIN) {
            store.setKV(KV_ALERTS_DAILY, today);
            const daily = dailyFindings(store, contract, { nowMs, tz, sent: json(store, KV_ALERTS_SENT, {}) });
            if (daily.reset.length) {
              const s = json(store, KV_ALERTS_SENT, {});
              for (const k of daily.reset) delete s[k];
              store.setKV(KV_ALERTS_SENT, JSON.stringify(s));
            }
            if (daily.findings.length) {
              const groups = [
                ["Payback promises missed", RULE.payback],
                ["Parts past their rating", RULE.deferred],
                ["Parts running out", RULE.low],
                ["Duty time collapsed", RULE.duty],
              ].map(([title, rule]) => ({ title, rule, items: daily.findings.filter((f) => f.rule === rule) })).filter((g) => g.items.length);
              await deliver(account, store, {
                subject: daily.findings.length === 1 ? daily.findings[0].text : `${plural(daily.findings.length, "thing")} on your robots need a look`,
                title: "Needs a look",
                subtitle: today,
                blocks: groups.map((g) => ({ title: g.title, items: g.items.map((f) => ({ text: f.text, sub: f.sub })) })),
                footer: "Each of these is sent once: a part until it is replaced, the rest at most once a week.",
              }, daily.findings.map((f) => f.key), groups.map((g) => g.rule), `${plural(daily.findings.length, "finding")}`, nowMs);
              results.push({ accountId: account.id, sent: "daily" });
            }
          }
        } catch (err) {
          log(`account ${account.id} alerts failed: ${String(err?.message ?? err).slice(0, 200)}`, "warning");
          results.push({ accountId: account.id, error: String(err?.message ?? err) });
        }
      }
      return results;
    },
  };
}
