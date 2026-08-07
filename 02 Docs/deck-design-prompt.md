# Prompt for Claude (design)

Design a polished, investor-ready pre-seed pitch deck (9 content slides + a cover) for a startup called **Botlien**. All content below is final and research-backed, don't alter the facts, numbers, or claims, focus entirely on visual design, layout, typography, and slide composition. Category is "RaaS Analytics."

**Visual direction:** clean, data-forward, monochrome black-and-white base (the brand is literally called Botlien and already uses a minimal black/white aesthetic on its live site and deck draft), confident but not flashy, this is a serious fintech-adjacent B2B product, not a consumer app. Use tables and simple bar/funnel visuals for the data-heavy slides (market sizing, pricing, competitive comparison) rather than dense paragraphs. Real tables and real numbers should be genuinely readable, not decorative.

---

## Cover
**Headline:** Your robots are working. Is your business?
**Subhead:** Botlien turns any robot-operating business's robot telemetry into financial telemetry, cash flow analysis, cash flow projections, and default risk, so a shortfall shows up weeks before it hits a bank statement, not after.
**Category tag:** RaaS Analytics · Pre-Seed
**Meta line:** Raising $500K pre-seed · Founders Antonio D'Angelo, Samuel Kim

---

## Slide 1 — Problem / Why Now
**Headline:** Your robots are working. Is your business?

**Body:** Any business running commercial robots, one or one thousand, operates its robots and its financials on two different clocks. The robots report task completions and uptime, if they report anything at all; the business reports revenue and cash flow a month later, after the invoices settle. Nothing today connects the two in real time, so an operator finds out they're short of quota, burning cash, or carrying an underperforming unit only when it already shows up on a bank statement, not when there's still time to act on it.

**Why now (3 stats):**
- **~20%** — RaaS market CAGR through 2030, roughly 2x the equipment finance industry it depends on for capital
- **85%+** — telematics adoption for vehicles financed through major transportation lenders, proof the data category is mature
- **Nov 2025** — ISO mixed-fleet telematics standard approved, framed around usage-based valuation

**Investor framing line:** This isn't "should a business know its own cash flow," an already-answered question for every other business. It's "why is a robot-operating business's robot data and financial data still living in two different places."

---

## Slide 2 — Solution
**Headline:** Robot telemetry, turned into financial telemetry.

**Body:** Botlien turns any robot-operating business's robot telemetry into financial telemetry, then quantifies it into the numbers that actually run the business: cash flow analysis, cash flow projections, default/credit risk on their own robots, and whether they're hitting the monthly quota of whatever contract or use case those robots were deployed for.

**The pipeline (4 boxes):**
1. **Robot telemetry** — task completions, uptime, utilization, fault codes, pulled directly from the manufacturer's API.
2. **Financial telemetry** — the same signals converted into realized revenue per robot, measured against that unit's actual contract or quota target.
3. **Cash flow analysis and projections** — current-period actuals and a forward-looking view, so a shortfall is visible weeks before it hits a bank statement, not after.
4. **Default / credit risk** — for operators who've financed or leased their robots, or who extend financing to their own downstream customers, the same risk engine applies one layer earlier than a traditional lender would use it.

**Honest positioning callout:** This isn't a new financial concept. Fleet financial analytics and asset-backed lending are both decades-old categories. What's missing is the same real-time, cross-brand visibility layer vehicles already have through telematics (65–85% adoption in financed fleets), never built for robots, and never turned into a financial-planning tool for the operator itself. Once an operator has real telemetry history, a downstream product exists too: offering that verified data to their own upstream lender, an expansion layer, not the entry point.

---

## Slide 3 — Market Sizing (TAM / SAM / SOM)
**Headline:** TAM / SAM / SOM, rebuilt for the RaaS-operator-primary positioning, two independent methods that cross-validate.

**Funnel visual:**
- TAM: **~$290M/yr** (range ~$85M–$500M+)
- SAM: **~$70–75M/yr**
- SOM: **~$0.7–2.25M ARR**

**Table:**
| Input | Value | Status |
|---|---|---|
| Global service robot installed base | 475,000–710,000 robots | Sourced |
| RaaS market size, 2025 | $26.7B–$33.6B (high-cluster estimate) | Sourced, firms diverge 5–10x |
| RaaS market CAGR through 2030 | ~18–21% | Sourced |
| Seegrid: 2025 contracts that were RaaS-structured | 70% | Sourced, single vendor |
| RaaS share of installed base | 30–50%, midpoint 40% | Assumption |
| Software/analytics attach rate | ~1% of RaaS revenue | Assumption |
| Fee per robot/yr | $1,200 | Anchor |
| TAM, bottom-up (robots × fee) | ~$283M | Derived |
| TAM, top-down (market $ × attach rate) | ~$300M | Derived |

