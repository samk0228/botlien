# Backend plan v1: connect a fleet, watch the dashboard fill in

Written 2026-09-23 after reading the whole backend (`src/`) and the live
Demo (artifact GCaGNEseYu63EeQMDghUm9, version 1790193746-1274, which now
includes the tab strip, Level 4 records, Shift brief, Fix list and What if).

## Where we are today

| Piece | State |
|---|---|
| Sign in | Real. Magic link, per-account SQLite file (`data/tenants/{id}.db`). |
| Getting data in | **File upload only** (`importer.mjs`). No customer can connect an API. |
| Connectors | `gausium.mjs` real HTTP client. `bear.mjs` real code but the gRPC stream is not wired (`bear.mjs:160`). `sim.mjs` fake. No Pudu, Keenon, Locus, Fetch, OrionStar. |
| Where connectors run | Only the single ops database, and in production **none run** (secrets are not shipped to Fly). No per-tenant engine. |
| Credentials | One process-wide file. No per-customer storage, no "connect" screen. |
| Served screens | Dashboard, Fleet, Costs, Numbers + onboarding. Server-rendered HTML. |
| Demo screens | Those plus Coverage, Trends, Payback, Contract, Decisions, Benchmark, Incidents, Vendors, Evidence, Robot hub, tab strip, drawer records, Shift brief, Fix list, What if. All computed in the browser from hard-coded tables. |
| Derived server-side | Coverage, cost per task, utilization, interventions, brand vs brand, variance, tips, 9 risk rules. **Not** payback, credits, incidents, periods. |

## The idea: one data contract

The Demo already does all its math in the browser from about 20 tables
(`ROBOTS`, `CONFIRM`, `SETUP`, `DAILY`, `DOWNTIME`, `KEEPING`, `CONTRACT`,
`PERIODS`, `SAFETY`, `TICKETS`, `PLACES`, `SITES`, `EQUIP_COST`, `BENCH`,
`RATE_HISTORY`, `PART_PRICE`, `VENDOR_RESPONSE_HOURS`, `PEOPLE`, `SHIFTS`,
`ROBOT_DELTA`). So the backend's job is to produce **those same tables for
each customer, from their real data**, and serve them as JSON:

```
GET /api/v1/fleet?period=2026-08   ->  { sites, robots, units, setup, daily,
                                         downtime, keeping, contract, periods,
                                         safety, tickets, places, parts, ... }
```

The Demo becomes the product by replacing its constants with that response.
Demo mode serves a fixture made from today's constants, so the demo keeps
working byte for byte and the real app is the same code on real data. Every
screen Sam designed ships at once instead of being rebuilt one server page
at a time.

## Where each table comes from

| Demo table | Source once connected | Kind |
|---|---|---|
| `SITES` | Vendor site/map list, renamed by the owner | vendor + owner |
| `ROBOTS` (name, model, brand, site) | Vendor robot list | vendor |
| `CONFIRM.units` / `DAILY` | Mission or task counts per day (rollups; Gausium task reports) | vendor |
| `ROBOTS.duty/hours` | Active ms over scheduled hours (rollups) | derived |
| `SETUP.hours` | Owner sets scheduled hours a day | owner |
| `DOWNTIME` (date, start, minutes, cause) | **New derivation**: stuck, error and e-stop episodes from status snapshots, with the place from pose | derived |
| `KEEPING` (stalls, hand, stalled) | Stuck episodes, manual-control hours, stalled hours (already partly computed in `interventions.mjs`) | derived |
| `SAFETY` | E-stop and collision events from telemetry, plus owner notes | vendor + owner |
| `PLACES` / place names | Vendor map zone names where the API has them, otherwise the owner names a grid once | vendor or owner |
| `parts` | `component_wear` (Gausium today) | vendor |
| `CONTRACT` (start, term, payback promise, uptime promise) | Owner types it once, or it's read from the lease PDF later | owner |
| `EQUIP_COST`, rates, wage, invoice | Owner inputs on Numbers (already stored in `robot_economics`) | owner |
| `PERIODS` | Billing periods cut from the contract start day, closed nightly | derived |
| `TICKETS` | Owner logs them, later a forwarded-email inbox | owner |
| `BENCH` | Botlien benchmark table (already in `rates.mjs`) | ours |
| `ROBOT_DELTA` | Coverage this period against last | derived |

A new customer never sees empty charts: whatever a table cannot be filled
from yet shows the Demo's existing `not reported` / `you set this` states.

## Build order

