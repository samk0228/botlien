# Botlien

Real-time collateral risk monitoring for financed and leased commercial
service robots. Robot telemetry (Bear Robotics first, Pudu next) is normalized
into one cross-brand schema and run through transparent, rules-based
early-warning flags for whoever holds the financial risk on the robot: a RaaS
operator, or eventually a lender. PD signals (borrower distress read through
asset behavior) and LGD signals (collateral condition) are kept strictly
separate.

There are two boards over one pipeline, for two different buyers:

- `/` **risk board**, for whoever holds the financial risk: PD/LGD/infra flags.
- `/owner` **owner board**, for the business owner leasing the robots: what the
  work was worth against what the lease costs.

## Quick start

```bash
npm test          # full deterministic suite (no network, no credentials)
npm run demo      # simulated 5-robot fleet at 60x speed → http://127.0.0.1:3230
npm run e2e       # end-to-end pipeline check, exits 0/1
npm start         # live mode; uses Bear if credentials exist, else demo fleet

node scripts/rebuild-rollups.mjs [--dry-run]   # recompute rollups from snapshots
```

## The owner board

Four figures, each shown with the arithmetic that produced it:

| Figure | Computed as |
|---|---|
| Coverage | work serviced ÷ lease invoice, prorated to the period measured |
| Cost per task | invoice ÷ tasks, **per kind of work** (units differ across task types) |
| Work serviced | tasks x replacement rate, the price of buying that work elsewhere |
| Utilization | duty time ÷ the operating hours the owner declared |

What it values is the **service performed**, never the revenue touched. A robot
that runs a $40 order contributed the fulfillment step, worth what a runner or
3PL charges for it, not $40. Claims that need payroll or POS data (labor
actually saved, profit, what the business would look like without the robots)
are out of scope by design, because that is the line between an independent
reading and vendor ROI marketing.

Two counting caveats, stated in the UI as well as here:

- `mission_count` counts idle→active transitions, which are mission **starts**,
  not completions. Telemetry cannot show that a run finished, so the label reads
  "runs started" everywhere. It is also sensitive to polling cadence; counting
  `DISTINCT mission_id` would be cadence-independent and is the next upgrade.
- Robots whose category has no benchmark rate are left out of the totals rather
  than counted as zero, and the board says so.

Economics live in `robot_economics` (one row per robot, set on `/owner/setup`).
Absent a row, the board falls back to the category benchmarks in `src/rates.mjs`
and marks the figure as a default.

The demo is the sales prop: within ~2 real minutes the board shows
utilization-drop and battery-degradation flags accumulating, and a scripted
connector outage turns the heartbeat strip red WITHOUT raising robot flags,
which demonstrates the core data-quality idea (pipe down ≠ robots down).

## Architecture

```
connectors (sim | bear)          one duck-typed interface; tick(nowMs) drains
      │                          buffered events + reports its own heartbeat
      ▼
engine.mjs                       owns time; injects nowMs everywhere (live
      │                          clock, 60x demo clock, or backtest replay)
      ▼
store.mjs (node:sqlite)          raw_events (verbatim) → status_snapshots
      │                          (normalized) → utilization_rollups; `at` vs
      │                          `received_at` kept distinct for the backtest
      ▼
rules.mjs + flags.mjs            6 rules as data; raise → escalate →
      │                          hysteresis clear; history never deleted
      ▼
board.mjs                        127.0.0.1 dashboard: fleet, PD/LGD/infra
                                 flags, connector heartbeat strip
```

Key invariants:
- Connector heartbeat is tracked separately from robot status; robot-offline
  rules are gated on a healthy pipe, so one robot dark ≠ vendor outage.
- Unknown telemetry fields stay null, never guessed; raw payloads are kept
  verbatim so normalization bugs are recoverable.
- Every flag threshold is a v1 hypothesis until backtested against real
  outcomes (`src/importer.mjs` ingests historical telemetry + payment/churn
  outcomes into the same tables for exactly that purpose).

## Bear credentials (when they arrive)

1. Vendor the protos: see `proto/bear/README.md`.
2. Create `.claude/secrets.local.json` (gitignored):
   ```json
   { "bear": { "credentials": { /* Bear's credentials JSON */ } } }
   ```
3. `npm start` — auth is JWT via `authorizeApiAccess`, robot list via REST,
   status via gRPC `SubscribeRobotStatus` with reconnect backoff.

## Conventions

Plain Node ESM (`.mjs`), Node 22+, `node:sqlite`, `node --test`, no
framework. Tests are fully deterministic: fixed epochs, seeded PRNG, temp
DBs, injected clocks, `BOTLIEN_NO_GENESIS=1`. Vault integration: events log
to Genesis (source `botlien`) fire-and-forget.

## Team

Samuel Kim (technical) · Antonio D'Angelo (GTM). Working brief and the
week-6 validation criteria live in the founders' shared docs.
