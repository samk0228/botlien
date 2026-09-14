# Botlien Costs screen: build the action queue

Build the Costs screen of Botlien, an operator dashboard that turns robot telemetry into money. This is a redesign of an existing screen into an action queue. Build it as a clickable prototype: rows expand in place, one open at a time, and one control changes the numbers live.

Deliver these frames on one canvas, all sharing one component and one set of numbers:

1. **Costs, default** (1180 × 640): the 60-word view, nothing expanded.
2. **Row 1 open** (1180 × 1820): the cost of keeping the robots running, with both timing charts.
3. **Row 2 open** (1180 × 900): brand against brand.
4. **How we count** (1180 × 1020): the method layer expanded at the bottom of the page.
5. **Nothing to chase** (1180 × 520): the quiet period, zero rows.
6. **Phone** (390 × 844): the default view at phone width.

---

## 1. Visual system (match exactly, do not restyle)

This screen has to sit beside screens that already ship. Use these values, not approximations.

- Font: Inter, weights 400 to 800, system-ui fallback. Antialiased. Base 14px, line-height 1.5.
- Page background: `#F1F2FC` with a fixed gradient `linear-gradient(160deg, #EDEFFC 0%, #F4F1FB 45%, #F2F6FD 100%)`. Content column max-width 1060px, centred, page padding 32px 24px 64px.
- Ink: `--fg1 #16204A` (primary text and bars), `--fg2 #6B7392` (secondary text), `--fg3 #9AA1BC` (captions, eyebrows).
- Hairlines: `rgba(10,10,10,.10)` for card borders and dividers, `rgba(10,10,10,.16)` for control borders.
- Cards: 1px hairline border, 6px radius, transparent background. Headline card padding 22px 24px 20px. Tiles padding 15px 16px. Panels padding 4px 18px.
- Eyebrows (section labels, tile captions): 11px, uppercase, letter-spacing .08em, weight 700, `--fg3`. Section eyebrow margin 34px 0 10px.
- Page title: 27px, weight 700, letter-spacing -.02em. Beside it a badge `DEMO · SIMULATED FLEET`: 10px, weight 700, letter-spacing .06em, `--fg2`, 1px `rgba(10,10,10,.16)` border, 3px radius, padding 2px 7px, background `rgba(10,10,10,.04)`.
- Period pill: 12.5px, weight 700, hairline border, 4px radius, padding 8px 14px. Site filter button beside it: same size, weight 600, with a 12px chevron.
- Headline figure: 36px, weight 700, letter-spacing -.03em, line-height 1.1, tabular numerals.
- Tile value: 26px, weight 700, tabular. Tile note: 11.5px, `--fg3`, line-height 1.55.
- Robot rows: 13px padding top and bottom, hairline between rows. Name 13.5px weight 600; qualifier 11.5px `--fg3`; money right-aligned 15px weight 700 tabular. Arithmetic line underneath in `ui-monospace, Menlo, "SF Mono", monospace`, 11px, `--fg3`, line-height 1.6, margin-top 7px.
- Lead sentence: 14px, `--fg1`, line-height 1.7. Small print: 11px, `--fg3`, line-height 1.75.
- Every number that is money or a count uses `font-variant-numeric: tabular-nums`.
- **No status colours anywhere.** No red, green, or amber. Ink density carries magnitude.
- Hit targets in the prototype are at least 44px.

## 2. The default view: 60 words or fewer

Count them. Everything visible before any click must total 60 words or fewer, including the header, the hero, the two rows, and the "how we count" link.

**Header row.** Left: `Costs` and the DEMO badge. Right: `All 3 sites ⌄` and the period pill `Aug 10 – 31, 2026`.

**Hero card.**
- Eyebrow: `BEYOND THE LEASE`
- Figure: `$948.00`
- Under it a 14px-tall stacked bar, 2px gaps, 2px radius, spanning the card: three segments proportional to $16,700.00 lease (fg1 at 28% opacity), $444.00 measured labour (fg1 solid), $504.00 estimated labour (hatched: `repeating-linear-gradient(135deg, rgba(10,10,10,.35) 0 2px, rgba(10,10,10,.08) 2px 5px)`).
- Labels under the bar, 11.5px `--fg3` with the figures in `--fg2` weight 600: left `lease $16,700.00`, right `measured $444.00 · estimated $504.00`. These labels are the page's fill legend, so no separate legend appears.

**Eyebrow:** `WHAT TO DO`

