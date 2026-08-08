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
} from "./owner.mjs";
import { importTelemetryFromText } from "./importer.mjs";
import { defaultWorkFor } from "./rates.mjs";

const DEFAULT_BUCKET_MS = 3_600_000;

function shortDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function createTenancy({
  control,
  mailer,
  tenants,
  config = {},
  now = () => Date.now(),
  baseUrl = "http://127.0.0.1:3230",
  secureCookies = false,
  readBody,
  log = () => {},
}) {
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
    // Pass the whole payload through. An earlier version took (name, detail)
    // and wrapped it, which silently dropped accountId: `account_created` was
    // then stored unattached, funnel() could not join it to `activated`, and
    // the landed-to-activated ratio read as zero while every individual count
    // looked correct. Asserted by a test.
    onEvent,
  };

  function forAccount(account) {
    const store = tenants.get(account.id);
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

      importText: (text, filename) => {
        const nowMs = now();
        let result;
        try {
          result = importTelemetryFromText(store, text, filename, {
            nowMs,
            bucketMs,
            category: defaultWorkFor(businessType(store)),
          });
        } catch (err) {
          return { ok: false, message: `That file could not be parsed: ${String(err).slice(0, 120)}` };
        }
        if (result.imported === 0) {
          return {
            ok: false,
            message: "No usable rows. Every row needs a robot id and a timestamp.",
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

    return { store, getOwnerState, saveEconomics, onboarding };
  }

  return { ctx, forAccount };
}
