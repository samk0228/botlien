// The sales-demo fleet: six robots, one per failure profile, plus a scripted
// connector outage that proves "pipe down != robots down" on the board.
// Minutes are sim-minutes measured from the first engine tick.
//
// WAREHOUSE, 2026-08-25. This fleet used to be a restaurant: Bear Servi tray
// runners and floor scrubbers in a dining room. The company sells to warehouse
// and logistics operators, so a prospect opening the demo met a business that
// was not theirs and had to translate every number before it meant anything.
// The three machine kinds below are the three the pitch names: mobile pickers,
// six-axis arms, and automated forklifts.
//
// CALIBRATION, measured 2026-08-25. Rates come from BENCHMARKS in rates.mjs,
// which prices a picking associate at $24.00/hr loaded against 60 picks an
// hour, and a putaway move at 40 an hour. `pace` and `runLength` scale the
// profiles, which are shaped for two-minute hospitality tray runs and are far
// too slow and too long for a pick. As tuned the fleet reads:
//
//   Picker 1 (Zone A)       2.87x    359 picks/day
//   Picker 2 (Zone B)       0.69x     86 picks/day   <- the flagged unit
//   Picker 3 (Zone C)       2.81x    353 picks/day
//   Pick arm (Station 4)    3.12x    391 picks/day
//   Forklift 1 (Receiving)  2.07x    173 moves/day
//   Scrubber (nights)       3.36x    4 active hrs/night
//   FLEET                   2.41x
//
// Those per-day counts are inside the band the AMR vendors publish, so an
// operator can check them against their own floor. The fleet and the flagged
// unit match the numbers the pitch deck quotes (2.39x fleet, 0.69x Picker 2),
// which is the point: the demo and the deck have to agree.
//
// A demo that opens at 7x is worse than no demo, because the first person who
// owns one of these knows it is impossible.
//
// Profile note: stuck_loop and worn_parts run few, long missions. On
// active-hour work (cleaning) a long run still earns, so the wedge shows up as
// "counted, not earned" and reads correctly. On per-mission work (picking,
// putaway) the same profile craters the unit to a fifth of its lease, which
// buries the real story. Hence the wedge sits on the scrubber.

// Two shifts. Most contract warehouses run a day and a swing shift and go
// quiet overnight, rather than the flat 24h a spec sheet implies.
const WAREHOUSE_FLOOR = { openHour: 6, closeHour: 23 };

// Relative demand by local hour. Morning ramp as orders release, a dip over
// the shift change around 2pm, a second peak as afternoon cutoffs approach,
// and a tail while the last trailers load.
const WAREHOUSE_DEMAND = [
  0, 0, 0, 0, 0, 0, // 0-5, dark
  0.35, // 6 first shift starts
  0.7,  // 7
  0.95, // 8
  1.0,  // 9 morning peak, wave released
  0.95, // 10
  0.8,  // 11
  0.6,  // 12 lunch
  0.45, // 13
  0.4,  // 14 shift change
  0.7,  // 15 second shift ramps
  0.9,  // 16
  1.0,  // 17 afternoon cutoff peak
  0.85, // 18
  0.6,  // 19
  0.45, // 20
  0.3,  // 21 last trailers
  0.15, // 22
  0,    // 23 dark
];

// Floor scrubbing happens after the pickers stop, which is why it gets its own
// window: scored against the morning wave a night scrubber reads as idle all
// day, and the tips engine would be right to say so and wrong about why.
const NIGHT_CLEAN = { openHour: 23, closeHour: 5 };
const NIGHT_CLEAN_DEMAND = Array.from({ length: 24 }, (_, h) => (h === 23 || h < 5 ? 1 : 0));

// Inbound receiving runs earlier and shorter than picking: trailers arrive on
// appointment in the morning and the dock clears by mid-afternoon.
const RECEIVING = { openHour: 5, closeHour: 17 };
const RECEIVING_DEMAND = [
  0, 0, 0, 0, 0,
  0.5,  // 5 first appointments
  0.85, // 6
  1.0,  // 7 dock peak
  1.0,  // 8
  0.9,  // 9
  0.75, // 10
  0.6,  // 11
  0.5,  // 12
  0.55, // 13
  0.5,  // 14
  0.35, // 15
  0.2,  // 16 dock winding down
  0, 0, 0, 0, 0, 0, 0,
];

