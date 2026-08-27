// OrionStar Open Platform connector. Same interface as sim, bear and gausium:
// { name, init, tick, stop }.
//
// Like Gausium this is a REST poller, so all lifecycle — token refresh, poll
// cadence, backoff — happens inside tick with no self-timers, which is what
// lets the whole thing be tested against a fake fetch on a fixed clock.
//
// Heartbeat semantics match bear.mjs and gausium.mjs: ok = authed and the last
// sweep read at least one robot; degraded = transient failures; down = auth
// rejected or too many consecutive failed sweeps.
//
// THREE THINGS ABOUT THIS VENDOR THAT THE OTHERS DO NOT DO:
//
// 1. Success is not HTTP status. Every response is HTTP 200 and carries a
//    `code` in the body, and the two families of endpoint disagree about what
//    success is: /v1/* returns code 0, /proxyopen/* returns code 200. Trusting
//    res.ok would treat an auth rejection as a fleet of zero robots.
//
// 2. Everything is a string. Battery is "85", flags are "0"/"1", timestamps are
//    epoch seconds as "1712046236". The 0/1-as-string flags are the dangerous
//    ones, since "0" is truthy; they are handled in normalizeOrionStarStatus.
//
// 3. Auth is IP-bound. The token endpoint requires the caller's egress IP to be
//    registered with OrionStar ("IP Dimension Authorization"). A deployment
//    without a stable outbound IP will authenticate from a laptop and fail in
//    production, which is a deployment constraint, not a code one.
//
// REGIONS. Four separate entry points, and a token is not portable across them.
// The default here is the US region because that is where the operators we sell
// to are; override with orionstar.base for EU (global-openapi), CN (openapi) or
// JP (jp-openapi).
import { normalizeOrionStarStatus } from "../normalize.mjs";

const MIN = 60_000;
const MAX_FAILURES_BEFORE_DOWN = 5;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 5 * MIN;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export const REGIONS = {
  us: "https://us-openapi.orionstar.com",
  eu: "https://global-openapi.orionstar.com",
  cn: "https://openapi.orionstar.com",
  jp: "https://jp-openapi.orionstar.com",
};

/* CarryBot is the warehouse AMR, LuckiBot and its variants are hospitality.
 * The model prefix decides how the work is priced, and getting it wrong is not
 * a cosmetic error: a delivery run is priced per mission against a server's
 * wage, and warehouse handling is priced per move against a picker's. Models we
 * do not recognise return null so onboarding asks rather than assumes. */
export function categoryForModel(model) {
  if (!model) return null;
  const m = String(model).toUpperCase();
  if (m.includes("CARRY") || m.startsWith("OS-R-D100") || m.includes("D100")) return "putaway";
  if (m.includes("DR0") || m.includes("LUCKI") || m.includes("ZCB")) return "delivery";
  return null;
}

