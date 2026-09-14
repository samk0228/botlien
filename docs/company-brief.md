# Botlien: company, product, and backend brief

Last updated 2026-09-14. Context document for an engineer designing the backend infrastructure the Botlien dashboard demo runs on. Read it fully before proposing anything. Sections 8 through 11 are the technical contract; sections 1 through 7 explain why the contract looks the way it does.

---

## 1. One sentence

Botlien turns robot telemetry into financial telemetry, so fleet operators who lease commercial service robots can see, in dollars, whether the robots are earning their keep, what is dragging the number down, and what to do about it.

## 2. Company and team

- Two founders. **Samuel Kim** is CTO and owns product, codebase, intake pipeline, and dashboard. **Antonio D'Angelo** owns go-to-market, outbound, CRM, and the marketing site (botlien.com).
- Pre-revenue, pre-seed, bootstrapped. Founded August 2026. The app has been live at `https://app.botlien.com` since 2026-08-10.
- The name is "bot" plus "lien". It dates from an earlier framing of the company (section 4). The product today is operator-facing.

## 3. The problem

Commercial service robots (AMRs and pick-assist robots in warehouses, delivery robots in restaurants and hotels, floor scrubbers in facilities) are almost always **leased or financed**, not bought. Under Robotics-as-a-Service (RaaS), a monthly invoice arrives whether the robot worked or not.

When the deal is signed, a salesperson quotes a payback number ("pays for itself in 14 months"). After that, nobody checks. The vendor's own dashboard shows uptime and task counts, but it is built by the party that wants the contract renewed, and it never converts activity into money against the invoice.

Every robot writes a continuous diary: online time, working time, idle time, charging, stuck episodes, error codes, battery state, component wear, position. That diary is the ground truth about whether the asset is producing. Nobody independent of the manufacturer reads it and turns it into a financial statement.

## 4. How the thesis got here

Botlien started (early Aug 2026) as collateral-risk monitoring for whoever finances the robot: read telemetry as an early-warning signal that a leased asset is failing or that the lessee's business is weakening. That creditor product still exists in the codebase as a risk board and is **out of scope for current work**. It is mentioned here only so the leftover tables and routes make sense.

By Aug 7 the same pipeline had an owner-facing layer: what the work was worth versus what the lease cost. By Aug 31 the buyer was sharpened to **fleet operators**, after early outreach to robot manufacturers showed they only wanted to absorb the idea into their own stack. Manufacturers are a data-access channel (non-exclusive API integrations, pursued only after operators ask), never a customer and never an exclusive partner, because exclusivity would destroy the cross-brand comparison that is the product.

## 5. Who the customer is

A fleet operator running 10 to several hundred robots across multiple sites under lease: 3PL and fulfillment companies, janitorial and building-service contractors, multi-unit restaurant or hotel groups. The person is an operations director, CFO, or founder. They want to know:

1. Did buying this robot actually work out (payback vs what was quoted)?
2. What is this robot really costing me, all in (lease plus interventions plus consumables)?
3. Is the robot company keeping its promises (SLA, uptime)?
4. What breaks next, and when?
5. Which brand is actually better on my floor, not in the brochure?

The current ask to a prospect is deliberately small: **send a 30-day telemetry export, get one page back per robot, free.** No API integration in the pitch.

Not a customer: single-location restaurant owners (they decide with cheap trials, not analysis), robot manufacturers (data source, not buyer).

## 6. What the product does today

### 6.1 The statement (`/owner`)

Four figures, each rendered with the arithmetic that produced it:

| Figure | Computed as |
|---|---|
| **Coverage** | work serviced ÷ lease invoice, prorated to the period measured. 1.2x means the robots produced 20% more value than the bill. 0.8x means they lost money. |
| **Cost per task** | invoice ÷ tasks, per kind of work (units differ across task types, never blended) |
| **Work serviced** | tasks × replacement rate, the price of buying that work from a human or a 3PL |
| **Utilization** | duty time ÷ the operating hours the owner declared |

The **replacement rate** is derived, never asserted: loaded hourly wage ÷ human throughput. A warehouse pick reads `$24.00/hr ÷ 60 picks/hr = $0.40 per pick`. A restaurant run reads `$22.00/hr ÷ 30 runs/hr = $0.73 per run`. Anyone can check it by hand.

