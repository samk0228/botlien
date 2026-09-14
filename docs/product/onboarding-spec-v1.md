# Botlien: Onboarding Specification

## The one job

Get an owner who already leases robots from arriving at botlien.com to seeing
**their own coverage ratio**, in one session, without a sales call and without
waiting on a vendor.

Everything below serves that. Where a step does not move an owner closer to
their own number on screen, it does not belong in onboarding.

**Activation target: coverage ratio on screen within 10 minutes of arrival.**
That is the metric onboarding is judged on. Not signups, not completed profiles.

---

## The sequencing decision, and why it is not obvious

The natural instinct is to ask the owner about their robots first, then connect
data. That order cannot work.

Onboarding's first input is "what does each robot do," which presumes we already
know **which robots exist**. We only learn that from their telemetry. A form
asking an owner to type in robot names before we have their data is asking them
to do our job, and it is the single fastest way to lose them.

So data comes first, and the five inputs are asked **per discovered robot**, with
the robot's name, brand, and model already filled in from the file:

```
  S0  Land
  S1  Account
  S2  Connect data   ─┐
  S3  Confirm fleet   ├─  we learn what robots exist
  S4  Five inputs    ─┘   (asked per discovered robot)
  S5  Coverage
```

A second consequence: because the file gives us each robot's category, the five
inputs arrive **already prefilled with benchmark defaults**. The owner's job
shrinks from "fill in a form" to "correct the two numbers you care about." That
is the difference between a five-minute onboarding and an abandoned one.

---

## S0 · The front door

`botlien.com`, before any account exists.

Two tracks, sized to the account. A demo-gated door in front of a $99/month
product cannot pay for itself; a self-serve-only door leaves the large accounts
unserved.

**Primary (self-serve).** Headline states the job plainly: *"Find out whether
your robots are covering their lease."* One button: **Start free**. No pricing
on this screen. Pricing appears when they reach a paid feature, never before
they have seen their own number.

**Secondary (sales-led).** A quieter link: *"Running robots across five or more
sites? Book a walkthrough."* This is the Operator track and the only path that
routes to a human.

Below the fold, three proof points, all of which are true and none of which are
claims about outcomes:

- Works with the export you already have from Bear Universe or Pudu Cloud
- Every figure shows the arithmetic that produced it
- No vendor credentials needed to start

**Do not** put a testimonial, a logo wall, or an ROI claim on this page. We have
no customers yet and the product's whole position is that it does not make the
claims vendors make.

---

## S1 · Create account

The shortest screen in the product. Email and password, or Google sign-in. That
is all.

**Do not ask** for: company name, role, fleet size, robot brand, how they heard
about us, or a phone number. Every one of those is answerable later from their
data or not needed at all, and each costs conversion at the exact moment
intent is highest.

One line under the button: *"No card. Nothing is charged until you choose a paid
plan."*

---

## S2 · Connect your data

The most important screen in onboarding, because it is where the funnel breaks
if it is going to.

### Primary path: drop a file

A drop zone occupying the majority of the screen.

> **Drop your usage export here**
> A Bear Universe or Pudu Cloud CSV is enough. Your coverage statement fills in
> within minutes, history included, no credentials to chase.
> [ Choose a file ]

Accepts `.csv` and `.jsonl`. Multiple files allowed.

### Secondary path: connect the API

Positioned lower and visually quieter, framed as the upgrade rather than the
alternative:

> **Connect your robot API for live data**
> Once the statement is running, live telemetry keeps it current daily instead
> of per export. Vendor credentials can take weeks, so this comes second.
> [ Request credentials ]

**This ordering is load-bearing.** Bear issues API credentials manually and
slowly; ours were requested on 2026-08-04 and have not arrived. Leading with the
API means the funnel stalls for days at the moment of highest intent. Leading
with the file means an owner is looking at their own coverage number before they
finish their coffee.

### Third path: no file yet

A small link: *"Don't have an export handy? See a sample statement."* Loads the
demo fleet read-only, clearly badged, with a persistent button to come back and
upload. This exists so an owner who arrived curious does not hit a dead end.

