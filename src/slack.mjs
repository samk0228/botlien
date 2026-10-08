// Slack, for an account's stop alerts: where the bot token lives (sealed in
// the account's own store), the two Web API calls the job needs, the
// message blocks, and the signature check on what Slack sends back when
// someone presses a button. The bot only ever posts and edits its own
// messages; the scopes it needs are chat:write and chat:write.public.
import { createHmac, timingSafeEqual } from "node:crypto";

export class SlackError extends Error {}
export const KV_SLACK = "slack.settings"; // { channel, lead, manager, dollars, team, botUserId, connectedAt, sealed }
const API = process.env.BOTLIEN_SLACK_BASE ?? "https://slack.com/api";
const REPLAY_WINDOW_S = 5 * 60;

export function slackSettings(store) {
  try {
    const s = JSON.parse(store.getKV(KV_SLACK) || "null");
    return s && typeof s === "object" && s.sealed ? s : null;
  } catch {
    return null;
  }
}

/** The settings without the token, for the page. */
export function publicSlackSettings(store) {
  const s = slackSettings(store);
  if (!s) return null;
  const { sealed, ...rest } = s;
  return rest;
}

export function slackToken(store, vault) {
  const s = slackSettings(store);
  if (!s || !vault?.ready) return null;
  try {
    return vault.open(s.sealed).token ?? null;
  } catch {
    return null;
  }
}

const memberId = (v, label) => {
  const s = String(v ?? "").trim().replace(/^<@|>$/g, "");
  if (!s) return null;
  if (!/^[UW][A-Z0-9]{6,12}$/.test(s)) throw new SlackError(`${label} must be a Slack member ID (it starts with U). In Slack: their profile, the three dots, Copy member ID.`);
  return s;
};

/** Check the pasted token with Slack, then keep it sealed. Throws a
 *  SlackError, and saves nothing, when anything is off. */
export async function saveSlackSettings(store, vault, input, nowMs, { fetchImpl = fetch } = {}) {
  if (!vault?.ready) throw new SlackError("Saving a Slack token is switched off on this server until its encryption key is set.");
  const token = String(input?.botToken ?? "").trim();
  if (!/^xoxb-[A-Za-z0-9-]{20,}$/.test(token)) throw new SlackError("That is not a bot token. It starts with xoxb- and is under OAuth & Permissions in the Slack app.");
  const channel = String(input?.channel ?? "").trim().replace(/^#/, "");
  if (!channel || channel.length > 80) throw new SlackError("Name the channel the alerts go to.");
  const lead = memberId(input?.lead, "Lead");
  const manager = memberId(input?.manager, "Manager");
  const who = await createSlackClient({ token, fetchImpl }).call("auth.test", {});
  if (!who.ok) throw new SlackError(`Slack did not accept that token (${who.error ?? "no reason given"}).`);
  // A channel is shared, technicians included, so the owner says whether
  // alerts there carry a dollar line. On unless they say no.
  const dollars = input?.dollars !== false;
  const settings = { channel, lead, manager, dollars, team: who.team ?? null, botUserId: who.user_id ?? null, connectedAt: nowMs, sealed: vault.seal({ token }) };
  store.setKV(KV_SLACK, JSON.stringify(settings), nowMs);
  const { sealed, ...pub } = settings;
  return pub;
}

export function clearSlackSettings(store, nowMs) {
  const had = slackSettings(store) !== null;
  store.setKV(KV_SLACK, "", nowMs);
  return had;
}

/** The two calls the job makes, plus `call` for auth.test. Never throws:
 *  a failure is { ok: false, error }. */
export function createSlackClient({ token, fetchImpl = fetch, base = API }) {
  async function call(method, payload) {
    try {
      const res = await fetchImpl(`${base}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({ ok: false, error: `http ${res.status}` }));
      return json && typeof json === "object" ? json : { ok: false, error: "unreadable reply" };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err).slice(0, 120) };
    }
  }
  return {
    call,
    post: (channel, { text, blocks = null, threadTs = null, broadcast = false }) =>
      call("chat.postMessage", { channel, text, ...(blocks ? { blocks } : {}), ...(threadTs ? { thread_ts: threadTs, reply_broadcast: broadcast } : {}), unfurl_links: false }),
    update: (channel, ts, { text, blocks = [] }) => call("chat.update", { channel, ts, text, blocks }),
  };
}

export function signSlackRequest({ signingSecret, timestamp, body }) {
  return `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

/** Slack signs each request with the app's signing secret over the
 *  timestamp and the raw body. Older than five minutes is a replay. */
export function verifySlackSignature({ signingSecret, timestamp, signature, body, nowMs = Date.now() }) {
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > REPLAY_WINDOW_S) return false;
  const a = Buffer.from(signSlackRequest({ signingSecret, timestamp: String(timestamp), body: String(body ?? "") }));
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A button press, from the form-encoded `payload` Slack posts. */
export function parseInteraction(bodyText) {
  let p;
  try {
    p = JSON.parse(new URLSearchParams(String(bodyText ?? "")).get("payload") ?? "");
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const a = Array.isArray(p.actions) ? p.actions[0] : null;
  return {
    type: p.type ?? null,
    actionId: a?.action_id ?? null,
    value: a?.value ?? null,
    user: { id: p.user?.id ?? null, name: p.user?.username ?? p.user?.name ?? null },
    channel: p.channel?.id ?? null,
    ts: p.message?.ts ?? null,
  };
}

/** The notification text: what a phone shows, and what a client without
 *  blocks falls back to. */
export function incidentText(v) {
  return [v.headline, v.cause, v.downLine, v.outputLine, v.costLine, v.repeatsLine, v.claimLine].filter(Boolean).join(". ");
}

/** The message. `ref` ("<account>:<incident>") rides on the buttons so a
 *  press can be traced back to the record. Buttons only while the stop is
 *  open and unclaimed. */
export function incidentBlocks(v, ref) {
  const blocks = [{ type: "header", text: { type: "plain_text", text: `${v.open ? "🔴" : "🟢"} ${v.headline}`.slice(0, 150), emoji: true } }];
  const lines = [v.cause, v.downLine, v.outputLine, v.costLine, v.repeatsLine].filter(Boolean);
  if (lines.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
  if (v.claimLine) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: v.claimLine }] });
  if (v.open && !v.claimed) {
    const elements = [{ type: "button", action_id: "claim", text: { type: "plain_text", text: "I've got it" }, style: "primary", value: ref }];
    if (v.escalated < 2) elements.push({ type: "button", action_id: "escalate", text: { type: "plain_text", text: v.escalated === 1 ? "Escalate to the manager" : "Escalate to the lead" }, value: ref });
    blocks.push({ type: "actions", block_id: `incident:${ref}`, elements });
  }
  return blocks;
}
