# Botlien

Real-time collateral risk monitoring for financed and leased commercial
service robots. Robot telemetry (Bear Robotics first, Pudu next) is normalized
into one cross-brand schema and run through transparent, rules-based
early-warning flags for whoever holds the financial risk on the robot: a RaaS
operator, or eventually a lender. PD signals (borrower distress read through
asset behavior) and LGD signals (collateral condition) are kept strictly
separate.

## Quick start

```bash
npm test          # full deterministic suite (no network, no credentials)
npm run demo      # simulated 5-robot fleet at 60x speed → http://127.0.0.1:3230
npm run e2e       # end-to-end pipeline check, exits 0/1
npm start         # live mode; uses Bear if credentials exist, else demo fleet
```

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
