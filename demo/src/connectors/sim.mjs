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

// A SERVICE DAY, not a clock day. The simulator used to run every robot flat
// out around the clock, which produced ~400 runs per robot per day against a
// real Servi's 100-150 over a 12-hour service, and a demo coverage ratio near
// 7x that no owner would believe and no salesperson should show. Duty is now
// shaped by two things:
//
//   service   the hours the venue is open at all; outside them a robot idles
//             and charges, exactly as it does in a real dining room
//   demand    a relative multiplier per hour, so a lunch rush and a dinner
//             rush exist and the flat middle of the afternoon does too
//
// Both are scenario-level and both default to "always open, flat demand", so
// any scenario that does not declare them keeps the old behaviour.
export const ALWAYS_OPEN = { openHour: 0, closeHour: 24 };
export const FLAT_DEMAND = Array(24).fill(1);

/** Relative demand at an instant, 0 when the venue is shut. Local hours: a
 * dinner rush is a local-time idea, and the rest of the pipeline (tips,
 * profiles) reads hour-of-day the same way. */
export function demandAt(atMs, service = ALWAYS_OPEN, demand = FLAT_DEMAND) {
  const hour = new Date(atMs).getHours();
  const { openHour, closeHour } = service;
  // A window that wraps midnight (open 18, close 2) is still one service.
  const open = openHour <= closeHour ? hour >= openHour && hour < closeHour : hour >= openHour || hour < closeHour;
  if (!open) return 0;
  return demand[hour] ?? 1;
}

/** Is this step inside a scripted per-robot outage? Distinct from the
 * connector-wide outage: that one takes the whole pipe down, this one is a
 * single robot dark while its siblings keep reporting, which is what an
 * availability problem actually looks like on a real fleet. */
export function inRobotOutage(spec, atMs, startMs) {
  for (const o of spec.outages ?? []) {
    const from = startMs + o.startDay * DAY_MS;
    if (atMs >= from && atMs < from + o.durationHours * 3_600_000) return true;
  }
  return false;
}

