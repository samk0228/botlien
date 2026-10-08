// First run for a robot-arm shop, in five steps, one question a screen
// (Antonio's onboarding, 10/7): your account, your floor, connect robots,
// alerts, your team. Then the live product. There is no industry picker and
// no rate card: a new account is a manufacturing account, and price is one
// plain screen later on.
//
// Every answer is saved and does something. The floor step's role decides
// whether the owner's own view shows dollars; the alerts step's "who sees
// dollar figures" is enforced on the server by roles.mjs; the lead it names
// is invited onto the account. Where the step is now is read from what has
// been saved, so a reload or a second device lands on the same screen.
import { setBusinessType, businessType, KV_CONFIRMED } from "./owner.mjs";
import { DOLLAR_POLICIES } from "./roles.mjs";

export class OnboardingError extends Error {}

export const KV_ONB = "onboarding.v2"; // { name, company, brand, role, connect, alerts, doneAt }
export const STEPS = ["account", "floor", "connect", "alerts", "team"];
export const BRANDS = { ur: "Universal Robots", fanuc_abb_kuka: "Fanuc, ABB, KUKA", other: "Other" };
// Only Universal Robots can be read today; the others are on the list.
export const BRANDS_AVAILABLE = ["ur"];
export const ALERT_AFTER = [2, 5, 10];
export const DEFAULT_ALERTS = { tellFirst: "owner", leadEmail: null, backup: true, afterMinutes: 5, dollars: "owner_lead" };

export function readOnboarding(store) {
  try {
    const v = JSON.parse(store.getKV(KV_ONB) || "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function write(store, patch, nowMs) {
  const next = { ...readOnboarding(store), ...patch };
  store.setKV(KV_ONB, JSON.stringify(next), nowMs);
  return next;
}

/** Which of the five steps this account is on, or "done". */
export function onboardingV2Step(store) {
  const o = readOnboarding(store);
  if (o.doneAt) return "done";
  if (!o.name) return "account";
  if (!o.brand || !o.role) return "floor";
  if (!o.connect) return "connect";
  if (!o.alerts) return "alerts";
  return "team";
}

/** Whether this account takes the five-step first run: any account that has
 *  not picked another kind of business under the old one. */
export function usesOnboardingV2(store) {
  const b = businessType(store);
  return !b || b === "manufacturing";
}

/** The dollar rules the role checks read. */
export function dollarRules(store) {
  const o = readOnboarding(store);
  const a = o.alerts ?? DEFAULT_ALERTS;
  return { policy: a.dollars ?? "owner_lead", leadEmail: a.leadEmail ?? null, ownerView: o.role === "technician" ? "technician" : null };
}

const text = (v, max, label) => {
  const s = String(v ?? "").trim();
  if (!s) throw new OnboardingError(`Enter your ${label}.`);
  if (s.length > max) throw new OnboardingError(`Your ${label} is longer than ${max} characters.`);
  return s;
};

export function saveAccountStep(store, body, nowMs) {
  const name = text(body?.name, 80, "name");
  const company = text(body?.company, 120, "company");
  if (!businessType(store)) setBusinessType(store, "manufacturing");
  return write(store, { name, company }, nowMs);
}

export function saveFloorStep(store, body, nowMs) {
  const brand = String(body?.brand ?? "");
  if (!BRANDS[brand]) throw new OnboardingError("Pick the robots you run.");
  const role = String(body?.role ?? "");
  if (!["owner", "technician"].includes(role)) throw new OnboardingError("Pick your role.");
  return write(store, { brand, role }, nowMs);
}

/** How they left the connect step: their robots are reporting, they will
 *  connect later, or (demo accounts) the recorded replay is playing. */
export function saveConnectStep(store, body, nowMs) {
  const mode = String(body?.mode ?? "");
  if (!["robots", "later", "replay"].includes(mode)) throw new OnboardingError("mode is robots, later or replay.");
  if (mode === "robots" && store.listRobots().length === 0) throw new OnboardingError("No robots have reported yet. Wait for the first readings, or connect later.");
  return write(store, { connect: mode }, nowMs);
}

export function saveAlertsStep(store, body, nowMs) {
  const tellFirst = String(body?.tellFirst ?? "owner");
  if (!["owner", "lead"].includes(tellFirst)) throw new OnboardingError("Tell first is you or your lead.");
  const leadRaw = String(body?.leadEmail ?? "").trim().toLowerCase();
  const leadEmail = leadRaw || null;
  if (leadEmail && !/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(leadEmail)) throw new OnboardingError("That lead's email does not look right.");
  if (tellFirst === "lead" && !leadEmail) throw new OnboardingError("Add your lead's email to tell them first.");
  const afterMinutes = Number(body?.afterMinutes ?? 5);
  if (!ALERT_AFTER.includes(afterMinutes)) throw new OnboardingError("Alert after 2, 5 or 10 minutes.");
  const dollars = String(body?.dollars ?? "owner_lead");
  if (!DOLLAR_POLICIES.includes(dollars)) throw new OnboardingError("Pick who sees dollar figures.");
  const alerts = { tellFirst, leadEmail, backup: body?.backup !== false, afterMinutes, dollars };
  return write(store, { alerts }, nowMs);
}

export function finishOnboarding(store, nowMs) {
  if (onboardingV2Step(store) !== "team") throw new OnboardingError("Finish the steps before this one first.");
  store.setKV(KV_CONFIRMED, String(nowMs), nowMs);
  return write(store, { doneAt: nowMs }, nowMs);
}

/** Everything the five screens need, in one read. */
export function onboardingState(store, { email, demo = false, robots = [] } = {}) {
  const o = readOnboarding(store);
  return {
    step: onboardingV2Step(store),
    steps: STEPS,
    email,
    name: o.name ?? "",
    company: o.company ?? "",
    brand: o.brand ?? "ur",
    role: o.role ?? "owner",
    brands: Object.entries(BRANDS).map(([key, label]) => ({ key, label, available: BRANDS_AVAILABLE.includes(key) })),
    connect: o.connect ?? null,
    alerts: o.alerts ?? DEFAULT_ALERTS,
    demo,
    robots,
  };
}
