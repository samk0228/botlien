// Binds the owner flow to whichever account is signed in.
//
// The callbacks below are the same ones index.mjs has always built, with one
// difference: the store is the caller's rather than the process's. That is the
// entire multi-tenant change at this layer. owner.mjs, importer.mjs, rates.mjs
// and finance.mjs are imported and called exactly as before and none of them
// knows an account exists.
//
// The six instrumentation events are fired here rather than in the router,
// because this is where we know both which account acted and whether the
// action actually succeeded. A `data_connected` recorded next to the route
// would count files that failed to parse.
import {
  ownerModel,
  parseSetupForm,
  confirmModel,
  parseConfirmForm,
  applyConfirm,
  recordImport,
  businessType,
  setBusinessType,
  onboardingStep,
} from "./owner.mjs";
import { importTelemetryFromText } from "./importer.mjs";
import { fleetContract, closePeriods } from "./contract.mjs";
import { verifyStop, stopBriefFor, KV_ALERTS_STOPPED } from "./brief-job.mjs";
import { connectVendor, describeConnections, VENDORS } from "./connections.mjs";
import { newApiKey, hashApiKey, pushEvents, MAX_KEYS } from "./push.mjs";
import { publicSlackSettings, saveSlackSettings, clearSlackSettings } from "./slack.mjs";
import { incidentOut } from "./incidents.mjs";
import { createAgentApi } from "./agent-api.mjs";
import { stopFeed, stopRecord, ackStop, fixStop, parseCursor } from "./stops.mjs";
import { rewind, stopReplay, replayStatus, advance, ReplayError } from "./replay.mjs";
import { saveInputs } from "./inputs.mjs";
import { addTicket, updateTicket } from "./tickets.mjs";
import { defaultWorkFor, BUSINESS_TYPES, BENCHMARKS, businessPreview } from "./rates.mjs";
import { normalizeEmail, MemberError } from "./control.mjs";
import { requestLink, validEmail } from "./auth.mjs";
import { inviteEmail } from "./mailer.mjs";
import { viewerSeesDollars, canManageTeam, redactDollars, INVITABLE } from "./roles.mjs";
import { onboardingState, onboardingV2Step, usesOnboardingV2, dollarRules, saveAccountStep, saveFloorStep, saveConnectStep, saveAlertsStep, finishOnboarding, OnboardingError } from "./onboarding.mjs";

/** Parse the operator allowlist from a comma-separated string or an array into
 * a normalized Set. The ops board shows the operator's own fleet, so only these
 * accounts may see it; everyone else, signed in or not, is turned away. An empty
 * allowlist denies everyone, which is the safe default: a forgotten env var
 * leaves the board closed rather than open to every customer. */
export function parseOpsEmails(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return new Set(list.map((e) => normalizeEmail(e)).filter(Boolean));
}

const DEFAULT_BUCKET_MS = 3_600_000;

function shortDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export class KeyError extends Error {}
export class TooManyAttempts extends Error {}
const PUSH_PER_MINUTE = 120;
// Every connect attempt runs the pasted keys against the vendor for real.
// Ten an hour is enough to fix a typo and too few to use us to try keys
// against somebody else's vendor account.
const CONNECT_PER_HOUR = 10;