// Profile phases: untilDay bounds (sim-days since start); last phase is
// open-ended.
//
// WORK IS MODELLED AS RUNS, NOT AS A COIN FLIP PER MINUTE. The original model
// drew "am I busy this minute" independently each step at probability
// dutyCycle. That is wrong in a way that quietly corrupts everything
// downstream: the number of missions it produces is proportional to p(1-p),
// which saturates near p=0.5, so doubling how busy the room is barely moved the
// run count. Applied to a demand curve it compressed a 2x lunch rush into a
// 1.3x one, and the tips engine, reading mission counts to find the peak,
// correctly concluded that almost every open hour was a peak hour.
//
// A robot now starts a RUN at a rate proportional to demand and stays on it for
// runMinutes. Mission counts scale linearly with how busy the room is, which is
// how they behave on a real floor and what makes hour-of-day analysis mean
// anything.
//
//   runsPerHour  runs begun per hour at full demand
//   runMinutes   how long one run occupies the robot
//
// dutyCycle is still honoured as a fallback for any profile that has not been
// converted, so a scenario written against the old model still runs.
export const PROFILES = {
  // ~18 runs an hour at the dinner peak, 2 minutes each: about 130 tray runs
  // over a 12-hour service, which is where a real Bear Servi lands.
  healthy: {
    phases: [{ runsPerHour: 18, runMinutes: 2 }],
  },
  declining_utilization: {
    phases: [{ untilDay: 2, runsPerHour: 18, runMinutes: 2 }, { runsPerHour: 2.5, runMinutes: 2 }],
  },
  recurring_faults: {
    phases: [{ runsPerHour: 16, runMinutes: 2, errProbPerStep: 0.12, critProb: 0.25 }],
  },
  // Cleaning is one long cycle, not a stream of trips: ~45 minutes of scrubbing
  // per run, which is why cleaning is priced per active hour and never per run.
  stuck_loop: {
    phases: [{ runsPerHour: 1.2, runMinutes: 45, stuckEveryMin: 45, stuckForMin: 8 }],
  },
  battery_degradation: {
    phases: [{ runsPerHour: 17, runMinutes: 2, dailyMaxFadePctPerDay: 4 }],
  },
  // Runs hard and well, which is the point: nothing in the telemetry looks
  // wrong. Only the consumable counters say the owner stopped buying parts.
  worn_parts: {
    phases: [{ runsPerHour: 1.3, runMinutes: 45 }],
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
  return { battery: 90, charging: false, missionState: "idle", missionSeq: 0, activeMs: 0, runStepsLeft: 0 };
}

// Cleaning robots report consumable wear; delivery robots do not. Modelled as
// hours consumed against a rated life, accumulating only while the robot is
// actually working, which is what makes `wornParts` reach exhaustion on a
// machine that runs and never on one that sits idle.
const WEAR_PARTS = [
  { component: "rolling_brush", lifeSpanHours: 400 },
  { component: "squeegee", lifeSpanHours: 250 },
  { component: "filter", lifeSpanHours: 300 },
  { component: "side_brush", lifeSpanHours: 500 },
];

function simWear(spec, state, atMs, startMs) {
  if (spec.category !== "cleaning") return null;
  const activeHours = state.activeMs / 3_600_000;
  // `worn_parts` starts past its service interval so the demo shows a machine
  // being run into the ground, not one that is merely well used. Set above 1.0
  // deliberately: at 0.92 only two parts cleared the line, which left
  // deferred_maintenance one part short of crit and no margin at all when the
  // activity model changed underneath it. The paired assertion lives in
  // test/wear.test.mjs and reads the crit threshold from config.
  const headStart = spec.profile === "worn_parts" ? 1.0 : 0.25;
  return WEAR_PARTS.map((p, i) => {
    // Stagger the parts so they do not all expire on the same tick.
    const used = p.lifeSpanHours * (headStart + i * 0.035) + activeHours;
    return {
      component: p.component,
      levelPct: null,
      enabled: true,
      lifeSpanHours: p.lifeSpanHours,
      usedLifeHours: Math.round(used * 10) / 10,
      remainingPct: Math.min(100, (1 - used / p.lifeSpanHours) * 100),
    };
  });
}

/** Where the robot is standing. Null unless the scenario declares a floor, and
 * that condition is load-bearing: pose costs an extra PRNG draw, so scenarios
 * without a floor keep byte-identical streams to before this existed.
 *
 * A stalled robot is parked at ITS OWN hotspot, deterministic from its id. Real
 * robots do not get stuck in random places, they get stuck at the one bad
 * corner, the propped door, the mat edge. That concentration is the entire
 * signal the stall_hotspot tip reads, so a simulator that scattered stalls
 * uniformly would be modelling something that does not happen. */
function poseFor(spec, state, { stuck, floor }, draw, stepIndex) {
  if (!floor) return null;
  // Most stalls happen at the one bad spot, not all of them. A simulator that
  // put 100% of them in one cell would let the hotspot tip look infallible on
  // the demo and then meet a real floor where the share is 40-70%. The rule has
  // to be tuned against a believable concentration, so the fixture provides one.
  if (stuck && state.hotspot && draw < 0.78) {
    return {
      x: Math.round((state.hotspot.x + (draw - 0.5) * 0.6) * 100) / 100,
      y: Math.round((state.hotspot.y + (draw - 0.5) * 0.6) * 100) / 100,
      theta: 0,
    };
  }
  return {
    x: Math.round((floor.x0 + draw * (floor.x1 - floor.x0)) * 100) / 100,
    y: Math.round((floor.y0 + ((stepIndex % 7) / 7) * (floor.y1 - floor.y0)) * 100) / 100,
    theta: 0,
  };
}

// One sim step for one robot. Mutates state, returns the status for that step.
function stepRobot(spec, state, rng, stepIndex, emitEveryMs, atMs, startMs, shape = {}) {
  const profile = PROFILES[spec.profile] ?? PROFILES.healthy;
  const dayIndex = Math.floor((atMs - startMs) / DAY_MS);
  const phase = phaseFor(profile, dayIndex);
  const stepMin = emitEveryMs / 60_000;
  const simMinute = Math.floor((atMs - startMs) / 60_000);

  // Fixed draw order per step keeps the stream stable across branches.
  const activeDraw = rng();
  const errDraw = rng();
  const critDraw = rng();
  // Conditioned on a static per-robot property, not on state, so the draw count
  // per step stays constant for a given robot and existing profiles' streams
  // are byte-identical to before this line existed.
  const manualDraw = spec.manualProb ? rng() : 0;
  const poseDraw = shape.floor ? rng() : 0;

  // How busy the room is right now. Zero when the venue is shut, which is what
  // stops the fleet inventing tray runs at 4am.
  const demand = demandAt(atMs, shape.service, shape.demand);

  // Stuck schedule is deterministic from the absolute sim-minute, but a robot
  // parked on its dock overnight cannot wedge itself against a chair. Gating on
  // demand keeps stalls inside service, where they cost something.
  const stuck = demand > 0 && phase.stuckEveryMin ? simMinute % phase.stuckEveryMin < phase.stuckForMin : false;

  // How long one run holds the robot, and how often one begins at full demand.
  const runMinutes = phase.runMinutes ?? 3;
  const runSteps = Math.max(1, Math.round(runMinutes / stepMin));
  const runsPerHour = phase.runsPerHour ?? ((phase.dutyCycle ?? 0) * 60) / runMinutes;
  const startProb = runsPerHour * demand * (stepMin / 60);

  // Battery model: discharge while out, charge when low, cap fades per profile.
  const dailyMax = Math.max(40, 100 - (phase.dailyMaxFadePctPerDay ?? 0) * dayIndex);
  let active;
  if (state.charging) {
    state.battery = Math.min(dailyMax, state.battery + 1.2 * stepMin);
    if (state.battery >= dailyMax) state.charging = false;
    active = false;
    state.runStepsLeft = 0;
  } else {
    if (state.runStepsLeft > 0) {
      active = true;
      // A wedged robot burns the clock without finishing. The run does NOT
      // advance while it is stuck, which is what makes stall time surface as
      // work the fleet was credited for and did not deliver.
      if (!stuck) state.runStepsLeft -= 1;
    } else if (stuck) {
      // Got stuck on the way out: a run begins and then cannot progress.
      active = true;
      state.runStepsLeft = runSteps - 1;
      state.missionSeq += 1;
    } else if (activeDraw < startProb) {
      active = true;
      state.runStepsLeft = runSteps - 1;
      // Counted at the START of a run rather than on an idle -> active edge.
      // Two runs back to back share no idle step between them, and an edge
      // count would silently merge them into one.
      state.missionSeq += 1;
    } else {
      active = false;
    }
    state.battery = Math.max(2, state.battery - (active ? 0.4 : 0.08) * stepMin);
    if (state.battery <= 20) state.charging = true;
  }

  const missionState = state.charging ? "charging" : active ? "active" : "idle";
  state.missionState = missionState;
  if (active) state.activeMs += emitEveryMs;

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
    pose: poseFor(spec, state, { stuck, floor: shape.floor }, poseDraw, stepIndex),
    // Only cleaning robots report these, mirroring the real split: Gausium's
    // status payload carries wear and manual-control state, Bear's does not.
    condition: spec.category === "cleaning"
      ? {
          manualControlling: spec.manualProb ? manualDraw < spec.manualProb : false,
          navStatus: stuck ? "NAVI_STUCK" : missionState === "active" ? "NAVI_RUNNING" : "NAVI_IDLE",
          localizationState: "LOCALIZED",
          batteryVoltageV: Math.round((48 + state.battery * 0.04) * 10) / 10,
          batteryCurrentA: state.charging ? 12 : active ? -18 : -2,
          batteryTempC: Math.round((28 + (active ? 9 : 0)) * 10) / 10,
          chargerCurrentA: state.charging ? 12 : 0,
          vendorReportAt: atMs,
        }
      : null,
    wear: simWear(spec, state, atMs, startMs),
  };
}

