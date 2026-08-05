// Flag lifecycle. Pure diffing core + a DB/genesis applier.
// Lifecycle: raise -> (escalate | touch while still firing) -> hysteresis
// clear after the condition has been absent for clearAfterMs. Flag rows are
// never deleted — cleared history is backtest input.

const SEVERITY_RANK = { info: 0, warn: 1, crit: 2 };

/**
 * Pure. activeFlags: DB rows. results: currently-firing conditions
 * [{ scope, ruleId, dimension, severity, robotId?, connector?, evidence }].
 * Returns { raise, escalate, touch, clear } where clear items are flag rows.
 */
export function computeFlagChanges({ activeFlags, results, nowMs, clearAfterMsFor }) {
  const byKey = new Map(activeFlags.map((f) => [`${f.scope}|${f.rule_id}`, f]));
  const firing = new Set();
  const raise = [];
  const escalate = [];
  const touch = [];

  for (const r of results) {
    const key = `${r.scope}|${r.ruleId}`;
    firing.add(key);
    const existing = byKey.get(key);
    if (!existing) {
      raise.push({ ...r, raisedAt: nowMs });
    } else if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[existing.severity]) {
      escalate.push({ flag: existing, severity: r.severity, evidence: r.evidence });
    } else {
      touch.push({ flag: existing, evidence: r.evidence });
    }
  }

  const clear = [];
  for (const f of activeFlags) {
    if (firing.has(`${f.scope}|${f.rule_id}`)) continue;
    // last_eval_at is the last moment the condition was seen firing.
    if (nowMs - f.last_eval_at >= clearAfterMsFor(f.rule_id)) clear.push(f);
  }

  return { raise, escalate, touch, clear };
}

/** Applies changes to the store and logs raise/escalate/clear to Genesis. */
export function applyFlagChanges(store, changes, { nowMs, log = () => {} }) {
  for (const r of changes.raise) {
    store.raiseFlag({
      scope: r.scope,
      robotId: r.robotId ?? null,
      connector: r.connector ?? null,
      ruleId: r.ruleId,
      dimension: r.dimension,
      severity: r.severity,
      raisedAt: nowMs,
      detail: r.evidence ?? null,
    });
    log(`flag raised: ${r.ruleId} ${r.severity.toUpperCase()} on ${r.scope} ${fmtEvidence(r.evidence)}`,
      r.severity === "crit" ? "needs_user" : "warning");
  }
  for (const e of changes.escalate) {
    store.updateFlagEval(e.flag.id, { severity: e.severity, lastEvalAt: nowMs, detail: e.evidence });
    log(`flag escalated: ${e.flag.rule_id} -> ${e.severity.toUpperCase()} on ${e.flag.scope} ${fmtEvidence(e.evidence)}`,
      e.severity === "crit" ? "needs_user" : "warning");
  }
  for (const t of changes.touch) {
    store.updateFlagEval(t.flag.id, { severity: t.flag.severity, lastEvalAt: nowMs, detail: t.evidence });
  }
  for (const f of changes.clear) {
    store.clearFlag(f.id, nowMs);
    log(`flag cleared: ${f.rule_id} on ${f.scope}`);
  }
}

function fmtEvidence(e) {
  if (!e) return "";
  return `(${Object.entries(e).map(([k, v]) => `${k}=${v}`).join(", ")})`;
}