**Phase 1. The contract API and the served Demo (about 1 week)**. Built 2026-09-23 on branch `backend-data-contract`

Status: migrations, `src/contract.mjs`, `GET /api/v1/fleet`, and `GET /app`
(the Demo served with the account's contract injected, via
`prototype/src/live-adapter.cjs`) are done. Repo prototype re-synced to live
Demo version 1790193746-1274. 274 tests pass. Browser sweep: every screen
renders with no error, NaN or "undefined" on (a) the sim fleet, one site,
one month; (b) a two-site account where one site has no earlier month, at
every scope; (c) `?demo=1`, still 2.39x / 13 robots / 6 periods.

Known follow-ups found by the sweep: about 40 strings still assume the
demo's shape ("all 3 sites", "6-month average", "13 robots"); the Shift
brief can pick a "watch today" robot with zero stops; stall places read
"near x, y m" until a site names its aisles; a robot with no lease typed
falls back to contractFor()'s default terms silently.

1. Add a migration runner to `store.mjs` (there is none today).
2. `fleetData(store, period)` in a new `src/contract.mjs` that builds every
   table above from the store. Unit tests against a seeded fixture.
3. `GET /api/v1/fleet` behind the session.
4. Port the Demo into `src/app/` as the served frontend. Its constants load
   from the API. `?demo=1` loads the fixture.
5. Parity test: the fixture run through the Demo's own compute functions
   gives the same headline figures as the published Demo (2.39x, the 13
   robots, aisle 14 with 5 stops).

**Phase 2. Per-customer live connections (about 1 to 2 weeks)**. Steps 1, 2, 3 and 5 built 2026-09-23.

Status: `src/vault.mjs` (AES-256-GCM, key from `BOTLIEN_SECRET_KEY`, refuses
in production without it), `connections` table in the control DB,
`src/connections.mjs` (vendor registry, live key test, sealed save, and
`createTenantSync`, which runs each connected account through `createEngine`
against its own store under its own timeout), `/api/v1/connections`
(GET, POST, DELETE) and the `/owner/sources` Data sources page. The fleet
contract carries `sources`. End-to-end check against a local stand-in for
Gausium: magic-link sign-in, bad keys refused, good keys connected, first
sync about 10 s later, 3 robots in the account's own store and in
`/api/v1/fleet` and `/app`, no plaintext key on disk. 284 tests pass.
Step 4 built the same day: on first sync the connection pulls the last 90
days of Gausium task reports in the background (`connector.history()`,
`gausiumTaskReportToEvents`, `pullHistory`), lands them through
`engine.ingest` as the samples the live poll would have written, rebuilds
rollups, and records progress in the account's store (`history.gausium`),
shown on Data sources. Runs once per connection; one robot's failure is
listed and the rest land. End-to-end: 90 past jobs landed in about 18 s,
31 days of work on the dashboard. 287 tests pass.
BOTLIEN_SECRET_KEY is staged on Fly (owner info@botlien.com) with a backup
in .claude/secrets.local.json. Still open: the Demo's own Data sources screen calling this
API (a Claude Design job), and a real Gausium account to try it on.

1. `connections` table in the control DB: tenant, vendor, encrypted
   credentials (AES-256-GCM, key in a Fly secret), status, last sync, last
   error.
2. `Data sources` screen: pick a vendor, paste keys, `Test connection`
   checks them live before saving. Shows each source's last sync and errors.
3. A scheduler that runs every tenant's connectors on the existing engine
   (`engine.mjs` already does tick, ingest, rollup, rules), one tenant at a
   time with a timeout, heartbeats per tenant.
4. History on connect: pull the last 90 days where the vendor allows it
   (Gausium task reports) so the dashboard fills in minutes, not a month.
5. Gausium first because the client is built and the operator supplies
   their own keys. Bear second (wire the gRPC stream). Every connector logs
   to Genesis (`genesis-log botlien-sync ...`, `needs_user` on failure).

**Phase 3. The derivations (about 1 week)**. Period close, per-period uptime and credit built 2026-09-23.

Status: closed periods are now really closed. Migration 4 adds
`period_closes` and `period_robot_figures`. `closePeriods()` in
`src/contract.mjs` freezes every period that has ended, is a grace day past
its end, and whose telemetry has moved past it (so an export that stops
mid-month does not freeze half a month). It stores each site's coverage and
utilization and each robot's units, work value, invoice, hours, incidents,
downtime, delivered uptime, promised uptime and credit. From then on the
contract reads those figures for that period, so changing a rate or invoice
never rewrites a statement. It runs before `/api/v1/fleet` and `/app` are
served (only once the account's fleet is confirmed, so benchmark invoices are
never frozen) and after each connector sync. Uptime and credit are worked
out for every period, not just the open one; credit needs a lease with a
stated uptime promise and is null (not zero) without one. The page shows
"Closed <day it froze>" and "Numbers are locked" only for frozen periods,
and "Closing" in the grace day. The adapter passes `PERIOD_FIGURES` (per
robot row and totals) for the Period and Contract pages to use. 305 tests.

