# Botlien

**Status:** Idea / pre-prototype
**Started:** 2026-08-04
**One-liner:** Lender-only, API-connected risk monitoring for financed commercial service robots (Pudu, Bear Robotics, Keenon, etc) — "Plaid for robot collateral."

**Naming note:** Originally named "Custodly" during the initial planning session — 22 candidates were checked for trademark/domain conflicts and Custodly was the only clean result at the time. Renamed to **Botlien** (Bot + Lien — the legal claim a lender holds on financed collateral) on 2026-08-04. Re-verify domain/trademark availability for "Botlien" before committing to it publicly; the Custodly clearance work does not carry over to a different name.

## The six questions

- **Is this worth building?** Plausibly — real market timing (embedded finance + service robot fleets both maturing now), and the core mechanism (lender-side data access as a loan covenant) isn't something a competitor can casually scrape or copy.
- **Who would actually use it?** Small and mid-size equipment-finance lenders and brokers already financing service robots. Not the robot owner/borrower — the lender is the buyer.
- **What problem does it solve?** Lenders who finance commercial service robots have zero ongoing visibility into whether the collateral is still operational, still where it should be, or degrading — the same blind spot GPS trackers and telematics solve in auto/equipment lending, but nothing solves it for robots yet.
- **Can it become a real business?** Long-run model is a per-robot-per-month monitoring fee paid by the lender, with real comps (CDK Global, Solera) in the adjacent automotive/equipment-finance data space.
- **What is the smallest version that creates value?** One robot brand connector (starting with Pudu), pulling uptime/location/fault-code telemetry into a single lender-facing dashboard screen — see Build.md Phase 1.
- **How can it be automated or scaled?** Normalization schema is designed from day one so a second and third robot brand connector slot in without a rewrite; the risk-scoring engine starts rules-based (no ML) since there isn't yet enough default/repossession history to train against.

## Vision & problem statement

Small businesses increasingly finance commercial service robots the way they'd finance any equipment. The lender writes the loan but has no ongoing signal on the collateral's actual condition — is it still running, still on-site, still worth what's on the books. Botlien sits between the robot's own API/telemetry and the lender: the borrower authorizes API access to their financed robot as a condition of the loan, and Botlien turns that into continuous risk visibility (uptime, location, utilization, fault codes) and early-warning flags for the life of the loan.

## Market opportunity & competitive landscape