### 6.2 Tips

Five rules turn telemetry patterns into a ranked action list with a dollar figure on each: `charge_in_peak`, `idle_in_peak`, `stall_hotspot`, `error_drag`, `fleet_imbalance`. Governing rule: **a tip may only claim work the robot already demonstrated.** Every dollar is recoverable hours × that same robot's own observed cents per active hour, never a vendor spec. Stall time is priced as "at risk" (already counted in coverage), not as upside. One tip per rule per task type, so four robots sharing one problem is one finding, not four times the money.

### 6.3 Variance

Explains why coverage moved. Decomposition: W = rate × online-hours × intensity. Availability, intensity, rate, and invoice effects sum exactly to the coverage change with no residual. Compares the two halves of the observed window, so it works on a single 30-day export.

### 6.4 Costs (`/owner/costs`)

Cost of interventions (stuck episodes priced at labor), stall timing by hour of day, brand-vs-brand on the same floor. Being redesigned (Sep 2026) from a memo-style page into an action queue with a hard 60-word visible budget: one hero figure, two or three ranked actions, everything else one layer down.

### 6.5 Fleet (`/owner/fleet`)

Multi-site fleet view, the authoritative robot count every other screen references. Site-scope filter shared across Fleet, Dashboard, and Numbers.

### 6.6 Onboarding

An operator reaches their statement by dropping a file, not by connecting an API, because vendors issue API credentials slowly and manually.

```
/signin          magic link by email, no passwords
/owner/business  one question: what kind of business is this? (restaurant, warehouse, hotel, facilities, other)
/owner/import    drop a CSV or JSONL telemetry export (writes snapshots AND rollups)
/owner/confirm   rename robots, set kind of work per robot, exclude robots
/owner/setup     five inputs per robot, prefilled from benchmarks
/owner           the statement
```

The onboarding step is **derived from data, never stored as a wizard cursor**: no rollups means import, rollups but unconfirmed means confirm, confirmed but unpriced means setup. Close the tab mid-flow and you resume exactly where you were, including across a server restart.

Why exactly one question: the export already says how many robots, which brands, how much volume, over what period. The single thing it cannot say is what kind of business this is, and that one answer selects task types, replacement rates, default operating hours, and vocabulary.

## 7. Product principles (constraints, not preferences)

1. **Value the service performed, never the revenue touched.** A robot that carries a $40 order contributed the delivery step, worth what a runner or 3PL charges, not $40.
2. **Never claim labor saved, headcount displaced, or profit.** Telemetry cannot support those claims, and making them turns Botlien into the vendor ROI calculator it exists to replace. The one allowed framing is "same work by hand": hours of that specific task a person would need, labelled as not headcount and not labor saved.
3. **Every number shows its arithmetic.** If a figure cannot be traced to inputs the operator can check, it does not ship.
4. **Unknown stays null, never guessed.** Missing telemetry fields are null. Robots with no benchmark rate are left out of totals and the board says so, rather than counted as zero. Every finance function returns null on divide-by-zero, never zero.
5. **Raw payloads are kept verbatim.** Normalization bugs must be recoverable by replay.
6. **Pipe down is not robots down.** Connector heartbeat is tracked separately from robot status. A vendor API outage must never look like a fleet outage.
7. **Counting is honest.** `mission_count` counts idle→active transitions, which are mission starts, not completions, so the label reads "runs started" everywhere. Distinct `mission_id` per bucket is used when the connector sends one.
8. **Cross-brand or nothing.** Any single-vendor dependency kills the product.
9. **No status colours in the UI.** Shape, position, and words carry the signal.
10. **Prose style everywhere** (UI copy, docs, emails): no em dashes, plain sentences, sixth-grade reading level where possible.

## 8. What exists today (the system you are designing around)

There is a working backend in production. Whatever you design must either extend it or replace it with something demonstrably better for the demo's needs, and it must respect the constraints in section 9.

### 8.1 Stack