export default {
  id: "demo-fleet",
  // Selects the vocabulary and the benchmark rates: picks and moves at a
  // picker's loaded wage, not runs at a server's.
  business: "warehouse",
  seed: 1030,
  emitEveryMs: 60_000,
  service: WAREHOUSE_FLOOR,
  demand: WAREHOUSE_DEMAND,
  // Metres. A single mid-size distribution centre floor plate, not a dining
  // room. Declaring a floor is what switches pose reporting on, so scenarios
  // without one keep byte-identical PRNG streams to before pose existed.
  floor: { x0: 0, y0: 0, x1: 90, y1: 55 },
  robots: [
    // A three-day dead stretch late in the history, so the period-over-period
    // panel has a real availability story to decompose rather than noise. The
    // pipe stays up and its siblings keep reporting throughout, which is what
    // separates one dead robot from one dead connector.
    {
      externalId: "sim-001", displayName: "Picker 1 (Zone A)", brand: "Locus", model: "Origin",
      category: "picking", profile: "healthy", pace: 2.6, runLength: 0.5,
      outages: [{ startDay: 15, durationHours: 72 }],
    },
    // The unit the whole demo turns on: it is the one running under its lease,
    // and "move it to a busier zone before renewal" is the recommendation an
    // operator can act on the same afternoon.
    {
      externalId: "sim-002", displayName: "Picker 2 (Zone B)", brand: "Locus", model: "Origin",
      category: "picking", profile: "declining_utilization", pace: 2.15, runLength: 0.5,
    },
    {
      externalId: "sim-003", displayName: "Picker 3 (Zone C)", brand: "Fetch", model: "RollerTop",
      category: "picking", profile: "recurring_faults", pace: 2.4, runLength: 0.5,
    },
    // Six-axis arm at a piece-pick station. Fixed in place, so its failure mode
    // is not a bad zone but a jam it keeps hitting in the same spot.
    {
      externalId: "sim-004", displayName: "Pick arm (Station 4)", brand: "Universal Robots", model: "UR10e",
      category: "picking", profile: "healthy", pace: 2.4, runLength: 0.5,
    },
    // Automated forklift on the inbound dock: putaway, priced per move.
    {
      externalId: "sim-005", displayName: "Forklift 1 (Receiving)", brand: "Fox Robotics", model: "FoxBot",
      category: "putaway", profile: "battery_degradation", pace: 2.4,
      service: RECEIVING, demand: RECEIVING_DEMAND,
    },
    // Two night scrubbers, so the fleet has active-hour units alongside the
    // per-mission ones and the board shows both bases side by side. They also
    // carry the two profiles that only read correctly on active-hour work.
    {
      externalId: "sim-006", displayName: "Scrubber 1 (nights)", brand: "Gausium", model: "S75",
      category: "cleaning", profile: "stuck_loop", manualProb: 0.45,
      service: NIGHT_CLEAN, demand: NIGHT_CLEAN_DEMAND,
    },
    // worn_parts is load-bearing, not decoration: the consumable and
    // deferred-maintenance rules on the risk board only fire on a cleaner that
    // is being run past its service interval, and test/wear.test.mjs asserts
    // the demo still contains one. Drop this robot and the LGD story silently
    // leaves the demo with every other test green.
    {
      externalId: "sim-007", displayName: "Scrubber 2 (dock)", brand: "Gausium", model: "S50",
      category: "cleaning", profile: "worn_parts",
      service: NIGHT_CLEAN, demand: NIGHT_CLEAN_DEMAND,
    },
  ],
  connectorOutage: { startMin: 45, durationMin: 12 },
  // Days of history to generate before the live loop starts. Without this the
  // demo needs 48 real minutes at 60x before the tips engine has enough
  // observation to say anything, and every period-over-period panel is empty
  // until then. Three weeks gives two comparable halves.
  backfillDays: 21,
};