- Equipment finance is a multi-billion-dollar space with real comps (CDK Global, Solera) already monetizing data/analytics on financed physical assets in adjacent verticals (auto).
- Every earlier pivot of this idea (humanoid orchestration, restaurant-robot orchestration, senior-living robotics) ran into a well-funded direct competitor once actually researched (e.g. Kalanick's Atoms, SoftBank Robotics). This lender-side collateral-monitoring angle is the first version where no direct competitor solving collateral risk specifically for lenders turned up.
- The wedge/moat: data access is a **loan covenant**, not a public API scrape — structurally harder to copy overnight than a typical SaaS integration.
- Scored 7.2/10 on the internal Opportunity Meter, the highest of any version explored across the pivot history.

## Target customer / persona

**Sequencing revised 2026-08-04 — see Build.md's Go-to-market sequencing for full detail.** RaaS operators first (they carry collateral risk on their own leased fleet directly, one buyer in the room, no lender to convince first), and the specialty lenders/warehouse-facility providers who finance those RaaS fleets, alongside them. Robot manufacturers (OEMs) come after, once there's a working case study — deliberately sequenced last partly because of adverse selection (a manufacturer with weaker reliability has a real incentive to say no if it means exposing that). Traditional small/mid-size equipment-finance lenders financing individual robot purchases outright remain a valid long-run market, just not the lead motion.

## Monetization strategy

Per-robot-per-month monitoring fee, or basis points against loan/lease value under management, paid by whoever's carrying the risk (RaaS operator or lender), once past the free/near-free pilot stage. Year-one goal is proof (real usage data + a case study), not revenue. Two lending structures to sell into: asset-backed (against one robot's value) and cash-flow-backed (against a RaaS company's whole lease-revenue book, same shape as SaaS venture debt against MRR) — see Build.md's Go-to-market sequencing for the full wedge → expansion path.

## Risks & assumptions

- **Biggest assumption that, if wrong, kills the whole thing — partially de-risked 2026-08-04.** "Does a real robot brand's API expose usable telemetry to a third party at all" is no longer a pure unknown: Bear Robotics' full field-level API schema is publicly documented today, no partner application needed to read it (connection state, battery, faults with severity, stuck detection, location, velocity — everything the risk model needs). Pudu's equivalent categories are real but gated behind a distributor application. What's still genuinely unknown: whether a manufacturer grants *production* commercial access to a startup, not just lets you read the docs, and separately, whether the underlying predictive hypothesis (does asset decline actually predict default) holds at all — that needs real pilot data and is untouched by the documentation research.
- **Technical risk:** Samuel's exact technical scope and robotics-specific experience isn't fully defined yet — flagged in the blueprint as the single largest execution risk.
- **Market/legal risk:** whether robot manufacturers will grant *production* API access to a third party for this purpose, versus treating it as a data-partnership conversation the manufacturer itself needs to approve. Also, the loan-covenant/consent legal language needs real input from someone who has actually underwritten equipment finance deals — not something to draft from assumption. Consent chain can be 3 parties (manufacturer / RaaS operator / end customer), not 2 — see Build.md's Data access model section, especially the hard scope line around never touching biometric/interaction data for humanoid robots.
- **Sizing risk:** realistic scale of small-business robot financing volume today is still unknown; needed before sizing outreach or fundraising targets.
- **Model/methodology risk, added 2026-08-04:** no empirical validation yet — every scoring threshold is a reasonable hypothesis, not a calibrated number. Two adversarial audit passes (see Build.md's Risk scoring engine section) surfaced real gaps: no PD/LGD separation was originally built, no depreciation was factored into collateral value, no way existed to distinguish a broken robot from a broken data connection, no portfolio-level concentration view, no answer yet on who pays for the score and whether that's a conflict of interest. All now have a documented approach in Build.md, none have been tested against real data.

## Verdict

Still pre-prototype, no pilot, no signed data partnership — that hasn't changed. What has changed as of 2026-08-04: the core technical bet (does usable robot telemetry exist and is it reachable) went from a complete unknown to confirmed-yes for at least one real manufacturer (Bear), and the risk-scoring methodology went from a rough sketch to something that's survived two rounds of deliberate hole-poking, grounded in real regulatory frameworks (CECL, UCC Article 9, SR 11-7) rather than internal logic alone. As an idea plus methodology, that's roughly an 8/10 — the moat logic was always sharp, the execution layer just got a lot more real. As a fundable-today proposition it's still pre-traction: realistic path is angels or a specialist pre-seed fund at something like a $3M-8M SAFE cap given the team and thesis quality, not an institutional seed check without a signal first. The single biggest lever left, by a wide margin, isn't more methodology work — it's one real pilot commitment or data partnership. Phase 0 is no longer the full gate it was; the predictive-hypothesis question (does asset decline actually predict default) is now the real gating step.

## Team

- **Antonio D'Angelo** — GTM/business. CSUF senior finance major (graduating May 2027). Fixed income analyst at Titan Capital Management, equity analyst on CSUF's Student Managed Investment Fund, RevOps/GTM analyst at Parsec Automation, prior VC analyst experience at Sunset Ventures.
- **Samuel Kim** — CTO, building the backend. Titan Capital Management teammate.

## Source materials (in this folder)

- `botlien-blueprint.pdf` — original technical/execution blueprint (still under the "Custodly" name internally; content is otherwise current — see Build.md for the up-to-date name-corrected summary).
- `botlien-pitch-deck.pptx` — original 11-slide investor pitch deck (still under the "Custodly" name internally; see task list for the rename/rebuild pass).
- `original-concept-README.md`, `robochestra-original-concept.pdf` — archived materials from the earlier "Robochestra" humanoid-orchestration concept this venture pivoted away from. Kept for history, not current direction.