- **Runtime:** plain Node.js ESM (`.mjs`), Node 22.5+ (hard requirement, `node:sqlite` `DatabaseSync` is unstable earlier).
- **Database:** `node:sqlite`, no ORM, no migration system. One `control.db` for accounts and sessions, plus **one SQLite file per tenant account** (`tenants/<id>.db`). Tenancy isolation is structural, not row-level.
- **HTTP:** `node:http`, hand-rolled routing in `src/board.mjs`, no framework, no template engine, server-rendered HTML with `esc()` on every interpolation.
- **Runtime dependencies:** exactly two, `@grpc/grpc-js` and `@grpc/proto-loader` (Bear Robotics gRPC stream). `npm audit` clean.
- **Tests:** `node --test`, 23 files, about 215 tests plus an end-to-end pipeline check. Fully deterministic: fixed epochs, seeded PRNG, temp databases, injected clocks.
- **Email:** Resend, magic links only. Console fallback writes links to `data/sent-mail.log` when no key is configured.
- **Hosting:** Fly.io, app `botlien`, one machine in `sjc`, one persistent volume at `/data`, TLS, health check on `/health`. Daily Fly snapshots (30-day retention) plus a daily offsite pull, restore rehearsed.
- **Observability:** events log fire-and-forget to an internal event bus (Genesis, source `botlien`). That call must never break a request.

### 8.2 Pipeline

```
connectors (sim | bear | gausium)   one duck-typed interface; tick(nowMs) drains
        │                           buffered events and reports its own heartbeat.
        │                           bear pushes (gRPC stream), gausium polls (REST),
        │                           sim generates a scripted demo fleet.
        ▼
engine.mjs                          owns time; injects nowMs everywhere (live clock,
        │                           60x demo clock, or backtest replay). ALL ingest,
        │                           including historical backfill and file import,
        │                           goes through engine.ingest so nothing drifts.
        ▼
normalize.mjs                       vendor payload → one cross-brand snapshot
        ▼
store.mjs (node:sqlite)             raw_events (verbatim) → status_snapshots
        │                           (normalized) → utilization_rollups (hourly buckets).
        │                           `at` (event time) and `received_at` (arrival time)
        │                           are kept distinct.
        ▼
finance.mjs / tips.mjs /            pure functions over rollups + robot_economics
variance.mjs / interventions.mjs
        ▼
owner.mjs → ownerModel()            one model object per request, rendered as HTML
                                    at /owner, /owner/costs, /owner/fleet and as
                                    JSON at /api/owner
```

### 8.3 What "the demo" is today

Three things share that name:

1. **`npm run demo`**: the server boots with the `sim` connector, a scripted warehouse/fulfillment fleet, a 60x clock, and a 21-day history backfill so tips and variance are populated on first page load instead of 48 real minutes in. Serves on `127.0.0.1:3230` by default. Sim models runs (start rate ∝ demand × run minutes), service windows, a demand curve, per-robot stall hotspots, and scripted outages.
2. **`?demo=1` on the production app**: renders the simulated fleet read-only for a signed-in account that has not imported anything yet. `ownerModel.demo` is true when any robot's latest snapshot has `source = 'sim'`.
3. **`prototype/botlien-prototype.html`**: a self-contained static clickable design (no network, fonts inlined) generated from `prototype/src/botlien.part.html` via `node build.cjs`. It runs on sample CSVs in `prototype/sample-data/`. This is the reference design that `src/` is being ported toward. Never edit the generated file.

### 8.4 Connectors

- **sim** (`src/connectors/sim.mjs`, `src/scenarios/demo-fleet.mjs`): the demo fleet.
- **bear** (`src/connectors/bear.mjs`): Bear Robotics v1 protos vendored in `proto/bear/` (MPL-2.0). JWT auth, robot list via REST, status via gRPC `SubscribeRobotStatus` with reconnect backoff. Built against real proto schemas, awaiting production credentials.
- **gausium** (`src/connectors/gausium.mjs`, `scripts/pull-gausium.mjs`): REST polling for Gausium cleaning robots, feeds `component_wear` and `snapshot_conditions`.
- Planned: Pudu, Keenon, Locus, Fetch. Every connector implements the same duck-typed interface and passes through `normalize.mjs`.

### 8.5 Routes

