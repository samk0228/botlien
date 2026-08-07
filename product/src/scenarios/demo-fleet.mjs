// The sales-demo fleet: five robots, one per failure profile, plus a scripted
// connector outage that proves "pipe down ≠ robots down" on the board.
// Minutes are sim-minutes measured from the first engine tick.
export default {
  id: "demo-fleet",
  seed: 1030,
  emitEveryMs: 60_000,
  robots: [
    { externalId: "sim-001", displayName: "Servi 1 (front)", brand: "Bear", model: "Servi", category: "delivery", profile: "healthy" },
    { externalId: "sim-002", displayName: "Servi 2 (patio)", brand: "Bear", model: "Servi", category: "delivery", profile: "declining_utilization" },
    { externalId: "sim-003", displayName: "P3 runner", brand: "Pudu", model: "P3", category: "delivery", profile: "recurring_faults" },
    { externalId: "sim-004", displayName: "Scrubber 50", brand: "Gausium", model: "S50", category: "cleaning", profile: "stuck_loop" },
    { externalId: "sim-005", displayName: "Servi 3 (banquet)", brand: "Bear", model: "Servi", category: "delivery", profile: "battery_degradation" },
  ],
  connectorOutage: { startMin: 45, durationMin: 12 },
};
