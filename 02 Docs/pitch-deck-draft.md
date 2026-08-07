# Botlien — Pre-Seed Pitch Deck Draft

## STATUS: content complete, fully consistent pass 2026-08-05, ready to build the real deck from

Live HTML version (source of truth for visual layout): https://claude.ai/code/artifact/57af426c-18fd-4b8d-b3f5-3d457c4523f6

Team is locked (Antonio D'Angelo, Samuel Kim). Pricing, TAM/SAM/SOM, positioning, competitive research, and the exit slide are all research-backed, not founder guesses. **Category: RaaS Analytics.** Any business operating a commercial robot is a potential customer, single-location restaurant, multi-location RaaS operator, or enterprise fleet, on one platform with one pricing formula (see Slide 4). Lenders remain a real downstream/secondary layer, not the entry point. Nothing below is a placeholder. Next step is visual design, not more content.

---

## Slide 1 — Problem / Why Now

**Headline:** Your robots are working. Is your business?

**The problem:** any business running commercial robots, one or one thousand, operates its robots and its financials on two different clocks. The robots report task completions and uptime, if they report anything at all; the business reports revenue and cash flow a month later, after the invoices settle. Nothing today connects the two in real time, so an operator finds out they're short of quota, burning cash, or carrying an underperforming unit only when it already shows up on a bank statement, not when there's still time to act on it.

**Why now, three things true today that weren't two years ago:**
- Robotics-as-a-Service is growing at roughly 20% CAGR through 2030, roughly double the growth rate of the broader equipment finance industry it depends on for capital, meaning more operators, faster, all running this exact blind spot.
- Telemetry-based fleet monitoring is not a novel concept, it's a mature, sometimes-mandatory practice in adjacent equipment classes. Adoption exceeds 85% for vehicles financed through major transportation lenders. What doesn't exist yet is that same telemetry turned into *financial* telemetry, useful to the operator running the business, not just a lender monitoring collateral.
- An ISO mixed-fleet telematics standard was approved in November 2025, explicitly framed around enabling usage-based valuation, proof the underlying data category is now standardized enough to build a real financial product on top of.

**The framing that matters for investors:** this isn't "should a business know its own cash flow," an already-answered question for every other business. It's "why is a robot-operating business's robot data and financial data still living in two different places."

---

## Slide 2 — Solution

Botlien turns any robot-operating business's robot telemetry into financial telemetry, then quantifies it into the numbers that actually run the business: cash flow analysis, cash flow projections, default/credit risk on their own robots, and whether they're hitting the monthly quota of whatever contract or use case those robots were deployed for.

**The pipeline:**
- **Robot telemetry** — task completions, uptime, utilization, fault codes, pulled directly from the manufacturer's API.
- **Financial telemetry** — the same signals converted into realized revenue per robot, measured against that unit's actual contract or quota target.
- **Cash flow analysis and projections** — current-period actuals and a forward-looking view, so a shortfall is visible weeks before it hits a bank statement, not after.
- **Default / credit risk** — for operators who've financed or leased their robots, or who extend financing to their own downstream customers, the same risk engine applies one layer earlier than a traditional lender would use it.

**The honest positioning:** this isn't a new financial concept. Fleet financial analytics and asset-backed lending are both decades-old categories. What's missing is the same real-time, cross-brand visibility layer vehicles already have through telematics (65–85% adoption in financed fleets), never built for robots, and never turned into a financial-planning tool for the fleet operator itself. Botlien isn't inventing fleet finance, it's building the infrastructure an already-proven category never got for this asset class. Once an operator has real telemetry history, a downstream product exists too: offering that verified data to their own upstream lender, the traditional collateral-monitoring pitch, now an expansion layer instead of the entry point.

---

## Slide 3 — Market Sizing

TAM / SAM / SOM, rebuilt 2026-08-05 for the RaaS-operator-primary positioning, replacing the old lender-facing framing. "RaaS operator" is a broader buyer population than "financed/leased robot" was, so this TAM is larger, and it's rebuilt with two independent methodologies that cross-validate rather than one.

| Input | Value | Status |
|---|---|---|
| Global service robot installed base | 475,000–710,000 robots | Sourced, IFR-based, carried from prior sizing work |
| RaaS market size, 2025 | $26.7B–$33.6B (high-cluster estimate) vs. a $1.5B low-outlier estimate from one firm | Sourced, but research firms diverge 5–10x on scope/methodology, real uncertainty, stated honestly |
| RaaS market CAGR through 2030 | ~18–21% | Sourced |
| Seegrid: share of 2025 contracts that were RaaS-structured | 70% | Sourced, single named vendor, new-contract mix only, real directional signal |
| RaaS share of installed base, bottom-up assumption | 30–50%, midpoint 40% | Assumption, informed by the Seegrid data point, not equal to it |
| Software/analytics attach rate, top-down assumption | ~1% of RaaS revenue | Assumption, conservative vertical-SaaS ballpark, not RaaS-specific sourced |
| Fee per robot/yr | $1,200 | Existing Botlien anchor |
| **TAM, bottom-up (robots × fee)** | **~$283M** | Derived |
| **TAM, top-down (market $ × attach rate)** | **~$300M** | Derived |
| **TAM, central estimate** | **~$290M/yr** (range ~$85M–$500M+ given the methodology uncertainty above) | Derived |
| SAM: near-term reachable segment | ~$70–75M/yr (~25% of TAM, assumption) | Derived |
| SOM: realistic 3-yr capture for a new entrant | ~$0.7–2.25M ARR (1–3% of SAM) | Derived |

**Why this is bigger than the old $177M figure:** the previous TAM gated on "financed or leased," a narrower filter than "operated under a RaaS/service-contract model," which is the actual buyer population once the RaaS operator itself is the direct customer rather than their lender. Two independent methods (counting robots, and taking a share of total RaaS market dollars) converge on roughly the same ~$280–300M range, real cross-validation, but both still rest on assumptions (the RaaS-share-of-installed-base percentage, and the software-attach-rate percentage) that aren't independently sourced, so the convergence should read as reassuring, not as false precision.

**What an average RaaS operator's revenue actually looks like today, and why this is a projection, not a lookup:** almost no pure-play RaaS companies exist yet at scale, so there's no clean dataset to average. The few real, named data points found: **Seegrid, $70.6M revenue**, and **Rapyuta Robotics, $38M revenue**, both mature, well-funded players, likely well above the median operator, not representative of the typical company. Against that, Botlien's own discovery tracker has already found the more typical profile: Formic Technologies, Gatsby, and IntBot are all small, early-stage operators with no disclosed revenue at Seegrid's scale. The honest picture is bimodal: a handful of scaling leaders in the tens of millions, and a long tail of early operators likely under $5M, consistent with a market this early. Projecting forward on the sector's ~20% CAGR, expect average revenue per operator to stay flat or even dip over the next 2–3 years as new entrants keep forming faster than the market matures, then rise later in the decade as the category consolidates and weaker operators exit or get acquired, the standard shape of a land-grab-to-consolidation curve, not a straight-line forecast.

---

## Slide 4 — Business Model & Monetization

**One platform, three customer tiers, one pricing formula.** Every business that operates a commercial robot, from a single-location restaurant to an enterprise fleet operator, is a potential customer of the same underlying product. What changes by tier is deal size and how the deal gets closed, not how the fee is calculated.

| Tier | Who | How it sells |
|---|---|---|
| Individual / single-location | A business running 1–2 robots directly, e.g. a single restaurant location | Self-serve, credit-card signup, only viable once the product is live |
| RaaS operators & multi-location businesses | Companies running a fleet across one or more sites | Founder-led relationship sales today, the current active motion |
| Enterprise accounts | Large chains and fleet operators, thousands of robots | Real sales conversation, custom onboarding and invoicing, deal size justifies the human touch |

**The pricing formula, one mechanism, two inputs depending on how the robot was acquired:**

| Acquisition | Formula | Worked example |
|---|---|---|
| Financed, leased, or on a loan | ~12% of the actual monthly payment | Bear Servi at $399/mo lease → ~$48/mo |
| Owned outright | ~5% of purchase value per year, billed monthly | Bear Servi at $11,990 purchase → (5% × $11,990) ÷ 12 ≈ $50/mo |

The two paths land within a few dollars of each other for the same robot, that's the real validation, different math for how the robot was acquired, the same underlying fee. A **$25/month floor** applies per robot so the cheapest deployments still clear infrastructure cost with real margin. Once a single robot's fee crosses roughly $200–300/month, typical of a $150K+ humanoid, that account graduates out of self-serve math into the negotiated enterprise tier rather than being billed on the formula automatically.

**Why percentage-of-value, not percentage-of-revenue:** the closest payments-processing comp, Toast POS, charges a flat fee plus a transaction cut, but that cut exists because Toast is the payment processor, it's actually moving the money. Botlien isn't, it's reporting on cash flow that's already happening elsewhere, so a cut of the customer's revenue was rejected (see below). Pricing off the robot's own financing or value instead solves a real problem raised directly by early discovery conversations: a flat abstract fee can feel disproportionate to a small operator if a robot isn't yet earning much, pricing as a percentage of what they're already committed to paying for the robot itself is proportional by construction, and reuses the same depreciation methodology Botlien's own risk-scoring engine already runs to estimate collateral value, not a separate policy invented for billing.

**Why the sales motion splits by tier, not a single approach for everyone:** a single-location account is worth roughly $300–600/year at these rates, a human sales rep's time costs more than that deal is worth to close, so self-serve is the only motion the unit economics support, exactly why QuickBooks and Xero sell themselves online with no rep involved. An enterprise account is worth tens of thousands of dollars a year and needs real onboarding, this is where a sales conversation earns its cost. This hybrid split, self-serve for small accounts and a sales team for large ones, is the same structure Toast itself runs in the adjacent restaurant-tech industry, a proven pattern, not a guess.

**Rejected after comparison:** a one-time per-loan fee (cost mismatch, Botlien's infrastructure costs are ongoing for the life of the loan or lease), a pure flat license replacing per-robot entirely (the flat-rate model that underperforms on retention, 95–105% NRR vs. 115–130% for usage-based), and annuity/revenue-share tied to the customer's own performance or revenue (no real comparable exists, hard to attribute causally, reads as a services business to investors).

**Why any robot-operating business actually pays, three distinct arguments:**

| Reason | Type |
|---|---|
| Know instantly if a fleet is falling short of monthly quota or contract target, before it becomes a cash-flow surprise at month-end | Operational visibility |
| Cleaner cash-flow forecasting and sharper reporting to their own investors, board, or lender | Planning and reporting |
| Verified, real-time fleet performance history makes them a more fundable counterparty when they raise their own capital, better terms, faster approval | Capital access |

Illustrative, not guaranteed: catching one underperforming or at-risk robot early, before it becomes a full quarter of missed quota, covers years of the monitoring fee on its own at these price points.

**Downstream layer, no longer the entry point:** once a customer, at any tier, has real telemetry and financial-telemetry history, offering that verified data to their own upstream lender becomes a natural upsell, the original collateral-monitoring pitch, now sold as an expansion product instead of the first thing Botlien goes to market with. "Who pays" is resolved by the pivot itself: the customer pays for their own tool, the same way any business buys its own analytics software, no ambiguity about whether the cost lands on a lender or gets pushed down as a covenant.

**Second revenue layer, longer-term:** once Botlien monitors enough robots across enough manufacturers, the aggregated failure-rate, utilization, and depreciation data becomes valuable on its own, to OEMs, insurers, and secondary-market valuation. Comparable in shape to what Carfax became for vehicles. Not a near-term line.

**Sequencing honesty, not a Day 1 claim:** the single-location self-serve tier is a real product-roadmap destination, not the current build, self-serve signup only makes sense once there's a live dashboard to sign up into. Today's active motion is founder-led sales into RaaS operators and multi-location businesses, the same track already in discovery. Stated as the platform's ambition and staged path, not an all-tiers-live-today claim.

---

## Slide 5 — Why This Is Hard to Copy

- **Workflow embedding.** Once an operator relies on Botlien for monthly quota and cash-flow visibility, ripping it out means losing that visibility, not just switching vendors.
- **Cross-brand normalization.** No single manufacturer has a reason to build this, it would mean showing an operator how one brand's robots compare to a competitor's failure rate.
- **Expansion lock-in.** Once real telemetry history exists and a lender relationship is layered on top as a downstream product, that access becomes contractual, a loan or lease covenant, not a public API a competitor could copy overnight. That legal moat still exists, it's just an expansion layer now instead of the entry point.
- **Closest comparables, researched and directly verified 2026-08-05, named directly rather than claiming an empty category:**

| Capability | Botlien | Findustrial | Formant |
|---|---|---|---|
| Financial telemetry (task completion → revenue) | Yes | Partial, usage-based billing infrastructure, no explicit revenue-per-asset tracking | Partial, usage/performance data feeds ROI reports, not explicit revenue conversion |
| Cash flow analysis (current period) | Yes | Yes, real-time margin/cash/exposure "CFO cockpit" | No |
| Cash flow projections (forward-looking) | Yes | No, explicitly absent from their own documentation | No |
| Default/credit risk scoring | Yes | No | No |
| Quota/KPI tracking vs. contract | Yes | No | No |
| Robotics-specific | Yes | No, asset-agnostic, sold to OEMs | Yes |
| Sold to RaaS operators directly | Yes | No, sold to OEM manufacturers transitioning to EaaS, and financing partners | Yes, "robotics companies and integrators" |
| Cross-brand normalization for one operator's mixed fleet | Yes | No, sold per-OEM | Yes |

**Findustrial** (75+ completed projects, 20+ logos including Agilox, Palfinger, Volvo, Siemens Energy, EU co-funded) targets OEM manufacturers and their financing partners, not RaaS operators directly, real cash/margin tracking, but asset-agnostic and confirmed to have zero predictive cash-flow or credit-risk capability by their own product documentation. **Formant** ($21M raised, past coverage cites 500%+ YoY revenue growth in 2023, customers including Blue River/John Deere, BP, Knightscope) built real cross-brand, operator-facing ROI reporting, but their current homepage has repositioned around "Formant Metaphysics," an AI incident-management platform, financial ROI reporting appears secondary to their present pitch, if not phased out. Neither combines robotics-specific + operator-facing + predictive cash-flow + credit-risk scoring, that four-part combination is Botlien's real, confirmed-open gap. Cendex Group re-confirmed still lender-facing only, no operator pivot found.

**Regulatory grounding, audited, not assumed. Relevant primarily once the downstream lender layer activates:**

| Basis | Risk | Why it holds |
|---|---|---|
| UCC Article 9 | Low | Lenders already required to periodically confirm collateral exists. Relevant once a lender is added downstream. |
| CECL (ASC 326) | Low | Requires a forward-looking, lifetime loss estimate. Botlien's cash-flow-projection output feeds this directly once a lender is involved. |
| SR 11-7 | Medium | Only applies once a bank uses Botlien's output as a vendor model. Not a Day 1 concern with a RaaS operator as the direct customer. |
| ECOA / Reg B (fair lending) | Medium-high | Only applies if the RaaS operator itself uses Botlien's output to make credit/leasing decisions about its own downstream customers. Secondary exposure, not a Day 1 constraint. |
| FCRA | Low | Applies to consumer credit reporting. Botlien's customers are commercial entities, likely out of scope, conditional on staying commercial-only. |

*Not legal advice, this is a reasoned analysis for planning purposes. Real counsel review is still required before any loan-covenant or consent language goes live.*

---

## Slide 6 — Traction

Pre-product, pre-revenue, in active discovery, led directly by the RaaS-operator track. Stated plainly, not oversold.

| Track | Status |
|---|---|
| RaaS operators (primary) | Verified contact list built. Karl Barry, Head of Robotics Monitoring and Maintenance at Formic Technologies, confirmed as the sharpest-fit contact found across any track, discovery email drafted and ready to send. Formic's own upstream lender, Mitsubishi HC Capital America, is a confirmed, named data point, direct evidence of the downstream expansion layer this business model depends on. |
| Manufacturers | First outreach sent to Lei Yang, CEO & Co-Founder of IntBot, met in person. Aimed partly at surfacing manufacturers' own RaaS/leasing relationships directly. |
| Lenders (secondary/downstream) | Verified contact list built across small/independent equipment finance firms, held for the downstream expansion motion rather than an initial sales target. Stephen Leege, SVP & Chief Credit Officer at Financial Pacific Leasing, confirmed strongest contact when this layer is activated. |

**Newly identified, not yet contacted:** the single-location tier has real, named deployments to reach, Hanu K BBQ and Bangujeong (LA, both running Bear Robotics Servi units) confirm the target exists today, not hypothetically. RobotLAB, a named reseller for both Bear Robotics and Pudu, is a real potential channel partner that could reach many small operators at once instead of one by one. Neither outreach has started, listed here as the next track to open, not as traction that exists yet.

This is honestly where a $500K pre-seed round should find the company. The ask is capital to convert discovery into signed pilots, not to scale an already-proven model.

---

## Slide 7 — Team

- **Antonio D'Angelo** — CEO & Co-Founder, majority stakeholder. Business Administration, Finance concentration, Cal State Fullerton. Go-to-market experience at a private-equity-owned tech company. Private equity and venture capital background. Founder of Comprsly, a shipped desktop application, evidence of taking a product from idea to real users.

- **Samuel Kim** — Co-Founder. Business Administration, Finance concentration, Cal State Fullerton. Started in computer science, where his interest in technology took root, before transitioning to finance driven specifically by a passion for credit and risk analysis, the exact intersection this company needs. Building the product and dashboard.

**Why this team:** one founder with GTM, PE/VC, and shipped-product experience; one founder whose personal path from computer science into credit and risk analysis mirrors the company's thesis almost exactly.

---

## Slide 8 — The Ask

**Raising: $500K pre-seed.**

Use of funds framed around a milestone, not general growth: one or more signed pilots with real RaaS operators and other robot-operating businesses, generating first monitored-robot volume and a real case study, the trigger to raise a seed round.

**Estimate, confirm or correct:** at a lean 2-person team's typical early-stage burn, $500K plausibly buys roughly 12–18 months of runway. Directional planning assumption, not a confirmed budget.

---

## Slide 9 — Exit / Strategic Fit

**Updated 2026-08-05, following the RaaS-primary pivot.** The natural acquirer is a vertical fintech or SaaS platform already serving this customer base, not a bank. Two of Botlien's own pricing comps, Intuit (QuickBooks) and Toast, both have real, direct, well-sized precedent for acquiring exactly this kind of financial-data/analytics company to bolt onto their existing platform.

| Precedent | Relevance |
|---|---|
| Intuit acquires Credit Karma (~$7.1B, cash and stock, 2020) | Strongest real comparable. Intuit explicitly building "a full-spectrum financial operating system" through acquisitions, buying a financial-data company to fold directly into its existing small-business/consumer finance stack, the exact shape of an Intuit-Botlien deal. |
| Toast acquires xtraChef (2021) | A restaurant-tech platform acquiring a back-office financial-automation tool (accounts payable, inventory) to extend its platform. Toast is already Botlien's direct pricing comp for the single-location tier, this is nearly the exact playbook, a financial-data layer bolted onto an existing restaurant-tech platform. |

**Secondary path, still real:** Lemonade acquired Metromile (~$500M, all-stock, July 2022), a financial-services acquirer buying a telematics/usage-based-risk-data company to fold into underwriting, and JPMorgan acquired Aumni (~$232M, 2021), a bank buying a data-analytics company outright. Both stay relevant once the downstream lender-data product matures, just a secondary path now, not the primary thesis.

**Say this honestly, not more:** no precedent exists yet of a company acquiring a robot-specific financial-telemetry company, that deal hasn't happened, arguably the whole opportunity. What's real and citable: both Intuit and Toast have proven, repeated appetite for exactly this shape of acquisition in adjacent categories, and WTW's 2026 financial-institutions M&A outlook separately names "AI, analytics, and digital platforms that improve underwriting" as an explicit acquirer priority for the secondary path.

---

## What's still missing before this is VC/PE-ready

1. No working demo yet, everything above is reasoning and research, no investor has anything to watch work.
2. No pilot, no completed real conversation, one outreach email sent as of this update.
3. The core signal is unproven, does financial telemetry actually predict quota shortfall or default, still an open question.
4. ~~Real competitive research on RaaS fleet-financial-analytics specifically~~ — done 2026-08-05, see Slide 5. Findustrial and Formant are real, close comps and are now named in the deck rather than omitted, real white space still exists in the specific combination Botlien targets, but it's narrower than "nobody's building this."
5. No real financial projections beyond the illustrative TAM/SAM/SOM math, needs a quarter-by-quarter revenue ramp.
6. Samuel's technical scope for this specific build is a real, acknowledged open question.
7. No actual legal counsel review yet, everything regulatory above is reasoned analysis, not a lawyer's sign-off.
8. Whether operators' own contract/billing data is standardized enough to integrate quickly is unvalidated, real discovery-call-dependent unknown.
9. The percentage-of-value pricing formula (12% financed, 5% owned annually, $25 floor) is reasoned from real comps but hasn't been tested against a single real customer's actual reaction yet.

*See `Build.md`'s "Honest self-audit" section for the full scored breakdown (internal use, not deck content).*