Not done yet from this phase: naming places from robot positions (stalls
still read "near x, y m"), a payback series from real history before the six
periods (the page still back-projects), and a Downtime table for closed
periods (their episodes feed uptime and credit but are not listed). If the
owner changes the billing anchor day, periods frozen on the old boundaries
stop matching and the new ones compute fresh.

Incidents from snapshots, pose to place, billing periods and nightly close,
contract and credit, payback series, safety events. Each one replaces a
hard-coded Demo table with a computed one, with a test that runs the sim
fleet through it.

**Phase 4. Any robot, not just two vendors (about 1 week)**. Built 2026-09-23.

Status: `POST /api/v1/events` takes robot status pushed with an account's API
key (`Authorization: Bearer blk_...`), up to 1,000 events a request and 120
requests a minute per key. Only `robot_id` and `at` are required; the other
fields use the file import's names, and name/brand/model/category are read
the first time a robot is seen. Events land through the engine's own ingest
and refresh only the hourly buckets they touch. Keys live in the control DB
as SHA-256 hashes, five per account, made and revoked on Data sources (shown
once) or through `/api/v1/keys`; pushed data then shows as a source on the
dashboard. The import now reads each row's brand, model, name, kind of work
and position where the file has them, and takes a column map
(`?columns={"robot_id":"Serial No","at":"Time"}` on `/api/v1/setup/import`)
for an export whose headers we do not recognise; a file with no usable rows
comes back with its headers so a screen can ask. We deliberately did not
hard-code Locus, Fetch, Pudu or Bear export formats: we have no real export
from any of them, and a guessed format would break on the first real file.
The column map covers them until we see real files. 338 tests.

1. `POST /api/v1/events` with a per-customer API key, taking the
   normalized status shape, so integrators and other vendors can push.
2. File import reads the brand column and knows the Locus, Fetch, Pudu and
   Bear export formats.

**Phase 5. Jobs**. Morning brief email built 2026-09-23.

Status: `src/brief.mjs` builds the brief from an account's contract with the
dashboard card's own rules (watch today, where they got stuck, parts to
order, money waiting on a vendor, one thing to do) and renders it as text
and HTML email. A browser parity check runs the page's `briefData()` and the
server's `buildBrief()` on the same account and gets the same robot, spots
and fix. Two deliberate differences from the page: credit is only mentioned
against a lease the owner entered (the page assumes 95%), and a part with no
reported life is not listed. `src/brief-job.mjs` checks every minute and
sends each account's brief on the owner's days, from their chosen time and
for three hours after it, once a day (marked sent before sending, so a crash
never sends twice), only for confirmed fleets and never on data more than two
days old. Email addresses only (texts are not sent), at most three per
account. Every email carries its own signed unsubscribe link
(`/brief/stop`, a confirm page plus POST, so mail scanners cannot
unsubscribe anyone) and a List-Unsubscribe header. With no signing key it
sends nothing. **It only really sends with `BOTLIEN_BRIEF_SEND=1`**; without
it the job logs what it would have sent. 317 tests.

Alert emails built the same day (`src/alerts.mjs`, `BOTLIEN_ALERTS_SEND=1`
to send). One event is one email: a period closing sends one "statement
ready" email that also names robots under their lease and credit owed; a
daily check (from 7 AM local) bundles parts at or under 15%, parts past their
rating on a robot still running, and duty time under a fifth of the schedule
for seven days (only when the feed is fresh); a vendor sync down for 30
minutes is one email until it recovers. Every finding is remembered so it
does not repeat (a low part until replaced, weekly for the rest). The first
run marks periods already closed as told, so switching alerts on sends no
backlog. Alerts go to the account's email with a signed stop link. The page's
Alerts table now shows when each rule last sent. "A promise is missed"
(payback) is not sent: payback is only worked out in the browser.