**Two rows, and only two.** Never pad to three. Rows never describe the same money twice.

Row anatomy, one line plus a subline:
1. rank numeral, mono 11px `--fg3`, 14px wide
2. the headline, 14.5px weight 700, starts with a verb, six words or fewer
3. the magnitude, right-aligned, 16px weight 700 tabular
4. the shape: one 110 × 24 graphic, no axis, no labels, no legend
5. a 16px chevron, 1.5px stroke, `--fg2`, which rotates 90° when the row is open

Subline: 13px `--fg2`, indented 28px, ten words or fewer.

Row treatment: each row has a 2px left rule and padding 14px 0 14px 15px, reusing the convention from the Dashboard's "Needs attention" card. A **solid** rule means money already spent. A **dashed** rule means money conditional on the operator acting. A hairline separates the rows.

- **Row 1 (cost, solid rule):** `1` · `Go watch the 2pm shift` · `$948.00` · shape = the 24-hour stall strip in miniature with a bracket over 2p–4p · subline `38% of it lands between 2p and 4p`
- **Row 2 (opportunity, dashed rule):** `2` · `Try Fetch on the Locus routes` · `$2,533` · shape = two horizontal bars, cheapest first (Locus at 0.44, Fetch at 0.61 and darker; longer is more) · subline `if it is the machine, not the route`

Ordering rule: costs before opportunities regardless of size, then by size within each group. $948 spent outranks $2,533 conditional.

**Footer link**, right-aligned: `how we count ›` 12.5px weight 600 `--fg2`.

## 3. Row 1 expanded (in place, pushes row 2 down)

Indented 28px under the row. Contents, in order:

**Three tiles in a row:**
- `CLEARING STALLS` · `$504.00` · `210 stalls, counted from telemetry, at an assumed 6 minutes of someone's time each`
- `DRIVING BY HAND` · `$444.00` · `18.5 hours with a person on the controls, measured directly, no assumption`
- `ON TOP OF THE LEASE` · `$948.00` · `labour your invoice never shows, over the same period as every other figure here`

**Panel** with the lead sentence `210 stalls cleared by hand, about 21 hours, plus 18.5 hours with someone driving the robot directly.` then three robot rows, worst first:
- `Scrubber 1 (nights)` · `driven by hand` · `$444.00` · `18.5 h driven by hand × $24.00/h`
- `Picker 2 (Zone B)` · `142 stalls` · `$340.80` · `14.2 h clearing × $24.00/h · robot itself stalled 19.4 h`
- `Picker 5 (Zone A)` · `68 stalls` · `$163.20` · `6.8 h clearing × $24.00/h · robot itself stalled 9.6 h`

Zero terms are dropped from arithmetic lines. Hours in arithmetic lines always carry one decimal.

Then, inside the same panel above a hairline: `Minutes of someone's time per stall` with a stepper control (44px − and + buttons, value `6` in the middle, weight 700) and the caption `assumed, not measured · moves the clearing figure and the total`. **The stepper is live:** clearing = 210 × minutes ÷ 60 × $24.00; Picker 2 = 142 × minutes ÷ 60 × $24.00; Picker 5 = 68 × minutes ÷ 60 × $24.00; the total, the hero figure, the hero bar's estimated segment, the row 1 magnitude, and the tile all recompute. Range 1 to 30.

**Eyebrow** `WHEN THEY GET STUCK`, then a panel:
- Lead: `Your robots lost **31.0 hours** to stalls this period. Here is when.`
- `Order picking` (13px weight 600) with `29.3 h lost` right-aligned in `--fg3`
- A 24-column strip, midnight to midnight, axis labelled `12a 6a 12p 6p 12a` in 9px `--fg3`. A faint wash (`rgba(10,10,10,.035)`) over the operating window 6a to 6p. Bars in `--fg1`, opacity scaling from 35% to 100% with height. A bracket above 2p–3p with the figure `11.1h`. Hourly stall hours from 6a: 0.5, 1.0, 1.5, 1.8, 2.0, 1.9, 1.7, 2.2, 5.2, 5.9, 2.9, 2.7 (sums to 29.3; 2p + 3p = 11.1).
- Reading, 13px `--fg2`: `**11.1 of them, 38%, fell between 2pm and 4pm**, which is only 17% of your working hours. In that window robots lost 4.4% of their working time to being stuck, against 1.9% across the day, so it is **2.3 times worse than a normal hour**. That is the shift to go and watch.`
- `Floor cleaning` with `1.7 h lost`
- The same strip, **on the same vertical scale as the picking strip** (ceiling 5.9h), so it renders as a sliver. Wash over 10p to 5a, wrapping midnight. Hours from 10p: 0.2, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25. No bracket.
- Reading: `Spread evenly across the night shift. No shift to go and watch here; if anything, this points at the machines or the routes.`
- Legend, 11px `--fg3`: `shaded band is the operating window · bracket marks the worst two hours · every strip shares one scale, tallest bar = 5.9h`

