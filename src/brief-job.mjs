// Sends each account's morning brief at the time and on the days its owner
// picked on the dashboard (Morning brief > Delivery, saved as briefSettings).
//
// Rules, each one a way a brief could go wrong:
// - At most once a day per account: today is marked sent BEFORE the emails go
//   out, so a crash mid-send can never send twice. Missing a day is better
//   than a duplicate.
// - Not more than LATE_LIMIT_MIN after the chosen time: a server that was
//   down at 5:30 does not send "before the floor opens" at 2 PM.
// - Not on stale data: an account whose data stops more than STALE_DAYS
//   before today (a file import from last month) gets no brief rather than a
//   confident one about last month.
// - Not while the fleet is still being set up.
// - Every email carries its own signed unsubscribe link, so no brief is sent
//   when the server has no secret to sign one with.
// - Nothing is sent at all unless `send` is true (BOTLIEN_BRIEF_SEND=1). Off,
//   the job logs what it would have sent.
import { buildBrief, briefEmail, briefRecipients } from "./brief.mjs";
import { fleetContract, closePeriods, dateKey, KV_TZ } from "./contract.mjs";
import { loadInputs } from "./inputs.mjs";
import { onboardingStep } from "./owner.mjs";

export const KV_BRIEF_SENT = "brief.last_sent";
export const KV_BRIEF_STOPPED = "brief.unsubscribed";
const LATE_LIMIT_MIN = 180;
const STALE_DAYS = 2;
const DEFAULT_TZ = "America/Los_Angeles";
const STOP_PURPOSE = "brief-stop";

/** "5:30 AM" -> 330. Null for anything else. */
export function parseBriefTime(s) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]) % 12 + (m[3].toUpperCase() === "PM" ? 12 : 0);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Local weekday (0 = Monday, as the page's day toggles run) and minute of day. */
export function localClock(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  const get = (t) => parts.find((p) => p.type === t).value;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { weekday, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function stoppedEmails(store) {
  try {
    const list = JSON.parse(store.getKV(KV_BRIEF_STOPPED) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Take an address off one account's brief. */
export function stopBriefFor(store, email) {
  const list = stoppedEmails(store);
  const e = String(email).trim().toLowerCase();
  if (!list.includes(e)) store.setKV(KV_BRIEF_STOPPED, JSON.stringify([...list, e]));
}

export function stopLink(baseUrl, vault, accountId, email) {
  const q = new URLSearchParams({ a: String(accountId), e: email, s: vault.sign(STOP_PURPOSE, `${accountId}:${email}`) });
  return `${baseUrl}/brief/stop?${q}`;
}

export function verifyStop(vault, { a, e, s }) {
  return Boolean(vault?.ready && a && e && vault.verify(STOP_PURPOSE, `${a}:${e}`, s));
}

/** What one account should get right now, or why it gets nothing. */
export function briefDue(store, nowMs, config = {}) {
  if (onboardingStep(store) !== "done") return { skip: "setting up" };
  const inputs = loadInputs(store);
  const settings = inputs.account.briefSettings;
  if (!settings) return { skip: "no brief set up" };
  const tz = store.getKV(KV_TZ) || config.owner?.tz || DEFAULT_TZ;
  const today = dateKey(nowMs, tz);
  if (store.getKV(KV_BRIEF_SENT) === today) return { skip: "already sent today" };
  const { weekday, minute } = localClock(nowMs, tz);
  if (!settings.days?.[weekday]) return { skip: "not a brief day" };
  const at = parseBriefTime(settings.time);
  if (at === null) return { skip: "no time set" };
  if (minute < at) return { skip: "not time yet" };
  if (minute > at + LATE_LIMIT_MIN) return { skip: "too late today" };
  const to = briefRecipients(settings, stoppedEmails(store));
  if (!to.length) return { skip: "no email recipients" };
  const contract = fleetContract(store, nowMs, config);
  const brief = buildBrief(contract, { inputs, siteFlags: settings.sites ?? [] });
  if (!brief) return { skip: "no robots to brief on" };
  const staleFrom = new Date(`${today}T00:00:00Z`);
  staleFrom.setUTCDate(staleFrom.getUTCDate() - STALE_DAYS);
  if (brief.throughKey < staleFrom.toISOString().slice(0, 10)) return { skip: `data stops ${brief.throughKey}` };
  return { today, to, brief, business: inputs.account.businessName ?? "" };
}

export function createBriefJob({ control, tenants, mailer, vault, config = {}, baseUrl, send = false, log = () => {} }) {
  return {
    async tick(nowMs) {
      const results = [];
      for (const account of control.listAccounts()) {
        let store;
        try {
          store = tenants.get(account.id);
          // Close any ended period first, so the brief reads frozen figures.
          if (onboardingStep(store) === "done") closePeriods(store, nowMs, config);
          const due = briefDue(store, nowMs, config);
          if (due.skip) {
            results.push({ accountId: account.id, skip: due.skip });
            continue;
          }
          if (!vault?.ready) {
            results.push({ accountId: account.id, skip: "no secret to sign unsubscribe links" });
            continue;
          }
          store.setKV(KV_BRIEF_SENT, due.today);
          let sent = 0;
          for (const to of due.to) {
            const unsubscribeUrl = stopLink(baseUrl, vault, account.id, to);
            const mail = briefEmail(due.brief, { appUrl: `${baseUrl}/app`, unsubscribeUrl, business: due.business });
            if (!send) {
              log(`brief (not sent, BOTLIEN_BRIEF_SEND is off) account ${account.id} to ${to}: ${mail.subject}`);
              continue;
            }
            const r = await mailer.send({ to, subject: mail.subject, text: mail.text, html: mail.html, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } });
            if (r.ok) sent++;
            else log(`account ${account.id} brief to ${to} failed: ${r.error}`, "needs_user");
          }
          control.recordEvent("brief_sent", { accountId: account.id, at: nowMs, detail: { date: due.today, recipients: due.to.length, sent, live: send } });
          results.push({ accountId: account.id, sent, to: due.to, live: send });
        } catch (err) {
          log(`account ${account.id} brief failed: ${String(err?.message ?? err).slice(0, 200)}`, "warning");
          results.push({ accountId: account.id, error: String(err?.message ?? err) });
        }
      }
      return results;
    },
  };
}