Public: `/health`, `/signin`, `/signout` (POST only).
Session required: `/owner`, `/owner/business`, `/owner/import`, `/owner/confirm`, `/owner/setup`, `/owner/fleet`, `/owner/costs`, `/api/owner`.
Operator allowlist only (`BOTLIEN_OPS_EMAILS`, deny by default): `/ops`, `/api/state`, `/` (legacy risk board, out of scope).

Every `/owner/*` path returns 303 to `/signin` when unauthenticated, so a 303 is not evidence a route is missing.

### 8.6 Security posture (audited 2026-08-12)

256-bit CSPRNG single-use magic links, HttpOnly + SameSite=Lax + Secure cookies, no session fixation, rate limiting on sign-in, structural tenant isolation, fully parameterized SQL, all output escaped, `execFile` with no shell, 25MB cap on the raw-text upload route (`POST /owner/import?name=<file>`, body is the file, no multipart parser), secrets only in environment or a gitignored `.claude/secrets.local.json`.

## 9. Constraints any backend design must respect

1. **Single writer per SQLite file.** From `fly.toml`, checked in deliberately: `min_machines_running = 1`, `max_machines_running = 1`, `auto_stop_machines = false`, `auto_start_machines = false`. Two processes writing the same SQLite file corrupt it silently. A Fly volume attaches to exactly one machine, so a scheduled sidecar cannot mount `/data`. If a design needs more than one machine, it must also move off per-file SQLite or introduce a single-writer service, and it must say so explicitly.
2. **No migration system.** `CREATE TABLE IF NOT EXISTS` will not add a column to an existing database. Adding a column today means a new table or a hand-run script. Any design that wants schema evolution has to bring the mechanism.
3. **Time is injected.** Nothing in the pipeline reads `Date.now()` directly. The demo clock runs at 60x, the backtest replays history, tests use fixed epochs. A backend that hardcodes wall-clock time breaks all three.
4. **Rollup recompute windows align to bucket boundaries.** A past bug started the window mid-bucket and the wholesale upsert ground 93% of rollups down to `sample_count = 1`, which also silently disabled a rule. Partial recompute must be bucket-local.
5. **Import writes rollups too.** `importTelemetry` used to write snapshots only, so every dropped file produced an empty statement. Any ingest path must produce rollups or trigger the rebuild.
6. **Time window anchors to the END of the telemetry, not to now.** A historical export is by definition older than "the last 30 days". Anchoring to now collapses the window to zero days.
7. **No connector means no connector.** `npm start` with no credentials runs with zero robots. It used to fall back to the simulator, and an operator importing their own export found five invented robots in their fleet.
8. **Deterministic tests stay deterministic.** No network, no real clock, no shared state between tests. `BOTLIEN_DB` and `BOTLIEN_PORT` env overrides exist so a demo never stomps a real database.
9. **Minimal dependencies.** Two runtime deps today. Every addition needs a reason that survives "what does this do that `node:` cannot".
10. **The pitch promises "one page back, no account needed."** The app currently requires sign-in and has no printable per-robot statement. Whatever the demo backend does, it should not make that gap wider.

## 10. Schema (exact, as of main)

All timestamps are `INTEGER` epoch milliseconds. Money is `INTEGER` cents. Booleans are `INTEGER` 0/1. `TEXT` columns named `payload`, `errors`, `detail` hold JSON strings.

