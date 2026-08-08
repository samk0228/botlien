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

## Onboarding

An owner reaches their statement by dropping a file, not by connecting an API.
Vendors issue credentials manually and slowly, so the API path comes second.

```
/owner/business what kind of business is this?  →  one question, four options
/owner/import   drop a CSV or JSONL export      →  writes snapshots AND rollups
/owner/confirm  rename, set kind of work, exclude
/owner/setup    five inputs per robot, prefilled
/owner          the coverage statement
```

**Why exactly one question.** A telemetry export already says how many robots
there are, which brands, how much volume, and over what period, so we do not ask
any of it. The single thing it cannot say is what kind of business this is, and
nothing distinguishes a restaurant from a warehouse in a status stream. That one
answer selects the kinds of work on offer, the replacement rates, the default
operating hours, and the vocabulary: a warehouse reads "picks started" priced at
`$24.00/hr ÷ 60 picks per hour = $0.40`, where a restaurant reads "runs started"
at `$22.00/hr ÷ 30 runs per hour = $0.73`.

The step is **derived from data**, never stored as a wizard cursor: no rollups
means import, rollups but unconfirmed means confirm, confirmed but unpriced
means setup. An owner who closes the tab mid-flow resumes exactly where they
left off, including across a restart. `/owner` redirects into the flow rather
than rendering a statement of zeros; `?demo=1` shows the simulated fleet
read-only.

**Why the confirm step exists.** A telemetry export says nothing about what kind
of work a robot does, so `importTelemetry` applies one category to every robot in
the file. Left uncorrected, a floor scrubber is priced per run instead of per
hour, wrong by an order of magnitude. Correcting the kind of work is what makes
the arithmetic downstream correct.

Uploads POST raw text to `/owner/import?name=<file>` rather than multipart, so
there is no parser and no dependency. Cap is 25MB for that route only.

`npm start` with no Bear credentials now runs with **no connector at all**. It
used to fall back to the simulator, which meant an owner importing their own
export found five invented robots mixed into their fleet.

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
connectors (sim | bear | gausium) one duck-typed interface; tick(nowMs) drains
      │                          buffered events + reports its own heartbeat.
      │                          bear pushes (gRPC stream), gausium polls (REST)
      ▼
engine.mjs                       owns time; injects nowMs everywhere (live
      │                          clock, 60x demo clock, or backtest replay)
      ▼
store.mjs (node:sqlite)          raw_events (verbatim) → status_snapshots
      │                          (normalized) → utilization_rollups; `at` vs
      │                          `received_at` kept distinct for the backtest.
      │                          component_wear + snapshot_conditions hold the
      │                          vendor extras that do not fit a snapshot
      ▼
rules.mjs + flags.mjs            9 rules as data; raise → escalate →
      │                          hysteresis clear; history never deleted
      ▼
board.mjs                        127.0.0.1 dashboard: fleet, asset condition,
                                 PD/LGD/infra flags, connector heartbeat strip
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

## Sending real sign-in email

Sign-in is a magic link, so mail delivery is not a feature of the product, it
is the front door. With no credential the mailer falls back to console mode and
writes every link to `data/sent-mail.log`, which is how the flow is developed
and tested. That fallback is why a missing key looks like "no email arrived"
rather than an error.

Two things have to be true before a stranger can sign in, and each one alone is
not enough:

**1. A sending credential.** [Resend](https://resend.com), already implemented
in `src/mailer.mjs`.

- Add `botlien.com` as a domain in Resend and paste the DKIM/SPF records it
  gives you into Cloudflare (Botlien's nameservers are `maisie`/`nick.ns.
  cloudflare.com`). Use the `send.botlien.com` subdomain it offers, which leaves
  the existing Hostinger MX records alone so inbound mail to `@botlien.com`
  keeps working.
- Until a domain is verified, Resend only delivers to the address that owns the
  account. That is fine for demoing to yourself and is exactly why a shared
  demo fails while your own test passes.
- Then create `.claude/secrets.local.json` (gitignored):
  ```json
  { "resend": { "api_key": "re_...", "from": "Botlien <info@botlien.com>" } }
  ```
  `from` is optional; it defaults to `Botlien <info@botlien.com>`. The
  environment variables `RESEND_API_KEY` and `BOTLIEN_MAIL_FROM` override both.

**2. A public address in the link.** `BOTLIEN_BASE_URL` is what gets baked into
every emailed link, and it defaults to `http://127.0.0.1:<port>`. A link to
`127.0.0.1` resolves to *the recipient's* machine, so a customer receives a real
email pointing at a dead page while the send looks successful from here. Boot
warns when live mail and a loopback base URL are configured together. On a real
host set `BOTLIEN_BASE_URL=https://app.botlien.com` and
`BOTLIEN_SECURE_COOKIES=1`.

## Conventions

Plain Node ESM (`.mjs`), Node 22+, `node:sqlite`, `node --test`, no
framework. Tests are fully deterministic: fixed epochs, seeded PRNG, temp
DBs, injected clocks, `BOTLIEN_NO_GENESIS=1`. Vault integration: events log
to Genesis (source `botlien`) fire-and-forget.

## Team

Samuel Kim (technical) · Antonio D'Angelo (GTM). Working brief and the
week-6 validation criteria live in the founders' shared docs.