No minimum bar height, no clamping. Near-zero draws as near-zero.

## 4. Row 2 expanded

Indented 28px. One panel:
- Lead: `Your Locus machines do the same job for 44 cents per pick. Your Fetch machines cost 61 cents, 39% more.`
- `Locus` · `6 robots` · `$0.44` · `41,200 picks started · 388 active hours · $18,128.00 of invoice · 2.61x coverage`
- `Fetch` · `3 robots` · `$0.61` · `14,900 picks started · 152 active hours · $9,089.00 of invoice · 1.88x coverage`
- Small print: `Cost per pick is the same figure used everywhere else on this page, invoice divided by work performed, so a brand row can be checked against the robot rows it came from. At the volume your Fetch machines actually ran, that gap is worth about $2,533 over this period. Compared inside order picking only; floor cleaning runs one make, so it has no table.`

If a brand figure rested on a single machine, the row would say so by name. It does not fire in this data.

## 5. How we count (expands under the footer link)

Hairline on top, 13px `--fg2` paragraphs, max-width 78ch, bold lead-ins in `--fg1`:

1. **Solid fill is measured. Hatched fill is estimated** from a stated assumption. Paired bars always compare money, and longer is more. A **solid left rule** is money already spent; a **dashed left rule** is money you only get if you act. Ink carries magnitude; there are no status colours anywhere.
2. **The stall count is measured. The minutes per stall are not.** They are our assumption about how long a person takes to notice, walk over, free the machine and walk back. Halve it and the clearing figure halves. The control sits next to the figure it changes.
3. **Stalled robot hours are shown and never billed as labour.** Your coverage figure already counts them as work the robot did not perform, and billing the same hours twice would flatter this page.
4. **Peaks are found inside one kind of work, never across the fleet.** A night scrubber scored against the day shift's picking peak would read as permanently idle. The share of running time inside the bracket is assumed rather than measured in this prototype.
5. **A brand gap is an observation, not an experiment.** Two brands in one fleet are rarely given the same routes, shifts or floors, so the gap only becomes a verdict on the machines once they have run the same work. Swapping them for a fortnight settles it. When a brand figure rests on a single machine, the row says so by name.
6. Every figure shows its arithmetic so it can be checked on paper. Counts are mission starts reported by the robot, so they read as runs started. Work is valued at replacement rates, never at what an order was worth.

## 6. Nothing to chase (the quiet period)

Same header and hero, with the figure `$61.20` (10 stalls at 6 minutes = $24.00 estimated, 1.55 hours by hand = $37.20 measured). The bar's labour segments are hairline-thin, which is correct. In place of the eyebrow and the rows, one card:

`**Nothing to chase this period.**`
`Your robots cost $61.20 in staff time across 22 days, which is noise. The detail is still here if you want it.`

The `how we count` link stays. Never render an empty chart frame or a zero-length bar as a placeholder.

## 7. Phone (390 wide)

Header stacks: title and badge on one line, site filter and period pill on the next, full width. Hero bar labels stack vertically, left-aligned. In each row the shape is hidden; rank, headline, magnitude and chevron stay on one line with the headline allowed to wrap; the subline sits below. Tiles stack to one column in the expanded row.

## 8. What must not change

- The hero figure and its stacked bar.
- Every number, figure and caveat above. They move between layers, none is deleted.
- Measured versus estimated carried by fill, never by a sentence in the default view.
- Stalled hours shown as context, never priced as labour.
- Monochrome throughout.

## 9. Acceptance

- Default view is 60 words or fewer. Count it.
- Every row headline starts with a verb and is six words or fewer.
- No two rows describe the same money.
- The queue renders correctly at zero rows (frame 5) and two rows (frames 1 to 4).
- Every sentence removed from the default view is findable within one click.
- The minutes stepper moves the clearing figure, the total, the hero, and the row 1 magnitude together.
- A reader who never opens a detail knows what to do first and how much it is worth.
