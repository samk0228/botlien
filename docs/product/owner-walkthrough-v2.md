# Botlien: Owner Walkthrough v2

## What Botlien is, in one sentence

Botlien is software for business owners who already run robots-as-a-service: it connects to the robots they have, converts their task output into financial terms, and shows in one dashboard whether the robots are covering their cost.

## Who it is for

Owners with a RaaS program already installed: a restaurant running Servi or BellaBot, a laundry or cleaning operation with service robots, an e-commerce business with fulfillment robots. They already generate telemetry every day. What they lack is a financial reading of it. The vendor dashboard shows counts; Botlien shows dollars of work performed against dollars paid.

**The one rule that keeps every claim honest:** Botlien values the *service performed*, never the *revenue touched*. A robot that ships a $40 order contributed the fulfillment step, worth what a human or 3PL would charge for it, not $40. Every number in the product follows this rule, which is what makes Botlien independent and auditable where vendor ROI claims are sales collateral.

---

## The walkthrough

### Step 1: The front door (two tracks, not one)

A single "request a demo" door forces every visitor into a sales conversation, which only makes sense for large accounts. Botlien.com offers two tracks:

- **Self-serve (default):** "Create free account." Single-location owners sign up, connect data, and see their dashboard the same day. No sales call, no pricing conversation up front. Pricing appears when they hit the paid tier, not before they have seen value.
- **Demo track:** "Book a walkthrough," surfaced for multi-unit operators and franchisors (5+ locations or mixed-brand fleets). This is the sales-led motion, and it is reserved for accounts large enough to justify it.

*Recommendation embedded here: run both tracks. A demo-gated front door for a sub-$150/month product cannot pay for itself; a self-serve-only door leaves the large accounts underserved.*

### Step 2: Onboarding (one screen, five inputs)

Onboarding is not a long intake. The financial engine needs exactly five inputs, pre-filled with benchmark defaults wherever possible so the owner can accept and continue:

1. **What each robot does** (task type: tray delivery, packages fulfilled, cleaning cycles, laundry loads)
2. **Monthly RaaS invoice** (what they pay for the robots)
3. **Replacement rate per task** (what the same unit of work costs to buy from a human or 3PL; pre-filled from benchmarks, editable)
4. **Loaded hourly wage** (optional, for labor-hours framing)
5. **Operating hours** (so utilization is measured against real capacity, not the clock)

Everything else the software needs comes from the robots themselves. No AI mystique: the math is a transparent formula the owner can audit, and that transparency is the product's trust advantage over vendor marketing.

### Step 3: Connect your data (file first, API second)

The instant path is not an API connection, because robot vendors issue API credentials manually and slowly. Two paths, in this order:

- **Instant path: drop an export.** Every vendor dashboard (Bear Universe, Pudu Cloud) exports usage reports. The owner drops that CSV into Botlien and has a filled dashboard in minutes, including historical backfill, so day one is never empty.
- **Continuous path: connect the API.** For ongoing live data, Botlien walks the owner through requesting credentials from their vendor (Bear's cloud API is public but credentialed; Pudu has an open platform) and connects once granted. This upgrades the account from snapshot to live monitoring.

Leading with the file drop means the funnel never stalls on a vendor's credential queue at the moment of highest intent.

### Step 4: The dashboard (financial telemetry, honestly framed)

Telemetry in, four financial readings out, all derived from task counts, the rates from onboarding, and the invoice:

- **Coverage ratio (the headline number):** "Your robots performed $4,200 of fulfillment work against your $1,800 invoice. Coverage: 2.3x."
- **Cost per task:** invoice divided by tasks performed. "18 cents per package," trending over time.
- **Work serviced:** tasks performed, valued at replacement rates, by day, robot, and site. This is the absentee owner's daily answer to "what did my machines produce without me there."
- **Utilization vs. capacity:** "You are paying for capacity you used 31% of," the early-warning that a robot is not earning its invoice.

What the dashboard deliberately never shows: attributed revenue, projected P&L impact, or any number that requires knowing what would have happened without the robots. Those claims need payroll and POS data and belong to the paid operator tier, where they can be computed from real connected books rather than estimated.

### Step 5: Activation and the paying decision

The owner's validation is not left to drift. The product defines its aha moment and measures it:

- **Activation target:** the owner sees their own coverage ratio in the first session, within minutes of dropping a file.
- **Instrumented funnel:** signups to filled dashboard to weekly return visits. If owners are not activating, the product fixes step 3 friction before touching anything else.
- **The paywall sits behind the aha, not in front of it.**

**Tiers (recommended structure):**

| Tier | Who | Price | What they get |
|---|---|---|---|
| Free | Single location, 1-3 robots | $0 | Coverage ratio, cost per task, work serviced, file-drop imports |
| Pro | Single location | ~$99/mo | Live API connection, benchmarks vs. similar venues, weekly owner digest, alerts |
| Operator | Multi-unit, franchisors | $500+/mo | Multi-site rollups, mixed-brand fleets, POS/payroll-verified impact, exportable reports |

---

## Why the free tier is strategic, not charity

Every free account contributes the thing no one in this market has: real telemetry paired with real outcomes across brands and venues. That corpus powers the Pro tier's benchmarks ("venues like yours run 3.1x coverage") and feeds the risk-monitoring product for RaaS operators and lenders, where the durable, regulation-shaped willingness to pay lives. The owner dashboard is the front of the funnel; the data it accumulates is the moat.

## Open decisions

1. **First paying customer:** single-location Pro at ~$99/mo, or multi-unit Operator at $500+? This decides whether early sales effort goes into self-serve polish or into Antonio's outbound to operators and franchisors.
2. **Name spelling:** materials currently mix "Botlien" and "Botlian." Pick one, confirm the matching domain, and standardize everywhere before anything is customer-facing.

## What already exists toward this

The current codebase covers most of the plumbing: the connector interface (Bear API client built, awaiting credentials), the CSV/JSONL importer (the step 3 instant path), normalized cross-brand schema, per-robot utilization rollups (the basis of coverage and cost per task), and a live dashboard server. The build gap to this walkthrough is the onboarding screen, the rates table, the coverage math, and the owner-facing board views.
