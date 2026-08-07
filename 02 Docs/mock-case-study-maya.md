# Mock Case Study: Maya (Illustrative Scenario)

Status: Copy drafted and audited (VC + consumer POV). Not yet placed on website. Delivery format (PDF, video, demo, image, reel, short-form) not yet decided.

Inputs locked:
- Robot type: Delivery robots via Pudu
- Fleet: mid-tail, ~45 robots, revenue-share contracts across 14 restaurant/retail accounts
- Core tension: missed payment / default risk visibility, reframed to P&L (fixed financing cost vs. variable, telemetry-dependent revenue)
- Persona: Maya, Operations Lead, running the fleet for 3 years

---

**Illustrative Scenario.** Botlien has not yet completed a paid deployment. This case study is a modeled scenario, built from real Pudu telemetry data and realistic RaaS market assumptions, illustrating how Botlien's platform would apply to a representative mid-tail delivery robot operator. The API integration described is grounded in Pudu's published developer documentation; a live connection is in testing as of this writing.

## Meet Maya

Maya has run her company's delivery robot fleet for three years. Forty-five Pudu delivery robots, deployed across fourteen restaurant and retail accounts, each on a revenue-share agreement. Her company financed the fleet through an equipment loan, one fixed payment due every month no matter what her accounts do. On paper, revenue-share income is supposed to cover it with room to spare. In practice, she doesn't find out an account's volume slipped until the books close and her bookkeeper flags a margin she can't explain, and by then that month's equipment payment has already gone out fixed, while the revenue behind it came in short.

She'd tried tracking it herself in a spreadsheet. It worked for about a month, then fell behind the moment she added a fifteenth account, Pudu's raw exports don't map to her contract terms on their own, someone has to translate delivery counts into dollars by hand, every account, every month. That someone was her, on top of everything else running the fleet actually requires.

"The equipment payment doesn't care if an account had a slow month. I don't find out my margin's off until the books are already closed. By then there's nothing to do about that month, only the next one."

## Finding Botlien

Maya wasn't looking for a robotics vendor, she already had one, and she wasn't looking for another fleet dashboard either, Pudu's told her plenty about the robots themselves for years. She was searching for something narrower: a way to see her own margin clearly, account by account, without doing the math herself every month. Botlien showed up because that's the specific gap it fills, not fleet monitoring, not generic accounting software, the translation layer between the two.

## Demo, Onboarding, Connecting the Fleet

A short call, fleet size, contract structure, a look at what the dashboard shows on an operation like hers. Onboarding rides on infrastructure that already exists: she authenticates her Pudu account through Pudu's own application credential system, and Botlien pulls task counts, plates delivered, mileage, and runtime per robot and per account, then maps it against her actual revenue-share terms. No new hardware, no new robot software. Her data stays hers, Botlien reads only what Pudu already exposes, under a signed data access agreement, nothing is sold or shared, and access can be revoked at any time.

## What She Sees

Per-account margin instead of raw delivery counts, revenue-share income measured against the fixed cost it has to cover, not cash flow in isolation. A rolling ninety-day projection instead of a monthly surprise. Three accounts, side by side: one healthy and pacing ahead of commitment, one trending five to ten percent under its committed volume for three straight weeks, flagged with a suggested next step, hold expansion into that account or open a renegotiation conversation before the next invoice, not just a number with no direction attached. And one that would have been a silent shortfall the old way, now caught three weeks before the invoice reflects it, the difference between renegotiating on her terms and eating a $2,000 to $4,000 gap for the month with no warning.

## What It's Worth to Her

She doesn't call it a robotics tool. She calls it the thing that tells her, in dollars, what she'd already been told in delivery counts, and it means the fifteenth account, and the twentieth, don't require her to do the math herself anymore. Her situation isn't unique, most mid-tail operators are running the same fixed-financing-against-variable-revenue math on a spreadsheet or from memory, which is part of why an operator like her represents a real slice of the market, not an edge case. Whether that turns into the kind of referral operators give each other at the next industry meetup is the kind of thing only a real deployment will prove, but it's the obvious next channel to test.

---

## Audit notes (for future edits)

VC-POV harsh audit findings and how each was addressed:
- No quantified outcome -> added $2,000-$4,000 modeled range in "What She Sees"
- "Why not a spreadsheet" unanswered -> added spreadsheet-failed-at-scale beat in "Meet Maya"
- No differentiation vs. Formant/Findustrial/generic dashboards -> added contrast line in "Finding Botlien"
- Technical readiness overstated (no live integration yet) -> disclaimer now specifies docs-grounded, live connection in testing
- Discovery channel (SEO/GEO) presented as proven -> left as narrative but covered by top disclaimer; connects to the still-open SEO whiteboard item
- Referral loop stated as fact -> de-escalated to hypothesis, framed as "next channel to test"
- Representativeness of this operator profile vs. TAM unstated -> added line tying Maya's situation to the broader mid-tail operator segment

Consumer-POV harsh audit findings and how each was addressed:
- Data trust / third-party access to financials unaddressed -> added signed data access agreement, no sale/share, revocable access
- No pricing, so no ROI math possible -> intentionally left open, inventing a number would be worse
- Flag with no action shown -> added suggested next step (hold expansion / renegotiate) to the risk flag
- Onboarding friction understated (Pudu key application isn't necessarily instant) -> not yet fixed, worth revisiting
- Contract-type uniformity (all revenue-share) is the easy case -> not fixed, real fleets often mix flat-lease and revenue-share; possible follow-up case study

## Open items
- Delivery format decision: PDF vs. video vs. live demo vs. image vs. reel vs. short-form, not yet made
- Pricing not yet defined, blocks full ROI framing
- Mixed-contract-type version not yet drafted
- Actual live Pudu API connection still in testing (Samuel)