**Callout — average RaaS operator revenue, a projection not a lookup:** Almost no pure-play RaaS companies exist yet at scale. Real named anchors: Seegrid ($70.6M revenue), Rapyuta Robotics ($38M revenue), both mature outliers. Botlien's own discovery contacts (Formic, Gatsby, IntBot) are the more typical early-stage profile, likely under $5M. Projected on the sector's ~20% CAGR: average revenue per operator likely flat-to-down over the next 2–3 years as new entrants form, then rising as the category consolidates.

---

## Slide 4 — Business Model & Monetization
**Headline:** One platform, three tiers, one pricing formula.

**Three-tier table:**
| Tier | Who | How it sells |
|---|---|---|
| Individual / single-location | 1–2 robots, e.g. a single restaurant | Self-serve, once the product is live |
| RaaS operators & multi-location | Fleets across one or more sites | Founder-led sales, the active motion today |
| Enterprise accounts | Large chains, thousands of robots | Real sales conversation, custom onboarding |

**The pricing formula table:**
| Acquisition | Formula | Worked example |
|---|---|---|
| Financed, leased, or on a loan | ~12% of the actual monthly payment | Bear Servi, $399/mo lease → ~$48/mo |
| Owned outright | ~5% of purchase value per year, billed monthly | Bear Servi, $11,990 purchase → ~$50/mo |

Callout: the two paths land within a few dollars of each other for the same robot. A **$25/month floor** applies per robot; once a single robot's fee crosses ~$200–300/month (typical of a $150K+ humanoid), that account graduates into the negotiated enterprise tier.

**Why percentage-of-value, not percentage-of-revenue (callout box):** Toast POS charges a transaction cut because it's the payment processor, actually moving money. Botlien isn't, so a cut of the customer's revenue was rejected. Pricing off the robot's own financing/value is proportional by construction and reuses the same depreciation methodology Botlien's own risk-scoring engine already runs for collateral value.

**Why the sales motion splits by tier (callout box):** A single-location account is worth ~$300–600/year, too small to justify a sales rep, self-serve is the only motion the economics support (same as QuickBooks/Xero). Enterprise accounts are worth tens of thousands/year and need real onboarding. This hybrid split matches how Toast itself runs the adjacent restaurant-tech industry.

**Why any robot-operating business pays (3-row table):**
| Reason | Type |
|---|---|
| Know instantly if a fleet is falling short of monthly quota or contract target, before it's a cash-flow surprise | Operational visibility |
| Cleaner cash-flow forecasting and sharper reporting to investors, board, or lender | Planning and reporting |
| Verified performance history makes them more fundable when raising their own capital | Capital access |

---

## Slide 5 — Why This Is Hard to Copy
**Headline:** The moat is workflow embedding now, contractual lock-in once lenders join downstream.

**4 moat points:**
- **Workflow embedding** — once an operator relies on Botlien for monthly quota and cash-flow visibility, ripping it out means losing that visibility.
- **Cross-brand normalization** — no single manufacturer has a reason to build this, it would mean showing an operator how their robots compare to a competitor's failure rate.
- **Expansion lock-in** — once a lender is layered on top downstream, that access becomes contractual, not something a competitor can copy overnight.
- **Closest comparables, named directly**

**Competitive comparison table:**
| Capability | Botlien | Findustrial | Formant |
|---|---|---|---|
| Financial telemetry (task → revenue) | Yes | Partial | Partial |
| Cash flow analysis (current) | Yes | Yes | No |
| Cash flow projections (forward) | Yes | No | No |
| Default/credit risk scoring | Yes | No | No |
| Quota/KPI tracking vs. contract | Yes | No | No |
| Robotics-specific | Yes | No | Yes |
| Sold to RaaS operators directly | Yes | No (sells to OEMs) | Yes |
| Cross-brand normalization | Yes | No | Yes |

**Callout:** Findustrial (75+ projects, logos incl. Agilox, Volvo, Siemens Energy) sells to OEMs, not RaaS operators, asset-agnostic, zero predictive cash-flow/credit-risk by their own docs. Formant ($21M raised) built real operator-facing ROI reporting but has repositioned toward AI incident management. Neither combines robotics-specific + operator-facing + predictive cash-flow + credit-risk.