### What we accept in the file

The importer already recognizes these column names, first match wins, case
insensitive:

| Field | Accepted column names | Required |
|---|---|---|
| Robot identifier | `external_id`, `robot_id`, `robot_key`, `robot`, `serial` | **Yes** |
| Timestamp | `at`, `timestamp`, `time`, `ts` | **Yes** |
| Connection state | `connection_state`, `connection`, or boolean `online` | No |
| Battery | `battery_pct`, `battery`, `battery_percent` | No |
| Mission state | `mission_state`, `state` | No |
| Mission id | `mission_id` | No |
| Charging / e-stop / stuck / moving | `charging`, `e_stop`/`estop`, `stuck`, `moving` | No |
| Errors | `errors`, `error_codes` | No |

Timestamps parse from ISO strings, epoch seconds, or epoch milliseconds.
Booleans accept `1/true/yes/y` and `0/false/no/n`; anything else becomes null
rather than a guess.

**Two robots must be true of the upload UI:**

1. It names what it found before asking for anything: *"Read 41,200 rows across
   5 robots, Aug 4 to Sep 3."*
2. It reports what it could not read, per column, rather than silently dropping
   rows. *"312 rows had no timestamp and were skipped."*

---

## S3 · Confirm your fleet

A short screen, but skipping it is a mistake. This is where the owner sees that
we understood their data, which is what earns permission to ask for money
figures on the next screen.

A list of discovered robots, each showing name, brand, model, and the date range
of telemetry we have. Each row lets the owner:

- Rename it to what they actually call it ("Servi 2" → "Patio runner")
- Correct the kind of work if we guessed wrong
- Exclude it, for a robot they no longer lease

Header line: *"We found 5 robots in your export. Is this your fleet?"*
Button: **Yes, set my numbers**.

---

## S4 · Set your numbers

One screen. Exactly five inputs per robot. Everything prefilled.

Header: *"Five inputs per robot. Everything is prefilled. Accept it as-is, or
correct the two you care about."*

| # | Input | Prefilled from | Required |
|---|---|---|---|
| 1 | What it does | Robot category from the file | Yes |
| 2 | Monthly lease invoice | Benchmark for that brand/model | Yes |
| 3 | Replacement rate per task | Derived: wage ÷ throughput | Yes |
| 4 | Loaded hourly wage | Published benchmark | No |
| 5 | Operating hours per day | Benchmark for the venue type | Yes |

Beneath input 3, always visible, the derivation:

> `$0.73 per run = $22.00/hr ÷ 30 runs per hour`

Editing the wage recomputes the rate. Editing the rate directly detaches it from
the derivation and marks it as the owner's own figure. Both directions must
work, because some owners know their wage and some know what a delivery service
charges them.

One button: **Save and see my numbers**.
One note: *"Wage is optional. It only feeds the derivation shown under each rate."*

### Validation, exactly

These rules are already implemented in `parseSetupForm`:

- Currency inputs strip `$`, commas, and whitespace before parsing
- Rate must be present and greater than zero, else that robot is rejected with a
  field-level message and **no partial write occurs**
- Invoice, wage: optional; blank means unknown, stored as null, never zero
- Operating hours must fall in `0 < h ≤ 24`
- Negative numbers, `NaN`, and `Infinity` are rejected outright, never clamped
- A robot absent from the submission is left untouched rather than cleared
- Invoices above $10,000,000/month are treated as a typo and rejected

On any error, re-render the form with **the owner's submitted values preserved**.
An owner who mistypes one invoice must not have to redo the other four fields.

---

## S5 · Your coverage statement

The activation moment. The owner lands on their coverage ratio.

First-visit only, a single dismissible line above the statement:

> *This is your coverage: the work your robots performed, valued at what that
> work costs to buy elsewhere, against what you pay to lease them. Every figure
> shows its arithmetic.*

Robots still on benchmark defaults carry the `benchmark` chip with a direct link
back to S4. The statement is fully usable in that state; nothing is gated.