export function createSimConnector(scenario, { emitEveryMs = scenario.emitEveryMs ?? 60_000 } = {}) {
  const robots = new Map(); // externalId -> { spec, state, rng, lastStep }
  let startMs = null;

  return {
    name: "sim",

    async init() {
      for (const spec of scenario.robots) {
        const state = newRobotState();
        // One bad spot per robot, fixed for the life of the run and derived
        // from the id so it survives a restart. Kept inside the floor extent.
        if (scenario.floor) {
          const h = hashString(spec.externalId);
          const f = scenario.floor;
          state.hotspot = {
            x: Math.round((f.x0 + (h % 1000) / 1000 * (f.x1 - f.x0)) * 100) / 100,
            y: Math.round((f.y0 + ((h >> 10) % 1000) / 1000 * (f.y1 - f.y0)) * 100) / 100,
          };
        }
        robots.set(spec.externalId, {
          spec,
          state,
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
          // A single robot dark while the pipe and its siblings stay up. The
          // step is still consumed so the PRNG stays in lockstep with a run
          // that had no outage, which keeps the rest of the stream comparable.
          const status = stepRobot(entry.spec, entry.state, entry.rng, step, emitEveryMs, atMs, startMs, {
            // A robot may keep its own hours. Scrubbers run after close while
            // the dining room robots are parked, and scoring a night cleaner
            // against the dinner rush would report it as permanently idle.
            service: entry.spec.service ?? scenario.service,
            demand: entry.spec.demand ?? scenario.demand,
            floor: scenario.floor,
          });
          if (inRobotOutage(entry.spec, atMs, startMs)) {
            entry.lastStep = step;
            continue;
          }
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