### 10.1 Control database (`control.db`, one per deployment)

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_events_name_at ON events(name, at);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id, at);
```

### 10.2 Tenant database (`tenants/<account_id>.db`, one per account)

```sql
CREATE TABLE IF NOT EXISTS robots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_key TEXT NOT NULL UNIQUE,        -- "<connector>:<external_id>"
  connector TEXT NOT NULL,               -- sim | bear | gausium | import
  external_id TEXT NOT NULL,
  display_name TEXT,
  brand TEXT,
  model TEXT,
  category TEXT NOT NULL DEFAULT 'delivery',   -- key into BENCHMARKS, see 10.3
  fleet_id INTEGER,                      -- a "fleet" is a site
  first_seen_at INTEGER,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS fleets (      -- one row per site
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  operator TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_events (  -- verbatim vendor payload, never mutated
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector TEXT NOT NULL,
  robot_key TEXT,
  kind TEXT NOT NULL,                    -- status | heartbeat | wear | ...
  source TEXT NOT NULL,                  -- sim | bear | gausium | import
  at INTEGER NOT NULL,                   -- event time per the vendor
  received_at INTEGER NOT NULL,          -- arrival time at Botlien
  seq INTEGER,
  payload TEXT                           -- JSON
);

CREATE TABLE IF NOT EXISTS status_snapshots (   -- one normalized observation
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id INTEGER NOT NULL,
  raw_event_id INTEGER,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  connector TEXT NOT NULL,
  source TEXT NOT NULL,
  connection_state TEXT,                 -- online | offline | unknown
  battery_pct REAL,
  charging INTEGER,
  e_stop INTEGER,
  mission_state TEXT,                    -- idle | active | paused | charging | unknown
  mission_id TEXT,
  stuck INTEGER,
  moving INTEGER,
  errors TEXT,                           -- JSON array of {code, severity, ...}
  pose_x REAL,
  pose_y REAL,
  pose_theta REAL
);

CREATE TABLE IF NOT EXISTS utilization_rollups (   -- hourly by default (bucket_ms = 3600000)
  robot_id INTEGER NOT NULL,
  bucket_start_at INTEGER NOT NULL,      -- always floor(at / bucket_ms) * bucket_ms
  bucket_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  online_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,  -- duty time
  mission_count INTEGER NOT NULL DEFAULT 0,   -- distinct mission_id per bucket, else idle→active transitions
  error_count INTEGER NOT NULL DEFAULT 0,
  stuck_episodes INTEGER NOT NULL DEFAULT 0,
  battery_min_pct REAL,
  battery_max_pct REAL,
  UNIQUE(robot_id, bucket_start_at)
);

CREATE TABLE IF NOT EXISTS robot_economics (   -- set on /owner/setup, one CURRENT row, no history
  robot_id INTEGER NOT NULL UNIQUE,
  task_type TEXT NOT NULL,               -- e.g. tray_delivery, pick, cleaning_hour
  task_basis TEXT NOT NULL,              -- mission | active_hour
  rate_cents INTEGER NOT NULL,           -- replacement rate per task unit
  invoice_cents_month INTEGER,
  wage_cents_hour INTEGER,
  operating_hours_day REAL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS robot_exclusions (
  robot_id INTEGER PRIMARY KEY,
  excluded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (  -- connector liveness, separate from robot state
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,                   -- online | down | unknown
  detail TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_conditions (   -- vendor extras that do not fit a snapshot (Gausium)
  snapshot_id INTEGER PRIMARY KEY,
  robot_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  manual_controlling INTEGER,
  nav_status TEXT,
  localization_state TEXT,
  battery_voltage_v REAL,
  battery_current_a REAL,
  battery_temp_c REAL,
  charger_current_a REAL,
  vendor_report_at INTEGER
);

CREATE TABLE IF NOT EXISTS component_wear (        -- brushes, squeegees, filters, batteries
  robot_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  component TEXT NOT NULL,
  level_pct REAL,
  enabled INTEGER,
  life_span_hours REAL,
  used_life_hours REAL,
  remaining_pct REAL,
  UNIQUE(robot_id, at, component)
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);   -- business_type, confirm state, etc.

-- Written on import, read by nothing operator-facing today. Kept for future panels.
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_id INTEGER,
  robot_id INTEGER,
  lender TEXT,
  principal_cents INTEGER,
  start_at INTEGER,
  term_months INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS outcomes (    -- payment / churn outcomes for the backtest
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_id INTEGER,
  robot_id INTEGER,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  amount_cents INTEGER,
  detail TEXT,
  source_file TEXT,
  imported_at INTEGER
);
CREATE TABLE IF NOT EXISTS flags (       -- legacy risk board, out of scope
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  robot_id INTEGER,
  fleet_id INTEGER,
  connector TEXT,
  rule_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  raised_at INTEGER NOT NULL,
  cleared_at INTEGER,
  last_eval_at INTEGER NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_events_robot_at ON raw_events(robot_key, at);
CREATE INDEX IF NOT EXISTS idx_snapshots_robot_at ON status_snapshots(robot_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_active ON flags(scope, rule_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_flags_robot ON flags(robot_id, raised_at);
CREATE INDEX IF NOT EXISTS idx_heartbeats_connector_at ON heartbeats(connector, at);
CREATE INDEX IF NOT EXISTS idx_conditions_robot_at ON snapshot_conditions(robot_id, at);
CREATE INDEX IF NOT EXISTS idx_wear_robot_at ON component_wear(robot_id, at);
```

Known gap worth knowing: `loans`, `component_wear`, `snapshot_conditions`, and `pose_x/pose_y` are written on import and read by nothing operator-facing. `stuck_episodes` feeds the Costs screen only. Several roadmap panels need zero new ingestion.

### 10.3 Enumerations (from `src/rates.mjs`)

**`robots.category`** (keys of `BENCHMARKS`), each carrying `label`, `taskType`, `taskBasis`, `unit`, `humanUnitsPerHour`, `wageCentsHour`, `invoiceCentsMonth`, `operatingHoursDay`:

| category | taskType | basis | derived rate example |
|---|---|---|---|
| `delivery` | `tray_delivery` | mission | $22.00/hr ÷ 30 runs = $0.73/run |
| `bussing` | `bus_run` | mission | $22.00/hr ÷ 25 runs = $0.88/run |
| `cleaning` | `cleaning_hour` | active_hour | priced per active hour |
| `picking` | pick | mission | $24.00/hr ÷ 60 picks = $0.40/pick |
| `putaway` | putaway | mission | |
| `room_delivery` | room delivery | mission | |
| `laundry` | laundry run | mission | |

**`task_basis`**: `mission` (tasks = Σ mission_count, priced per run) or `active_hour` (tasks = Σ active_ms ÷ 1h, priced per hour; a scrubber on one long cycle is one mission but hours of work).

**Business types** (`kv` key, chosen at `/owner/business`), each selecting an allowed list of categories and a default:

| key | works offered | default |
|---|---|---|
| `restaurant` | delivery, bussing, cleaning | delivery |
| `warehouse` | picking, putaway, cleaning | picking |
| `hotel` | room_delivery, laundry, cleaning | room_delivery |
| `facilities` | cleaning | cleaning |
| `other` | all | delivery |

**`connection_state`**: `online`, `offline`, `unknown`. **`mission_state`**: `idle`, `active`, `paused`, `charging`, `unknown`. **`heartbeats.state`**: `online`, `down`, `unknown`.

## 11. The data contract the dashboard consumes

`GET /api/owner` returns the same object `ownerModel(store, nowMs, config)` builds for the HTML screens. Top-level shape (from `src/owner.mjs`):

```
{
  nowMs, fromMs, toMs, windowDays, observedDays, clamped,
  windowLabel,                     // human label for the period
  step,                            // "business" | "import" | "confirm" | "setup" | "done"
  firstRun,                        // step !== "done"
  lastImport,                      // { name, at, rows } or null
  demo,                            // true if any robot's latest snapshot source is "sim"
  excludedCount, defaultCount, unpricedCount,

  totals,                          // fleetFinancials(...) over all priced robots
  byType,                          // [{ taskType, tasks, workServicedCents, invoiceProratedCents, costPerTaskCents, ... }]
  sites,                           // [{ site, robots, fin }]
  floors, brands,                  // brand-vs-brand groupings for Costs

  robots: [                        // one per robot, best to worst
    {
      robotKey, displayName, brand, model, category, site,
      configured,                  // robot_economics row exists
      source,                      // sim | bear | gausium | import | null
      fin: {                       // robotFinancials(...), null if unpriced
        basis, taskType, taskLabel, unit, rateDerivation,
        tasks, rateCents, workServicedCents,
        invoiceCentsMonth, invoiceProratedCents,
        coverage,                  // workServicedCents / invoiceProratedCents, null if no invoice
        costPerTaskCents,          // null if tasks == 0
        laborEquivalentHours,      // workServicedCents / wageCentsHour, the "same work by hand" tile
        wageCentsHour, wageIsBenchmark,
        activeMs, capacityMs, utilizationPct, overCapacity,
        windowMs, isDefault
      }
    }
  ],

  tips, tipsHidden, tipsUpsideCents,        // buildTips(...) output
  variance, varianceSentence,               // decomposeCoverage(...) output
  interventions, interventionRows, interventionSentence, minutesPerClear
}
```

Pure-function modules behind it, all testable without a database:

- `finance.mjs`: `taskCount`, `activeMs`, `proratedInvoiceCents`, `capacityMs`, `robotFinancials`, `byTaskType`, `fleetFinancials`, `formulaLine`
- `tips.mjs`: `profileByHourOfDay`, `peakHours`, `centsPerActiveHour`, `chargeInPeak`, `idleInPeak`, `stallHotspot`, `errorDrag`, `fleetImbalance`, `buildTips`
- `variance.mjs`: `periodStats`, `decomposeWork`, `decomposeCoverage`, `varianceSentence`
- `interventions.mjs`: `robotInterventions`, `fleetInterventions`, `interventionSentence`

A backend design that keeps this contract stable lets the front end keep working while the storage and ingest underneath it change.

## 12. What the demo backend needs to do well

1. **Boot to a populated statement in seconds.** Tips and variance need 14 to 21 days of hourly rollups to say anything. Today that is a synchronous 21-day backfill through `engine.ingest` at boot.
2. **Run a fast clock without lying.** The 60x clock must move `nowMs` for every module consistently, including the window anchor, tips' peak-hour profile, and variance's two halves.
3. **Show many sites and brands.** The sales story is cross-brand, multi-site. The demo fleet needs several brands on the same floor and several sites, with a shared site-scope filter.
4. **Stay honest about what is simulated.** `demo: true` must propagate to every screen so the badge always shows.
5. **Reset cleanly.** A prospect demo should start from a known state every time, never from whatever the last demo left behind.
6. **Coexist with real tenants on the same box** without ever writing into a real tenant's file (`BOTLIEN_DB` isolation, or a dedicated demo tenant id).
7. **Feed the same `ownerModel` contract** in section 11, so demo and real data render through one code path.
8. **Eventually produce the printable one-page statement**, since that is what the outreach promises.

## 13. Where things stand (2026-09-14)

- Live at app.botlien.com, release v5. Magic-link sign-in works end to end. One real external signup has happened; that account never completed import.
- No real customer telemetry ingested yet. The core bet (operators will pay for an independent reading of their robot economics) is unproven.
- Outbound: 47 named fleet-operator targets (29 3PL/fulfillment, 8 janitorial/BSC, plus others). Ask is the free 30-day export → one-page statement.
- Bear Robotics API credentials pending. Gausium connector built.

## 14. Roadmap (priority order)

Tier 1, no new inputs: **payback tracker** (the outreach email opens with "someone quoted you a payback number, has anyone checked it since?" and the product cannot answer it), cost of interventions, brand-vs-brand, battery health curve, all-in cost per task, cycle-time tail, stall map.

Tier 2, one input each: SLA credit ledger, consumables forecast, renew/return/redeploy recommendation.

Tier 3, needs N customers: anonymized peer benchmark.

Pipeline and infra: printable per-robot statement with no account required; an intake path that turns an emailed export into a statement with minimal founder time; rate history in `robot_economics` (today one current row, so the variance rate effect is always zero and editing a rate restates both periods); Pudu and Keenon connectors; Bear live when credentials arrive.

## 15. Glossary

- **RaaS:** Robotics as a Service, the lease model most commercial robots are deployed under.
- **Telemetry:** the robot's continuous status stream: state, battery, position, errors, mission ids.
- **Snapshot:** one normalized status observation for one robot at one time.
- **Rollup:** an hourly bucket aggregating snapshots into online time, active (duty) time, mission starts, errors, stuck episodes, battery range.
- **Coverage:** work serviced ÷ lease invoice for the period.
- **Replacement rate:** what the same unit of work costs from a human or 3PL, derived as loaded wage ÷ human throughput.
- **Fleet / site:** the `fleets` table; one row is one physical location.
- **Heartbeat:** connector liveness, tracked separately from robot state.
- **Statement:** the operator-facing one-page financial reading of a robot or fleet for a period.
- **Intervention:** a human having to go clear a stuck robot, priced at labor.
