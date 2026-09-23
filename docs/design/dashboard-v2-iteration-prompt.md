# Botlien dashboard: iteration brief for the Demo prototype

Target: the **Botlien Demo** artifact (https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9)
in Claude Design. Its source is `prototype/src/botlien.part.html` on `main`. Every
change below edits that prototype in place. Do not create new frames or a standalone
screen. When done, hand the artifact back so the repo can be brought to it.

Nothing here changes the numbers or the arithmetic. These are hierarchy, state, copy
and token changes from the 2026-09-14 design review. Tokens are in `DESIGN.md`.

## 1. Tokens (every screen)

- `--fg3` becomes `#6F7793` (was `#9AA1BC`). `--fg2` becomes `#5E6685` (was `#6B7392`).
  Nothing else about the ramp changes.
- Page ground stays white `#FFFFFF`.
- Minimum size for any text that carries meaning is 11.5px. Eyebrows and arithmetic
  lines may stay 11px.

## 2. Period preamble (Dashboard, Fleet, Costs)

Remove the two lines under each page title ("Aug 4 – Sep 3, 2026 · 31 days of robot
activity counted..." and "This period runs to Sep 3, 2026. Numbers keep moving until
then..."). Both facts move into the period pill: the pill reads `Aug 4 – Sep 3, 2026 ·
open`, and opening it shows the two sentences once. Every screen gains about 80px.

## 3. Dashboard: one anchor row

Replace the three-column mosaic's first row with a **full-width anchor row**:

- Left half: `2.39x` at 48px / 700 / -.03em, the `open period, still moving` tag beside
  it, then the existing two sentences ("Your whole fleet across all 3 sites, 13 robots
  averaged together." and "Every $1 of lease bought $2.39...").
- Right half: the existing **A person vs your robots** comparison (the two bars and their
  captions, "Your robots cost $22,326.40 less this period", the See Costs link). The
  Compare dropdown stays.
- One hairline card around the whole row, 22px 24px padding.

Second band, two columns, in this order: **Needs attention**, **Where the work is**,
**Coverage over time**, **Utilization**. Same card styles as today.

Third band, collapsed by default with a chevron: **Tax shield and depreciation** and
**The one input you cannot measure**. Collapsed header shows the card title and its
headline figure only ($109,000.00 year-1 tax shield; 30 picks/hr = 4.22x). Expanding
reveals the current card content unchanged.

Customize (drag to reorder) applies to bands two and three. The anchor row is fixed.

## 4. Costs: nest the detail

The v3 action queue stays exactly as built (hero, two rows, rules, mini strips, one
open at a time). Inside an expanded row:

- Indent the detail 28px so it sits under the headline, not under the rank numeral.
- "What it costs to keep them running" and "When they get stuck" become eyebrows (11px,
  uppercase, .08em, fg3), not 17px headings.
- The strip legend ("stall time landing in that hour · hours this work runs · bracket
  marks the worst two hours · tallest bar = 5.6h") appears once, under the second strip,
  not under each.
- The bottom legend row ("measured · estimated · spent · if you act") stays as the
  page-level vocabulary.
- Add a quiet affordance at the end of each detail: a small outlined button `Mark as
  tried` that, when pressed, adds `tried Sep 14` to the row's subline. State only, no
  workflow.

Check the row 2 headline reads `Try Locus on the Fetch routes` (the cheaper brand on
the pricier brand's routes). It does today; keep it that way.

## 5. Fleet: absences and the essay

- Rows whose vendor reports no condition show a small fg3 tag `not reported` in the
  condition column instead of the sentence "condition not reported by Locus". The two
  Gausium rows keep their full readings.
- Replace the "Why condition sits next to the money" section with one sentence in
  13px fg2 under the list: `Gausium is the only vendor here that reports consumable
  wear, so only its scrubbers carry a condition reading.` Keep the existing footnote
  that counts the robots without condition data, but drop the list of their names.
- The row expander `+` stays, but the whole row is the click target and the `+`
  becomes a 16px chevron matching Costs.

## 6. Numbers: tell benchmark from set

Each row's inline values gain a tag after them: `benchmark` (fg3, hair2 border) when
every value is the category default, `yours` when the owner has overridden any. In the
edit form, "This robot costs $0.14 / pick" is derived, not an input: render it as read
text with the `WORKED OUT` tag from Fleet, not as a field. Remove the duplicated helper
("Its invoice, spread across what it actually did." and "Its invoice over what it
actually did." say the same thing; keep the first).

## 7. Sign-in: lead with the promise

- `See a real statement first, no account` becomes a secondary outlined button
  directly under the email field, full width, with its subline ("A 13-robot fulfillment
  fleet, one full month, every figure live...") under the button.
- `Continue with Google` stays below the `or` divider. It is planned and will be
  connected later.
- The paragraph about passwords ("Owners open Botlien monthly...") stays at the bottom.

## 8. Notifications

The subhead says "Four rules" above six rows. Change to `Six rules. Each one names its
trigger, so nothing arrives unexplained.` Or count them dynamically.

## 9. Phone (390px)

Fleet and Numbers rows become two lines: name with its status tag under it on the left,
the ranking figure on the right (coverage on Fleet, monthly invoice on Numbers).
Duty, condition, change vs last month and the inline values move into the expanded row.
The Dashboard anchor row stacks: figure and sentences first, comparison bars under.

## 10. States to include

| Screen | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Dashboard | skeleton bars in the three chart cards, figures render first | existing "Nothing has been imported for this period yet" view | import failure banner (existing rule) | period closed: tag reads `closed`, figures lock | some robots unpriced: "N robots left out for want of a rate" line under the anchor (exists in served app) |
| Fleet | rows render with figures, charts fill after | "No robots in this site" with the site filter reset link | none | badge clears when the under-lease robot recovers | `not reported` tags (section 5) |
| Costs | hero first, rows after | "Nothing to chase this period" card from the v3 brief | none | row marked tried (section 4) | one row when only one finding |
| Numbers | rows immediate | none (robots always exist after import) | invalid number: field border hair3, helper in fg2 | `Saved` button state, row tag flips to `yours` | `benchmark` tag |
| Sign-in | button label `Sending...` | none | "We don't have that address" inline under the field | "Check your email" panel | none |

## 11. Acceptance

- Dashboard: one figure is unmistakably first at a glance; the anchor row spans the
  content width; Tax shield is collapsed by default.
- No screen opens with the two-line period preamble.
- Costs detail reads as nested under its row; one strip legend per expansion.
- Fleet: two robots show condition readings, eleven show a small tag, one footnote.
- fg3 text measures at least 4.5:1 on white.
- At 390px every Fleet and Numbers row is two lines.
- Sign-in shows the demo as a button above the divider; Google remains.
- Notifications subhead count matches the rows.