export function createOrionStarConnector(cfg, secrets, deps = {}) {
  const { log = () => {}, fetchImpl = fetch } = deps;
  const base = cfg.base ?? REGIONS[cfg.region ?? "us"] ?? REGIONS.us;
  const refreshMarginMs = (cfg.token_refresh_margin_min ?? 5) * MIN;
  const pollMs = (cfg.poll_sec ?? 60) * 1000;
  const corpId = cfg.ov_corpid ?? secrets.ov_corpid ?? null;

  let token = null;
  let tokenExpMs = null;
  let authFailed = false;
  let robots = [];
  let failures = 0;
  let nextPollMs = 0;

  /* OrionStar answers HTTP 200 with a body-level code on failure, including for
   * auth. Every read goes through here so a rejected token can never be
   * mistaken for an empty fleet. */
  function unwrap(body, path) {
    const code = Number(body?.code);
    const ok = path.startsWith("/proxyopen/") ? code === 200 : code === 0;
    if (!ok) {
      const err = new Error(`${path} → code ${body?.code}: ${body?.msg || "no message"}`);
      err.vendorCode = code;
      throw err;
    }
    return body.data ?? {};
  }

  async function authenticate(nowMs) {
    const url = new URL(base + "/v1/auth/get_token");
    url.searchParams.set("app_id", secrets.app_id ?? "");
    url.searchParams.set("app_secret", secrets.app_secret ?? "");
    const res = await fetchImpl(url.toString(), { method: "GET" });
    if (!res.ok) {
      authFailed = true;
      throw new Error(`OrionStar auth rejected: HTTP ${res.status}`);
    }
    const body = await res.json();
    let data;
    try {
      data = unwrap(body, "/v1/auth/get_token");
    } catch (err) {
      // A body-level rejection on the token endpoint is an auth failure, not a
      // transient one. Retrying a bad secret every minute forever is noise.
      authFailed = true;
      throw err;
    }
    token = data.access_token ?? null;
    if (!token) {
      authFailed = true;
      throw new Error("OrionStar auth response had no access_token");
    }
    authFailed = false;
    // expires_in is documented as a duration in seconds and arrives as a
    // string. Guard the absolute-epoch case anyway: Gausium documents a
    // duration and returns an epoch, so the assumption is worth defending.
    const raw = Number(data.expires_in);
    tokenExpMs = raw > 1e12 ? raw : nowMs + (Number.isFinite(raw) && raw > 0 ? raw : 3600) * 1000;
  }

  async function ensureToken(nowMs) {
    if (token && nowMs < tokenExpMs - refreshMarginMs) return;
    await authenticate(nowMs);
  }

  async function apiGet(path, params = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return unwrap(await res.json(), path);
  }

  async function listRobots() {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await apiGet("/v1/robot/robot_list", {
        ov_corpid: corpId,
        page,
        page_size: PAGE_SIZE,
      });
      const batch = data.list ?? data.robots ?? [];
      all.push(...batch);
      const total = Number(data.total ?? 0);
      if (batch.length < PAGE_SIZE || (total && all.length >= total)) break;
    }
    return all;
  }

  return {
    name: "orionstar",

    async init() {
      try {
        await ensureToken(Date.now());
        robots = await listRobots();
      } catch (err) {
        log(`orionstar init failed (will retry from tick): ${String(err).slice(0, 150)}`, "warning");
      }
      return robots.map((r) => ({
        externalId: r.robot_sn,
        displayName: r.robot_name || r.robot_sn,
        brand: "OrionStar",
        model: r.robot_model ?? null,
        // Null when the model is unrecognised, so the owner is asked what kind
        // of work it does rather than having a wage silently assumed for it.
        category: categoryForModel(r.robot_model),
      }));
    },

    async tick(nowMs) {
      if (nowMs < nextPollMs) {
        return { events: [], heartbeat: healthy(failures, robots.length) };
      }

      try {
        await ensureToken(nowMs);
      } catch (err) {
        nextPollMs = nowMs + backoff(++failures);
        return { events: [], heartbeat: { state: "down", detail: String(err).slice(0, 200) } };
      }

      // Re-list on the first successful poll, and whenever the fleet emptied —
      // a robot added to the account mid-run should appear without a restart.
      if (robots.length === 0) {
        try {
          robots = await listRobots();
        } catch (err) {
          log(`orionstar robot list failed: ${String(err).slice(0, 150)}`, "warning");
        }
      }

      const events = [];
      let readFailures = 0;
      for (const r of robots) {
        try {
          // is_report_status=1 is what turns this from a registry lookup into a
          // status read. Without it the response carries no battery, task or
          // location at all, and every event would be an empty shell.
          const data = await apiGet("/v1/robot/robot_info", {
            robot_sn: r.robot_sn,
            is_report_status: 1,
          });
          const normalized = normalizeOrionStarStatus(data, { at: nowMs });
          events.push({ externalId: normalized.externalId, at: normalized.at, raw: data, status: normalized });
        } catch (err) {
          readFailures += 1;
          log(`orionstar status ${r.robot_sn}: ${String(err).slice(0, 120)}`, "warning");
        }
      }

      nextPollMs = nowMs + pollMs;

      // A sweep counts as failed only if every robot failed. One unreachable
      // robot out of ten is a robot problem, not a pipe problem, and the
      // offline_duration rule is gated on the pipe being healthy.
      if (robots.length > 0 && readFailures === robots.length) {
        nextPollMs = nowMs + backoff(++failures);
      } else {
        failures = 0;
      }
      return { events, heartbeat: healthy(failures, robots.length) };
    },

    async stop() {
      token = null;
    },
  };

  function healthy(f, robotCount) {
    if (authFailed) return { state: "down", detail: "auth rejected" };
    if (f === 0) {
      return robotCount === 0
        ? { state: "degraded", detail: "authed but no robots on this enterprise" }
        : { state: "ok", detail: null };
    }
    return f >= MAX_FAILURES_BEFORE_DOWN
      ? { state: "down", detail: `${f} consecutive failed sweeps` }
      : { state: "degraded", detail: `${f} failed sweep(s)` };
  }
}

function backoff(n) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1));
}
