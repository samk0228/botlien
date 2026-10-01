// Stop alerts in Slack, checked every half minute for every account that has
// connected a channel. Each tick brings every robot's incident record in
// line with its latest sample (incidents.mjs), then for each open stop:
// posts the alert once, keeps that one message up to date (down time, cost,
// who claimed it) rather than posting again, and escalates in a thread reply
// that mentions the lead after ten unclaimed minutes and the manager ten
// minutes after that. When the robot is back the same message turns green
// and its buttons go away. A button press comes back to handleInteraction
// with Slack's signature on it.
//
// Nothing is posted unless `send` is true (BOTLIEN_SLACK_SEND=1); off, the
// job logs what it would have posted, like the email jobs.
import { fleetContract, KV_TZ } from "./contract.mjs";
import { reconcile, incidentView, escalationDue, usualPace, ESCALATE_AFTER_MS } from "./incidents.mjs";
import { slackSettings, slackToken, createSlackClient, incidentBlocks, incidentText, verifySlackSignature, parseInteraction } from "./slack.mjs";

const DEFAULT_TZ = "America/Los_Angeles";
// An open stop's message is brought up to date at least this often.
export const REFRESH_MS = 5 * 60_000;

export function createSlackAlertsJob({ control, tenants, vault, config = {}, fetchImpl = fetch, send = false, signingSecret = null, log = () => {} }) {
  const ref = (accountId, id) => `${accountId}:${id}`;
  const mention = (id) => (id ? `<@${id}>` : null);

  function viewFor(store, inc, contract, settings, nowMs) {
    const robot = store.listRobots().find((r) => r.id === inc.robot_id) ?? null;
    const cr = contract.robots.find((r) => r.id === inc.robot_id) ?? null;
    const tz = store.getKV(KV_TZ) || config.owner?.tz || DEFAULT_TZ;
    const pace = cr?.baselineReady ? usualPace(store, inc.robot_id, nowMs) : null;
    return incidentView(inc, { robot, contractRobot: cr, tz, nowMs, lead: settings.lead, manager: settings.manager, pace });
  }

  /** Post the alert if it never went out, else bring it up to date. */
  async function render(client, store, account, inc, contract, settings, nowMs) {
    const v = viewFor(store, inc, contract, settings, nowMs);
    const text = incidentText(v);
    const blocks = incidentBlocks(v, ref(account.id, inc.id));
    if (!inc.message_ts) {
      if (inc.notified_at) return inc; // logged, never posted: nothing to edit
      if (!send) {
        log(`slack alert (not sent, BOTLIEN_SLACK_SEND is off) account ${account.id}: ${text}`);
        return store.updateIncident(inc.id, { notifiedAt: nowMs, renderedAt: nowMs }, nowMs);
      }
      const r = await client.post(settings.channel, { text, blocks });
      if (!r.ok) {
        log(`account ${account.id} slack post failed: ${r.error}`, "needs_user");
        return inc;
      }
      return store.updateIncident(inc.id, { channel: r.channel ?? settings.channel, messageTs: r.ts, notifiedAt: nowMs, renderedAt: nowMs }, nowMs);
    }
    const r = await client.update(inc.channel, inc.message_ts, { text, blocks });
    if (!r.ok) log(`account ${account.id} slack update failed: ${r.error}`, "warning");
    return store.updateIncident(inc.id, { renderedAt: nowMs }, nowMs);
  }

  /** Tell the lead (level 1) or the manager (level 2) in the thread, shown
   *  in the channel too so it is not missed. `who` names the person who
   *  pressed Escalate, when it was a press and not the clock. */
  async function escalate(client, store, account, inc, settings, nowMs, level, who = null) {
    const target = level === 1 ? settings.lead : settings.manager;
    const role = level === 1 ? "lead" : "manager";
    const updated = store.updateIncident(inc.id, { escalated: level, escalatedAt: nowMs }, nowMs);
    const text = target
      ? `${mention(target)} ${who ? `${who} escalated this to you.` : `nobody has claimed this in ${ESCALATE_AFTER_MS / 60_000} minutes.`}`
      : `${who ? `${who} escalated this` : `Nobody has claimed this in ${ESCALATE_AFTER_MS / 60_000} minutes`}, and no ${role} is set in Botlien's Slack settings.`;
    if (!send) log(`slack escalation (not sent) account ${account.id} incident ${inc.id}: ${text}`);
    else if (inc.message_ts) {
      const r = await client.post(inc.channel, { text, threadTs: inc.message_ts, broadcast: true });
      if (!r.ok) log(`account ${account.id} slack escalation failed: ${r.error}`, "warning");
    }
    log(`account ${account.id} incident ${inc.id} escalated to the ${role}${who ? ` by ${who}` : ""}`);
    return updated;
  }

  async function tick(nowMs) {
    const results = [];
    for (const account of control.listAccounts()) {
      try {
        const store = tenants.get(account.id);
        const settings = slackSettings(store);
        if (!settings) continue;
        const token = slackToken(store, vault);
        if (!token) {
          results.push({ accountId: account.id, skip: "no key to open the Slack token" });
          continue;
        }
        const client = createSlackClient({ token, fetchImpl });
        const changes = new Map();
        for (const robot of store.listRobots()) {
          const r = reconcile(store, robot, nowMs);
          if (r.change) changes.set(r.incident.id, r);
        }
        const open = store.openIncidents();
        const closed = [...changes.values()].filter((c) => c.change === "closed").map((c) => c.incident);
        if (open.length === 0 && closed.length === 0) continue;
        const contract = fleetContract(store, nowMs, config);
        for (const inc of closed) {
          if (inc.message_ts) await render(client, store, account, inc, contract, settings, nowMs);
          results.push({ accountId: account.id, incident: inc.id, change: "closed" });
        }
        for (let inc of open) {
          const change = changes.get(inc.id)?.change ?? null;
          const due = escalationDue(inc, nowMs);
          if (due) inc = await escalate(client, store, account, inc, settings, nowMs, due);
          const stale = inc.rendered_at != null && nowMs - inc.rendered_at >= REFRESH_MS;
          if (!inc.notified_at || change === "reopened" || due || stale) inc = await render(client, store, account, inc, contract, settings, nowMs);
          results.push({ accountId: account.id, incident: inc.id, change, escalated: due || undefined });
        }
      } catch (err) {
        log(`account ${account.id} slack alerts failed: ${String(err?.message ?? err).slice(0, 200)}`, "warning");
        results.push({ accountId: account.id, error: String(err?.message ?? err) });
      }
    }
    return results;
  }

  /** A button press. Slack must see a 200 within three seconds, so this
   *  does the one edit it needs and no more. */
  async function handleInteraction({ headers = {}, body = "" }, nowMs) {
    if (!signingSecret) return { code: 503, body: { error: "Slack buttons are not set up on this server (BOTLIEN_SLACK_SIGNING_SECRET)." } };
    const ok = verifySlackSignature({ signingSecret, timestamp: headers["x-slack-request-timestamp"], signature: headers["x-slack-signature"], body, nowMs });
    if (!ok) return { code: 401, body: { error: "That request was not signed by Slack." } };
    const i = parseInteraction(body);
    if (!i || i.type !== "block_actions" || !i.actionId) return { code: 200, body: {} };
    const m = /^(\d+):(\d+)$/.exec(String(i.value ?? ""));
    if (!m) return { code: 200, body: {} };
    const account = control.accountById(Number(m[1]));
    if (!account) return { code: 200, body: {} };
    const store = tenants.get(account.id);
    const inc = store.incident(Number(m[2]));
    const settings = slackSettings(store);
    if (!inc || inc.status !== "open" || !settings) return { code: 200, body: {} };
    const token = slackToken(store, vault);
    const client = token ? createSlackClient({ token, fetchImpl }) : null;
    const who = i.user.id ? `<@${i.user.id}>` : i.user.name ? `@${i.user.name}` : "someone";
    let updated = inc;
    if (i.actionId === "claim" && !inc.claimed_at) {
      updated = store.updateIncident(inc.id, { claimedBy: who, claimedAt: nowMs }, nowMs);
      log(`account ${account.id} incident ${inc.id} claimed by ${who}`);
    } else if (i.actionId === "escalate" && inc.escalated < 2 && client) {
      updated = await escalate(client, store, account, inc, settings, nowMs, inc.escalated + 1, who);
    }
    if (client && updated.message_ts) await render(client, store, account, updated, fleetContract(store, nowMs, config), settings, nowMs);
    return { code: 200, body: {} };
  }

  return { tick, handleInteraction };
}
