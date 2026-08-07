// Simulator connector. Implements the same duck-typed interface as the Bear
// connector: { name, init(), tick(nowMs) -> {events, heartbeat}, stop() }.
// Fully deterministic: seeded PRNG per robot, statuses generated at absolute
// step boundaries (stepIndex = floor((t - startMs) / emitEveryMs)), so the
// same seed and tick times produce a byte-identical stream regardless of how
// ticks are partitioned. Never calls Date.now().

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Profile phases: untilDay bounds (sim-days since start); last phase is open-ended.
export const PROFILES = {
  healthy: {
    phases: [{ dutyCycle: 0.55 }],
  },
  declining_utilization: {
    phases: [{ untilDay: 2, dutyCycle: 0.55 }, { dutyCycle: 0.08 }],
  },
  recurring_faults: {
    phases: [{ dutyCycle: 0.5, errProbPerStep: 0.12, critProb: 0.25 }],
  },
  stuck_loop: {
    phases: [{ dutyCycle: 0.5, stuckEveryMin: 45, stuckForMin: 8 }],
  },
  battery_degradation: {
    phases: [{ dutyCycle: 0.5, dailyMaxFadePctPerDay: 4 }],
  },
};

const DAY_MS = 86_400_000;

function phaseFor(profile, dayIndex) {
  for (const p of profile.phases) {
    if (p.untilDay === undefined || dayIndex < p.untilDay) return p;
  }
  return profile.phases[profile.phases.length - 1];
}

function newRobotState() {
  return { battery: 90, charging: false, missionState: "idle", missionSeq: 0 };
}

// One sim step for one robot. Mutates state, returns the status for that step.
function stepRobot(spec, state, rng, stepIndex, emitEveryMs, atMs, startMs) {
  const profile = PROFILES[spec.profile] ?? PROFILES.healthy;
  const dayIndex = Math.floor((atMs - startMs) / DAY_MS);
  const phase = phaseFor(profile, dayIndex);
  const stepMin = emitEveryMs / 60_000;
  const simMinute = Math.floor((atMs - startMs) / 60_000);

  // Fixed draw order per step keeps the stream stable across branches.
  const activeDraw = rng();
  const errDraw = rng();
  const critDraw = rng();

  // Stuck schedule is deterministic from the absolute sim-minute.
  const stuck = phase.stuckEveryMin ? simMinute % phase.stuckEveryMin < phase.stuckForMin : false;

  // Battery model: discharge while out, charge when low, cap fades per profile.
  const dailyMax = Math.max(40, 100 - (phase.dailyMaxFadePctPerDay ?? 0) * dayIndex);
  let active;
  if (state.charging) {
    state.battery = Math.min(dailyMax, state.battery + 1.2 * stepMin);
    if (state.battery >= dailyMax) state.charging = false;
    active = false;
  } else {
    active = stuck || activeDraw < phase.dutyCycle;
    state.battery = Math.max(2, state.battery - (active ? 0.4 : 0.08) * stepMin);
    if (state.battery <= 20) state.charging = true;
  }

  const missionState = state.charging ? "charging" : active ? "active" : "idle";
  if (missionState === "active" && state.missionState !== "active") state.missionSeq += 1;
  state.missionState = missionState;

  const errors = [];
  if (phase.errProbPerStep && errDraw < phase.errProbPerStep) {
    const critical = critDraw < (phase.critProb ?? 0);
    errors.push({ code: `sim:E${critical ? 900 : 100 + (stepIndex % 20)}`, severity: critical ? "CRITICAL" : "WARNING" });
  }

  return {
    externalId: spec.externalId,
    at: atMs,
    seq: stepIndex,
    connectionState: "online",
    batteryPct: Math.round(state.battery * 10) / 10,
    charging: state.charging,
    eStop: false,
    missionState,
    missionId: missionState === "active" ? `sim-m-${state.missionSeq}` : null,
    stuck,
    moving: missionState === "active" && !stuck,
    errors,
    pose: null,
  };
}

export function createSimConnector(scenario, { emitEveryMs = scenario.emitEveryMs ?? 60_000 } = {}) {
  const robots = new Map(); // externalId -> { spec, state, rng, lastStep }
  let startMs = null;

  return {
    name: "sim",

    async init() {
      for (const spec of scenario.robots) {
        robots.set(spec.externalId, {
          spec,
          state: newRobotState(),
          rng: mulberry32((scenario.seed ?? 1) ^ hashString(spec.externalId)),
          lastStep: -1,
        });
      }
      return scenario.robots.map((r) => ({
        externalId: r.externalId,
        displayName: r.displayName ?? r.externalId,
        brand: r.brand ?? "SimBot",
        model: r.model ?? null,
        category: r.category ?? "delivery",
      }));
    },

    async tick(nowMs) {
      if (startMs === null) startMs = nowMs;
      const outage = scenario.connectorOutage;
      const minuteNow = (nowMs - startMs) / 60_000;
      const inOutage = outage && minuteNow >= outage.startMin && minuteNow < outage.startMin + outage.durationMin;

      const events = [];
      const currentStep = Math.floor((nowMs - startMs) / emitEveryMs);
      for (const entry of robots.values()) {
        for (let step = entry.lastStep + 1; step <= currentStep; step++) {
          const atMs = startMs + step * emitEveryMs;
          // During the scripted outage the pipe is down: nothing reaches the
          // cloud, and the missed steps are never backfilled (matches how a
          // real vendor-cloud outage looks from outside).
          const stepMin = (atMs - startMs) / 60_000;
          const stepInOutage = outage && stepMin >= outage.startMin && stepMin < outage.startMin + outage.durationMin;
          if (stepInOutage) {
            entry.lastStep = step;
            continue;
          }
          const status = stepRobot(entry.spec, entry.state, entry.rng, step, emitEveryMs, atMs, startMs);
          events.push({ externalId: entry.spec.externalId, at: atMs, raw: status, status });
          entry.lastStep = step;
        }
      }

      // Steps inside the outage window were skipped above and are never
      // backfilled; anything generated here predates the outage.
      return {
        events,
        heartbeat: inOutage
          ? { state: "down", detail: "scripted outage" }
          : { state: "ok", detail: null },
      };
    },

    async stop() {},
  };
}
