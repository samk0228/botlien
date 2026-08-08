// The sales-demo fleet: six robots, one per failure profile, plus a scripted
// connector outage that proves "pipe down != robots down" on the board.
// Minutes are sim-minutes measured from the first engine tick.
//
// CALIBRATION, 2026-08-07. This fleet used to run flat out around the clock and
// produced roughly 400 runs per robot per day. A real Bear Servi does 100-150
// over a 12-hour service, so the demo opened on a coverage ratio near 7x: a
// number that is indefensible in front of anyone who owns one of these, and
// therefore worse than no demo. The service window, the demand curve, and the
// duty cycles below are set so a healthy Servi lands around 140 runs a day and
// the fleet opens near 3x, which is inside the band the vendors themselves
// claim and which the owner can sanity-check against their own floor.
const DINING_ROOM = { openHour: 11, closeHour: 23 };

// Relative demand by local hour. Two rushes, a dead afternoon between them, and
// a tail after nine. Index is the hour; anything outside the service window is
// never read.
const DINING_DEMAND = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0-10, closed
  0.45, // 11 doors open
  0.9,  // 12 lunch
  1.0,  // 13 lunch peak
  0.5,  // 14
  0.2,  // 15 dead
  0.25, // 16
  0.55, // 17 early dinner
  0.9,  // 18
  1.0,  // 19 dinner peak
  0.85, // 20
  0.5,  // 21
  0.25, // 22 last tables
  0,    // 23 closed
];

// Cleaners work the room after the last table leaves, which is why they get
// their own window: scored against the dinner rush they would read as idle all
// night, and the tips engine would be right to say so and wrong about why.
const AFTER_CLOSE = { openHour: 23, closeHour: 3 };
const AFTER_CLOSE_DEMAND = Array.from({ length: 24 }, (_, h) => (h === 23 || h < 3 ? 1 : 0));

export default {
  id: "demo-fleet",
  seed: 1030,
  emitEveryMs: 60_000,
  service: DINING_ROOM,
  demand: DINING_DEMAND,
  // Metres. Declaring a floor is what switches pose reporting on, so scenarios
  // without one keep byte-identical PRNG streams to before pose existed.
  floor: { x0: 0, y0: 0, x1: 18, y1: 12 },
  robots: [
    // A three-day dead stretch late in the history, so the period-over-period
    // panel has a real availability story to decompose rather than noise. The
    // pipe stays up and its siblings keep reporting throughout, which is what
    // separates one dead robot from one dead connector.
    {
      externalId: "sim-001", displayName: "Servi 1 (front)", brand: "Bear", model: "Servi",
      category: "delivery", profile: "healthy",
      outages: [{ startDay: 15, durationHours: 72 }],
    },
    { externalId: "sim-002", displayName: "Servi 2 (patio)", brand: "Bear", model: "Servi", category: "delivery", profile: "declining_utilization" },
    { externalId: "sim-003", displayName: "P3 runner", brand: "Pudu", model: "P3", category: "delivery", profile: "recurring_faults" },
    {
      externalId: "sim-004", displayName: "Scrubber 50", brand: "Gausium", model: "S50",
      category: "cleaning", profile: "stuck_loop",
      service: AFTER_CLOSE, demand: AFTER_CLOSE_DEMAND,
    },
    { externalId: "sim-005", displayName: "Servi 3 (banquet)", brand: "Bear", model: "Servi", category: "delivery", profile: "battery_degradation" },
    {
      externalId: "sim-006", displayName: "Scrubber 75 (nights)", brand: "Gausium", model: "S75",
      category: "cleaning", profile: "worn_parts", manualProb: 0.45,
      service: AFTER_CLOSE, demand: AFTER_CLOSE_DEMAND,
    },
  ],
  connectorOutage: { startMin: 45, durationMin: 12 },
  // Days of history to generate before the live loop starts. Without this the
  // demo needs 48 real minutes at 60x before the tips engine has enough
  // observation to say anything, and every period-over-period panel is empty
  // until then. Three weeks gives two comparable halves.
  backfillDays: 21,
};