**Onboarding ends here.** No tour, no checklist, no confetti.

---

## Where money enters

Never during onboarding. The paywall sits behind the aha, not in front of it.

| Tier | Who | Price | Gate |
|---|---|---|---|
| Free | Single location, 1-3 robots | $0 | none |
| Pro | Single location | ~$99/mo | live API sync, peer benchmarks, weekly digest, alerts |
| Operator | Multi-unit, franchisors | $500+/mo | multi-site rollups, mixed-brand fleets, POS/payroll-verified impact, exports |

The first upgrade prompt an owner ever sees should be a **peer benchmark tease**
on their own statement, once they have a coverage number: *"Venues like yours
run 3.1x coverage. See how you compare."* That is the moment the number becomes
a question, which is the only honest reason to pay.

---

## Failure and edge cases

Every one of these must be designed. A missing input is stated as missing, never
rendered as a zero.

| Case | Behavior |
|---|---|
| File has no recognizable robot id or timestamp column | Reject with the column names we accept, and a two-row sample of what we saw |
| File parses but yields zero robots | "We could not find any robots in that file," with the sample-statement path offered |
| Robot category has no benchmark rate | Robot marked unconfigured, excluded from totals, never counted as zero |
| Owner skips invoice | Coverage shows as unknown, work serviced still displays |
| Telemetry spans fewer days than the window | Window clamps to telemetry on record; invoice prorates to the same period; label says so |
| Duplicate upload of the same file | Idempotent, rows dedupe on (robot, timestamp); report "no new rows" |
| Upload larger than the request cap | Reject with a clear size limit, not a timeout |
| Owner abandons mid-onboarding | Resume from the furthest completed step; nothing is lost |
| Utilization above 100% | Reported as-is, flagged as "declared hours look wrong," never clamped |

---

## Instrumentation

Onboarding cannot be improved without knowing where it breaks. Six events, no
more:

1. `landed` — S0 view
2. `account_created` — S1 complete
3. `data_connected` — S2, file accepted or API linked, with row and robot counts
4. `fleet_confirmed` — S3 complete
5. `numbers_saved` — S4 complete, with how many robots were edited vs accepted
6. `activated` — S5 viewed with a non-null coverage ratio

The ratio that matters is **landed → activated**, and the median time between
them. If activation is low, the fix is almost always in S2, and no amount of
polish elsewhere compensates.

Two secondary measures worth watching: what fraction of owners edit any prefilled
value (if near zero, the benchmarks are being trusted blindly, which is a risk),
and what fraction return within 7 days.

---

## What already exists in code

Roughly two thirds of this is built. The gap is the funnel around it.

**Built and tested:**

- CSV/JSONL importer with the column aliases above (`src/importer.mjs`)
- `robot_economics` table, one row per robot, with idempotent upsert
- Benchmark defaults by category and the derived-rate arithmetic (`src/rates.mjs`)
- The five-input form, its parsing, and every validation rule listed in S4
  (`parseSetupForm` in `src/owner.mjs`)
- Form POST handling with a 64KB body cap and POST-redirect-GET
- The coverage statement itself (`/owner`)
- Fallback to benchmarks with `isDefault` marking

**Needs building:**

- S0 front door, S1 accounts, and therefore authentication and multi-tenancy
- S3 fleet confirmation screen (rename, recategorize, exclude)
- Upload UI: drag-drop, progress, the "here is what we read" summary
- `importTelemetry` does not currently write rollups, so an uploaded file
  produces an empty statement until `scripts/rebuild-rollups.mjs` runs. **This
  must be wired into the import path before S2 can work at all.**
- Resume-from-step state
- The six instrumentation events
- Peer benchmarks, which require a corpus we do not yet have

---

## The one thing to get right

If onboarding does only one thing well, it should be this: an owner drops a file
they already have and sees their own coverage number before they lose interest.

Everything else in this document is in service of that, and anything that
lengthens the path from file to number should be cut, including steps in this
spec.