export function createTenancy({
  control,
  mailer,
  tenants,
  config = {},
  now = () => Date.now(),
  baseUrl = "http://127.0.0.1:3230",
  secureCookies = false,
  readBody,
  opsEmails = process.env.BOTLIEN_OPS_EMAILS ?? "",
  // Accounts whose fleet a replay may wipe and refill. Never a customer's.
  demoEmails = process.env.BOTLIEN_DEMO_EMAILS ?? "",
  log = () => {},
  vault = null,
  fetchImpl = fetch,
}) {
  const opsSet = parseOpsEmails(opsEmails);
  const demoSet = parseOpsEmails(demoEmails);
  const pushHits = new Map(); // key id -> recent request times
  const connectHits = new Map(); // account id -> recent connect attempts
  /** Events with no account attached (`landed`) still belong in the funnel. */
  const onEvent = (name, { accountId = null, detail = null } = {}) => {
    try {
      control.recordEvent(name, { accountId, at: now(), detail });
    } catch (err) {
      // Instrumentation must never be able to break onboarding.
      log(`event ${name} rejected: ${String(err).slice(0, 120)}`);
    }
  };

  /** Fire an event at most once per account. `activated` in particular is
   * viewed every time the statement is reloaded, and counting each reload
   * would make the funnel's most important number meaningless. */
  const onceEvent = (accountId, name, detail = null) => {
    if (control.hasEvent(accountId, name)) return;
    onEvent(name, { accountId, detail });
  };

  const ctx = {
    control,
    mailer,
    baseUrl,
    secureCookies,
    now,
    readBody,
    /** Whether a signed-in account may see the ops board. */
    isOperator: (email) => opsSet.has(normalizeEmail(email)),
    /** Whether this signed-in viewer sees dollars on their account: their
     *  role, and who the owner said sees dollar figures. */
    dollarsFor: (account) => viewerSeesDollars(account.viewer ?? { email: account.email, role: "owner" }, dollarRules(tenants.get(account.id))),
    /** Whether an account is a demo account (BOTLIEN_DEMO_EMAILS). */
    isDemo: (email) => demoSet.has(normalizeEmail(email)),
    // Pass the whole payload through. An earlier version took (name, detail)
    // and wrapped it, which silently dropped accountId: `account_created` was
    // then stored unattached, funnel() could not join it to `activated`, and
    // the landed-to-activated ratio read as zero while every individual count
    // looked correct. Asserted by a test.
    onEvent,
    /** Robot status pushed with an API key. Returns { code, body }. */
    pushEvents: (key, body) => {
      if (!key) return { code: 401, body: { error: "Send your API key as: Authorization: Bearer blk_..." } };
      const found = control.apiKeyByHash(hashApiKey(key));
      if (!found) return { code: 401, body: { error: "That API key is not valid or was revoked." } };
      const nowMs = now();
      const recent = (pushHits.get(found.id) ?? []).filter((t) => nowMs - t < 60_000);
      if (recent.length >= PUSH_PER_MINUTE) return { code: 429, body: { error: `At most ${PUSH_PER_MINUTE} requests a minute per key. Batch up to 1000 events per request.` } };
      pushHits.set(found.id, [...recent, nowMs]);
      control.touchApiKey(found.id, nowMs);
      const out = pushEvents(tenants.get(found.account_id), body, nowMs, config);
      if (out.error) return { code: 400, body: out };
      if (out.accepted) onceEvent(found.account_id, "data_connected", { vendor: "push", robots: out.robots });
      return { code: 200, body: out };
    },
    /** Take one address off an account's morning brief, from the signed link
     *  in the email. False for a link this server did not sign. */
    stopBrief: (q) => {
      if (!verifyStop(vault, q)) return false;
      const account = control.accountById(Number(q.a));
      if (!account) return false;
      if (q.k === "alerts") tenants.get(account.id).setKV(KV_ALERTS_STOPPED, "1");
      else stopBriefFor(tenants.get(account.id), q.e);
      log(`account ${account.id}: ${q.e} stopped ${q.k === "alerts" ? "alert emails" : "the morning brief"}`);
      return true;
    },
  };

  function forAccount(account) {
    const store = tenants.get(account.id);
    // Who is looking. A session made before team members existed is the owner's.
    const viewer = account.viewer ?? { email: account.email, role: "owner" };
    // Everything this account hands out passes through here for a viewer who
    // may not see dollars. The router redacts JSON again on the way out.
    // Read each time: the owner can change who sees dollars at any moment.
    const forViewer = (data) => (viewerSeesDollars(viewer, dollarRules(store)) ? data : redactDollars(data));
    const bucketMs = config.engine?.rollup_bucket_ms ?? DEFAULT_BUCKET_MS;

    const getOwnerState = () => {
      const model = ownerModel(store, now(), config);
      // The activation moment: a statement on screen with a real ratio behind
      // it. Anything less is not activation, however far through the funnel
      // the owner got.
      //
      // The ratio lives on `totals`, not on the model root. Reading it from the
      // wrong place is silently always-undefined, which reads as "nobody ever
      // activated" rather than as an error, so this is asserted by a test.
      const coverage = model.totals?.coverage ?? null;
      if (model.step === "done" && coverage !== null) {
        onceEvent(account.id, "activated", { coverage });
      }
      return model;
    };

    const saveEconomics = (params) => {
      const { updates, errors } = parseSetupForm(params, store.listRobots());
      const nowMs = now();
      for (const u of updates) store.upsertRobotEconomics(u.robotId, u.econ, nowMs);
      if (updates.length > 0) {
        log(`account ${account.id}: economics updated for ${updates.length} robot(s)`);
        onceEvent(account.id, "numbers_saved", { robots: updates.length, rejected: errors.length });
      }
      if (errors.length > 0) {
        log(`account ${account.id}: setup rejected ${errors.map((e) => e.field).join(",")}`);
      }
    };

    const onboarding = {
      getBusiness: () => businessType(store),

      saveBusiness: (type) => setBusinessType(store, type),

      importText: (text, filename, { columns = null } = {}) => {
        const nowMs = now();
        let result;
        try {
          result = importTelemetryFromText(store, text, filename, {
            nowMs,
            bucketMs,
            category: defaultWorkFor(businessType(store)),
            columns,
          });
        } catch (err) {
          return { ok: false, message: `That file could not be parsed: ${String(err).slice(0, 120)}` };
        }
        if (result.imported === 0) {
          return {
            ok: false,
            message: "No usable rows. Every row needs a robot id and a timestamp. If your file names them differently, say which columns they are.",
            headers: result.headers,
          };
        }
        const range = store.snapshotTimeRange();
        recordImport(store, {
          filename,
          rows: result.rows,
          imported: result.imported,
          skipped: result.skipped,
          skipReasons: result.skipReasons,
          robots: result.robots.length,
          rangeLabel: range ? `${shortDate(range.minAt)} to ${longDate(range.maxAt)}` : null,
          at: nowMs,
        });
        log(`account ${account.id}: imported ${result.imported} rows, ${result.robots.length} robot(s)`);
        onceEvent(account.id, "data_connected", {
          rows: result.imported,
          robots: result.robots.length,
        });
        return { ok: true };
      },

      confirmState: () => confirmModel(store, now()),

      saveConfirm: (params) => {
        applyConfirm(store, parseConfirmForm(params, store.listRobots()), now());
        onceEvent(account.id, "fleet_confirmed", {});
      },
    };

    // The account's data sources ride along with its data, so the page can
    // say where every figure came from and whether the feed is healthy.
    const getFleetContract = () => {
      // Close any period that has ended before serving it, so a file-import
      // account with no sync loop still gets its statements frozen. Not
      // while the fleet is being set up: that would freeze benchmark invoices.
      if (onboardingStep(store) === "done") {
        const closed = closePeriods(store, now(), config);
        if (closed.length) log(`account ${account.id}: closed period(s) ${closed.join(", ")}`);
      }
      const contract = {
        ...fleetContract(store, now(), config),
        viewer,
        sources: [
          ...describeConnections(control, account.id, store),
          // Status pushed with an API key reads as a source once a key has been used.
          ...(() => {
            const used = control.apiKeysForAccount(account.id).filter((k) => k.last_used_at);
            if (!used.length) return [];
            const last = Math.max(...used.map((k) => k.last_used_at));
            const robots = store.listRobots().filter((r) => r.connector === "push").length;
            return [{ vendor: "push", label: "Your system", connected: true, status: "active", robotCount: robots, lastSyncAt: last, lastOkAt: last, state: now() - last < 3_600_000 ? "ok" : "down", error: null, push: true }];
          })(),
        ],
        setup: setupState(),
        // The owner, then everyone they invited.
        people: [
          { email: account.email, role: "Owner", since: account.created_at },
          ...control.listMembers(account.id).map((m) => ({ id: m.id, email: m.email, role: m.role === "manager" ? "Manager" : "Technician", since: m.created_at })),
        ],
      };
      // The activation moment, now that /app is home: the same rule the old
      // statement page used (numbers saved, a real ratio behind them), fired
      // once when the dashboard's data is first served with it.
      const coverage = contract.robots.find((r) => r.coverage !== null)?.coverage ?? null;
      if (onboardingStep(store) === "done" && coverage !== null && viewer.role === "owner") onceEvent(account.id, "activated", { coverage });
      return forViewer(contract);
    };

    const connections = {
      vendors: Object.keys(VENDORS),
      list: () => describeConnections(control, account.id, store),
      async connect(vendor, input) {
        const nowMs = now();
        const recent = (connectHits.get(account.id) ?? []).filter((t) => nowMs - t < 3_600_000);
        if (recent.length >= CONNECT_PER_HOUR) throw new TooManyAttempts(`${CONNECT_PER_HOUR} connection attempts an hour per account. Check the keys with the vendor and try again later.`);
        connectHits.set(account.id, [...recent, nowMs]);
        const out = await connectVendor({ control, vault: vault ?? { ready: false }, accountId: account.id, vendor, input, config, fetchImpl, now });
        log(`account ${account.id} connected ${vendor} (${out.robotCount} robots)`);
        // Connecting a vendor is the funnel's data step as much as an upload.
        onceEvent(account.id, "data_connected", { vendor, robots: out.robotCount });
        return out;
      },
      disconnect(vendor) {
        const gone = control.deleteConnection(account.id, vendor);
        if (gone) log(`account ${account.id} disconnected ${vendor}`);
        return gone;
      },
      // API keys for pushing robot status in (POST /api/v1/events).
      listKeys: () =>
        control.apiKeysForAccount(account.id).filter((k) => !k.revoked_at).map((k) => ({ id: k.id, prefix: k.prefix, label: k.label, createdAt: k.created_at, lastUsedAt: k.last_used_at })),
      /** A new key, returned in full this once and never again. */
      createKey(label) {
        if (connections.listKeys().length >= MAX_KEYS) throw new KeyError(`An account can have ${MAX_KEYS} keys. Revoke one first.`);
        const { key, prefix, keyHash } = newApiKey();
        const id = control.insertApiKey({ accountId: account.id, prefix, keyHash, label: String(label ?? "").trim().slice(0, 60) || null }, now());
        log(`account ${account.id} made API key ${prefix}…`);
        return { id, key, prefix };
      },
      revokeKey(id) {
        const gone = control.revokeApiKey(account.id, Number(id), now());
        if (gone) log(`account ${account.id} revoked API key ${id}`);
        return gone;
      },
    };
    const saveOwnerInputs = (changes) => saveInputs(store, changes, now(), viewer.email);
    // Vendor tickets the owner logs by hand (the Vendors tab reads them).
    const tickets = {
      add: (body) => addTicket(store, body, now()),
      update: (id, body) => updateTicket(store, id, body),
    };
    // Stop alerts in Slack: the channel and who to escalate to, with the bot
    // token sealed in the account's store, and the stops posted so far.
    const slack = {
      get: () => ({ slack: publicSlackSettings(store), incidents: store.listIncidents({ sinceMs: now() - 30 * 86_400_000, limit: 100 }).map(incidentOut) }),
      save: async (input) => {
        const out = await saveSlackSettings(store, vault ?? { ready: false }, input, now(), { fetchImpl });
        log(`account ${account.id} connected Slack (#${out.channel})`);
        return out;
      },
      disconnect: () => {
        const had = clearSlackSettings(store, now());
        if (had) log(`account ${account.id} disconnected Slack`);
        return had;
      },
    };
    // Where this account is in first run, read from its data. /app sends an
    // account that has no fleet yet to the step that gets it one.
    const step = () => onboardingStep(store);
    // Everything the first-run screens need, in one read.
    const setupState = () => {
      const c = confirmModel(store, now());
      const siteName = new Map(store.listSites().map((x) => [x.id, x.name]));
      const siteOf = new Map(store.listRobots().map((r) => [r.id, siteName.get(r.site_id) ?? null]));
      return {
        step: step(),
        business: businessType(store),
        businessTypes: Object.keys(BUSINESS_TYPES).map((k) => businessPreview(k)),
        robots: c.robots.map(({ id, name, brand, model, category, excluded, rangeLabel }) => ({ id, name, brand, model, category, excluded, seen: rangeLabel, site: siteOf.get(id) ?? null })),
        sites: store.listSites().map((x) => x.name),
        categories: c.categories.map((key) => ({ key, label: BENCHMARKS[key]?.label ?? key })),
        lastImport: c.lastImport,
        vendors: describeConnections(control, account.id, store),
      };
    };
    /** Name the sites and say which robot works where. Every robot named in
     *  `robots` must be on the account and every site must be in `sites`. */
    const saveSites = ({ sites = [], robots = {} } = {}) => {
      const names = [...new Set((Array.isArray(sites) ? sites : []).map((n) => String(n ?? "").trim()).filter(Boolean))];
      if (names.length === 0) throw new Error("Name at least one site.");
      if (names.some((n) => n.length > 80)) throw new Error("A site name is longer than 80 characters.");
      const known = new Set(store.listRobots().map((r) => String(r.id)));
      for (const [id, site] of Object.entries(robots)) {
        if (!known.has(String(id))) throw new Error(`Robot ${id} is not on this account.`);
        if (!names.includes(String(site))) throw new Error(`${site} is not one of the sites named.`);
      }
      store.transaction(() => {
        const ids = new Map(names.map((n) => [n, store.upsertSite(n, now())]));
        for (const [id, site] of Object.entries(robots)) store.setRobotSite(Number(id), ids.get(String(site)));
      });
      return setupState();
    };
    // The agents' read-only questions (line, stops, costs, history), from the
    // same contract the dashboard reads, with dollars out for a technician.
    const askAgent = createAgentApi({ store, config, now });
    const agent = {
      line: () => forViewer(askAgent.line()),
      stops: (q) => forViewer(askAgent.stops(q)),
      costs: () => forViewer(askAgent.costs()),
      history: (id, q) => forViewer(askAgent.history(id, q)),
    };
    // The team: the owner invites, changes roles and removes; anyone signed
    // in can see who is on it.
    const memberOut = (m) => ({ id: m.id, email: m.email, role: m.role, invitedBy: m.invited_by, since: m.created_at });
    const members = {
      list: () => ({ owner: account.email, viewer, members: control.listMembers(account.id).map(memberOut) }),
      async invite({ email, role } = {}) {
        if (!canManageTeam(viewer.role)) throw new MemberError("Only the owner can add people.");
        if (!INVITABLE.includes(role)) throw new MemberError("A role is manager or technician.");
        if (!validEmail(email)) throw new MemberError("That does not look like an email address.");
        // On the account first, so the link can only ever land here.
        const m = control.insertMember({ accountId: account.id, email, role, invitedBy: viewer.email }, now());
        const link = requestLink(control, m.email, now());
        const sent = link.ok ? await ctx.mailer.send({ to: m.email, ...inviteEmail({ url: `${baseUrl}/signin/${link.token}`, signinUrl: `${baseUrl}/signin`, invitedBy: account.email, role }) }) : { ok: false };
        log(`account ${account.id} added ${role} ${m.email}${sent.ok ? "" : " (invite email not sent)"}`);
        return { member: memberOut(m), emailed: Boolean(sent.ok) };
      },
      setRole(id, role) {
        if (!canManageTeam(viewer.role)) throw new MemberError("Only the owner can change roles.");
        const m = control.setMemberRole(account.id, Number(id), role);
        return m ? memberOut(m) : null;
      },
      remove(id) {
        if (!canManageTeam(viewer.role)) throw new MemberError("Only the owner can remove people.");
        const gone = control.removeMember(account.id, Number(id));
        if (gone) log(`account ${account.id} removed member ${id}`);
        return gone;
      },
    };
    // Stops in the dashboard: the feed the Stop Watcher polls, and the two
    // things a person does to a stop. Acknowledging and logging a fix are
    // open to every role; they are the technician's job.
    const stops = {
      // `epoch` changes when a replay is rewound, which starts the stop ids
      // again from 1: a dashboard that sees it change drops what it holds.
      feed: (since) => forViewer({ ...stopFeed(store, fleetContract(store, now(), config), now(), parseCursor(since)), epoch: replayStatus(store, now()).startedAt ?? null }),
      ack: (id, body) => {
        const inc = ackStop(store, id, body ?? {}, viewer.email, now());
        return forViewer(stopRecord(store, fleetContract(store, now(), config), inc, now()));
      },
      fix: (id, body) => {
        const inc = fixStop(store, id, body ?? {}, viewer.email, now());
        return forViewer(stopRecord(store, fleetContract(store, now(), config), inc, now()));
      },
    };
    // The replay, on a demo account only: rewind wipes the fleet.
    const isDemo = demoSet.has(normalizeEmail(account.email));
    const replay = {
      allowed: isDemo && viewer.role === "owner",
      status: () => ({ demo: isDemo, ...replayStatus(store, now()) }),
      control(action, body = {}) {
        if (!replay.allowed) throw new ReplayError("Replays run on a demo account only, by its owner.");
        if (action === "rewind") {
          const s = rewind(store, { recording: body.recording ?? "stop-story", speed: body.speed === undefined ? 1 : Number(body.speed), by: viewer.email }, now());
          advance(store, now(), config);
          log(`account ${account.id} rewound the ${s.recording} replay`);
          return replay.status();
        }
        if (action === "stop") {
          stopReplay(store, now());
          return replay.status();
        }
        throw new ReplayError("action is rewind or stop.");
      },
    };
    // The five-step first run. Only the owner answers it; everyone else
    // waits for it to be done.
    const ownerOnly = () => {
      if (viewer.role !== "owner") throw new OnboardingError("The account's owner sets this up.");
    };
    const onboardingV2 = {
      uses: () => usesOnboardingV2(store),
      step: () => onboardingV2Step(store),
      state: () => {
        const nowMs = now();
        const robots = store.listRobots().map((r) => ({ id: r.id, name: r.display_name ?? r.external_id, model: r.model }));
        return onboardingState(store, { email: viewer.email, demo: replay.allowed, robots, at: nowMs });
      },
      async save(step, body = {}) {
        ownerOnly();
        const nowMs = now();
        if (step === "account") saveAccountStep(store, body, nowMs);
        else if (step === "floor") saveFloorStep(store, body, nowMs);
        else if (step === "connect") {
          if (body.mode === "replay") {
            if (!replay.allowed) throw new OnboardingError("The recorded demo plays on a demo account only.");
            replay.control("rewind", { speed: Number(body.speed ?? 10) });
          }
          saveConnectStep(store, body, nowMs);
        } else if (step === "alerts") {
          saveAlertsStep(store, body, nowMs);
          // The lead they named is invited, as a technician: whether they
          // see dollars is the rule they just picked, not their role.
          const lead = String(body.leadEmail ?? "").trim().toLowerCase();
          if (lead && lead !== account.email && !control.memberByEmail(lead) && !control.accountByEmail(lead)) await members.invite({ email: lead, role: "technician" });
        } else if (step === "team") {
          finishOnboarding(store, nowMs);
          onceEvent(account.id, "fleet_confirmed", { onboarding: "v2" });
        } else throw new OnboardingError("No such step.");
        return onboardingV2.state();
      },
    };
    return { store, account, viewer, members, stops, replay, onboardingV2, getOwnerState, getFleetContract, saveEconomics, saveOwnerInputs, onboarding, connections, step, setupState, saveSites, tickets, slack, agent };
  }

  /** Release every SQLite handle this owns: each account's store plus the
   * control database. Called on SIGTERM so a deploy checkpoints WAL files
   * instead of leaving them for the next boot to recover. */
  const close = () => {
    tenants.closeAll();
    control.close();
  };

  return { ctx, forAccount, close };
}