Backups check built the same day. The nightly offsite backup
(`scripts/backup-offsite.sh`, launchd on the Mac mini) had failed every night
from Sep 10 to Sep 23 because the Fly CLI on the mini lost its login, and its
failures only reached the local Genesis dashboard. Now each verified backup
is marked inside production (`scripts/backup-mark.mjs`, control DB `meta`),
and the app (`src/backup-check.mjs`) emails ops (`BOTLIEN_OPS_EMAILS`) once a
day while that mark is more than 36 hours old, or when the server has been up
two days with no mark. The script's failure message now says to run
`fly auth login` when that is the cause. A backup was taken and verified by
hand on Sep 23 (3 databases). Worth doing: give the backup job a long-lived
Fly token so it does not depend on an interactive login.

Phase 5 is done apart from the payback alert, which waits for payback to be
computed on the server.

Morning brief email at the time the owner set (Resend is already wired),
alert rules, period close, backups check.

## Risks worth saying out loud

- **We have no vendor credentials for any real customer yet.** Bear's were
  requested 8/4 and never came. The first real connection happens when an
  operator hands us keys, so file import stays the day-one path.
- **Locus and Fetch, the Demo's main makes, have no connector and we have
  not confirmed they offer a customer API.** Needs checking before promising
  live sync for them.
- Single Fly machine with SQLite per tenant is fine for the first 20 to 50
  customers. The scheduler must not let one slow vendor stall the rest.
- The container runs as root and there is no migration system. Both get
  fixed in Phase 1 before customer credentials are stored.

## Owner inputs (built 2026-09-23, after Phase 2)

Nothing an owner typed in `/app` was saved; a reload lost it. Now: migration 2
adds `owner_inputs`; `src/inputs.mjs` whitelists 5 per-robot keys (invoice,
hours, work, excluded, lease) stored by robot id and 22 account keys (wages,
roster, custom work, fixes, plans, brief settings, claims, tax, layout,
names), validates every batch all-or-nothing, and writes invoice, hours and
fully stated leases through to `robot_economics` and `robot_contracts`.
`POST /api/v1/inputs` saves; the contract carries `inputs`; the page restores
them in `bootScreen` and autosaves 600 ms after any redraw that changed one
(with a `pagehide` beacon). A test fails if the page's key list and the
server's ever differ. Browser check: five kinds of edit survived a reload and
reached the server tables. 295 tests pass.

Next: make `/app` the home after sign-in and wire the Demo's first-run
screens (business, connect or upload, confirm fleet) to the backend. Sign-in
still lands on `/owner/business`.

## /app is home (built 2026-09-23)

Sign-in and the front door send a signed-in owner to `/app`. `/app` sends an
account with no fleet to its first-run step (`/owner/business`, then
`/owner/import` with a link to Data sources, then `/owner/confirm`), and
confirming lands in `/app`. The old statement pages (`/owner`,
`/owner/fleet`, `/owner/costs`) forward to the same screen in `/app` unless
`?demo=1`. The funnel's `activated` event now fires when the dashboard data
is served, under the old rule (numbers saved and a real ratio). In a live
account the Demo's Import, connect, business and confirm buttons go to those
real pages, and Settings > Data sources lists the account's real
connections. End-to-end: a new account walked sign-in, business, Gausium
connect with history, confirm, dashboard. 296 tests pass.

Still to design: the Demo's own first-run screens wired to these endpoints,
so first run happens inside /app rather than on the plain server pages.

## Live tables that were still demo data (built 2026-09-23)

A scan of the page for tables a live account still filled from the demo
found six that showed wrong data to a real customer. Now:

- **Calendar range** (`CAL_MIN`/`CAL_MAX`, and the month it opens on) comes
  from the account's own periods, not March to September 2026.
- **People** comes from the contract's `people` (the signed-in account's
  email as Owner; one sign-in per account until team invites exist).
- **Rate history** is a real log. Migration 3 adds `rate_changes`. The page
  sends the rate it is using per kind of work (`rates` on
  `POST /api/v1/inputs`, worked out from wage, throughput and roster), and
  the server adds a row only when it differs from the last one, signed with
  the account's email. The contract carries it as `rateHistory`.
- **Alert rules** keep their definitions but go to "You" and read "Never
  sent" until the Phase 5 sending job exists.
- **Vendor tickets**: open count and median days to first reply are worked
  out from the account's own tickets.
- **Vendor contacts** are empty on a live account (the demo's addresses are
  made up), so email buttons open a blank draft.

Still demo defaults on purpose: shifts (day/swing/night), vendor response
hours (24 h unless a contract says otherwise), part prices, equipment costs,
and the aisle grid a site uses until it names its places. 301 tests pass;
browser sweep clean on demo (1,078 combos) and the live sim (1,217).
