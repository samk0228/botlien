// Demo history seeding. Generates the weeks of telemetry the analytics need
// before they can say anything, then hands over to the live loop.
//
// WHY THIS EXISTS. The owner board's two most valuable panels are both
// comparative: tips need enough observation to tell a pattern from a Tuesday,
// and the variance panel needs two halves to compare. At the demo's 60x clock a
// single day of sim history costs 24 real minutes, so a cold demo opens on an
// empty tips list and an empty variance panel, which is precisely the half of
// the product worth showing.
//
// It lands through engine.ingest, the same function the live loop uses, rather
// than a parallel insert path. A seeding routine that drifts from real ingest
// is a demo of software that does not exist.
import { rebuildRollupsForRobot } from "./rollup.mjs";

const DAY_MS = 86_400_000;

/** Replay a scenario from `days` ago up to `toMs`, landing snapshots and
 * rebuilding rollups. Returns a summary for the caller to log.
 *
 * The connector is a FRESH instance, not the live one: its startMs anchors to
 * the beginning of history so the scenario's day-indexed phases (a decline that
 * begins on day 2, an outage on day 15) play out across the seeded window
 * rather than in the future where nobody will see them. */
export async function backfillScenario({ store, engine, connector, toMs, days, log = () => {} }) {
  const fromMs = toMs - days * DAY_MS;
  await connector.init();

  // Anchor the sim clock. This first tick emits only step 0; what it really
  // does is fix startMs, which every day-indexed phase in the scenario (a
  // decline beginning on day 2, an outage on day 15) is measured from.
  const anchor = await connector.tick(fromMs);
  let events = anchor.events.length;
  store.transaction(() => {
    engine.ingest(connector.name, anchor.events, fromMs, { storeRaw: false });
  });

  // Day at a time. One tick for the whole span would generate every step for
  // every robot into a single array first, which for three weeks of a six-robot
  // fleet at one sample a minute is ~180k live objects before a byte is
  // written. Chunking keeps the working set to one day.
  for (let t = fromMs; t < toMs; t += DAY_MS) {
    const end = Math.min(t + DAY_MS, toMs);
    const batch = await connector.tick(end);
    store.transaction(() => {
      engine.ingest(connector.name, batch.events, end, { storeRaw: false });
    });
    events += batch.events.length;
  }

  // Rollups once at the end rather than per day. They are derived wholly from
  // snapshots, so there is nothing to gain from computing them incrementally
  // over data that is already complete.
  const robots = store.listRobots();
  let buckets = 0;
  store.transaction(() => {
    for (const r of robots) buckets += rebuildRollupsForRobot(store, r.id).buckets;
  });

  log(`backfilled ${days}d of demo history: ${events} snapshots, ${buckets} hourly buckets across ${robots.length} robots`);
  return { fromMs, toMs, days, events, buckets, robots: robots.length };
}