**Regulatory grounding table** (relevant once the downstream lender layer activates):
| Basis | Risk | Why it holds |
|---|---|---|
| UCC Article 9 | Low | Lenders already required to periodically confirm collateral exists |
| CECL (ASC 326) | Low | Requires a forward-looking, lifetime loss estimate |
| SR 11-7 | Medium | Only applies once a bank uses Botlien's output as a vendor model |
| ECOA / Reg B | Medium-high | Only applies if the customer uses output for credit decisions about others |
| FCRA | Low | Applies to consumer credit reporting; customers are commercial |

*Footnote: not legal advice, reasoned analysis for planning purposes.*

---

## Slide 6 — Traction
**Headline:** Pre-product, pre-revenue, in active discovery. Stated plainly, not oversold.

**Table:**
| Track | Status |
|---|---|
| RaaS operators (primary) | Verified contact list built. Karl Barry, Head of Robotics Monitoring and Maintenance at Formic Technologies, sharpest-fit contact found, email drafted. Formic's own upstream lender, Mitsubishi HC Capital America, confirmed named data point. |
| Manufacturers | First outreach sent to Lei Yang, CEO & Co-Founder of IntBot, met in person. |
| Lenders (secondary/downstream) | Verified contact list built, held for downstream expansion. Stephen Leege, SVP & Chief Credit Officer at Financial Pacific Leasing, confirmed strongest contact. |

**Callout — newly identified, not yet contacted:** Hanu K BBQ and Bangujeong (LA, both running Bear Robotics Servi units) confirm the single-location target exists today. RobotLAB, a named reseller for both Bear Robotics and Pudu, is a potential channel partner.

**Closing line:** This is honestly where a $500K pre-seed round should find the company. The ask is capital to convert discovery into signed pilots, not to scale an already-proven model.

---

## Slide 7 — Team
**Antonio D'Angelo — CEO & Co-Founder, majority stakeholder.** Business Administration, Finance concentration, Cal State Fullerton. Go-to-market experience at a private-equity-owned tech company. Private equity and venture capital background. Founder of Comprsly, a shipped desktop application.

**Samuel Kim — Co-Founder.** Business Administration, Finance concentration, Cal State Fullerton. Started in computer science before transitioning to finance, driven by a passion for credit and risk analysis. Building the product and dashboard.

**Why this team:** one founder with GTM, PE/VC, and shipped-product experience; one founder whose personal path from computer science into credit and risk analysis mirrors the company's thesis almost exactly.

---

## Slide 8 — The Ask
**Headline:** $500K pre-seed, to convert discovery into signed pilots.

**Body:** Use of funds framed around a milestone, not general growth: one or more signed pilots with real RaaS operators and other robot-operating businesses, generating first monitored-robot volume and a real case study, the trigger to raise a seed round.

**Callout:** At a lean 2-person team's typical early-stage burn, $500K plausibly buys roughly 12–18 months of runway.

---

## Slide 9 — Exit / Strategic Fit
**Headline:** The natural acquirer is a vertical fintech or SaaS platform already serving this customer base.

**Body:** Two of Botlien's own pricing comps, Intuit (QuickBooks) and Toast, both have real, well-sized precedent for acquiring exactly this kind of financial-data company to bolt onto an existing platform.

**Precedent table:**
| Precedent | Relevance |
|---|---|
| Intuit acquires Credit Karma (~$7.1B, cash and stock, 2020) | Strongest real comparable. Intuit explicitly building "a full-spectrum financial operating system" through acquisitions, the exact shape of an Intuit-Botlien deal. |
| Toast acquires xtraChef (2021) | A restaurant-tech platform acquiring a back-office financial-automation tool to extend its platform. Toast is already Botlien's direct pricing comp for the single-location tier, nearly the exact playbook. |

**Secondary path callout:** Lemonade acquired Metromile (~$500M, 2022) and JPMorgan acquired Aumni (~$232M, 2021), both financial-services acquirers buying data companies. Still relevant once the downstream lender-data product matures, a secondary path now, not the primary thesis.

**Honest callout:** No precedent exists yet of a company acquiring a robot-specific financial-telemetry company, arguably the whole opportunity. What's real: both Intuit and Toast have proven, repeated appetite for exactly this shape of acquisition in adjacent categories.

---

## Design notes
- Keep every table as an actual visual table, not converted to bullet paragraphs, the data density is part of the credibility.
- Slide 3 (market sizing) and Slide 4 (pricing formula) are the most numbers-heavy, give them the most visual breathing room and consider simple bar/funnel graphics for the TAM/SAM/SOM figures.
- Slide 5's competitor table should read cleanly as a checkmark-style comparison grid.
- Don't invent a demo screenshot or product UI, none exists yet, showing a fake one would misrepresent where the company actually is.
- Tone throughout is confident but not oversold, several slides intentionally include honest "here's what's still open" callouts, preserve that tone rather than smoothing it into pure hype.
