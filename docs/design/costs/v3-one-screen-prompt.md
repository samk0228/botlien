# Botlien Costs screen: one interactive frame

Build the Costs screen of Botlien, an operator dashboard that turns robot telemetry into money. Deliver **one frame, 1180 × 640, as a clickable prototype**. Nothing else on the canvas. Every state below is reached by clicking inside this one frame: rows expand in place and push the content below them down, one row open at a time, and one control changes the numbers live.

## 1. Visual system (match exactly, do not restyle)

- Font: Inter, weights 400 to 800, system-ui fallback, antialiased. Base 14px, line-height 1.5.
- Page background `#F1F2FC` with a fixed gradient `linear-gradient(160deg, #EDEFFC 0%, #F4F1FB 45%, #F2F6FD 100%)`. Content column max-width 1060px, centred, padding 32px 24px 64px.
- Ink: `#16204A` primary text and bars, `#6B7392` secondary text, `#9AA1BC` captions and eyebrows.
- Hairlines: `rgba(10,10,10,.10)` for card borders and dividers, `rgba(10,10,10,.16)` for control borders.
- Cards: 1px hairline border, 6px radius, transparent fill. Headline card padding 22px 24px 20px. Tiles 15px 16px. Panels 4px 18px.
- Eyebrows: 11px, uppercase, letter-spacing .08em, weight 700, `#9AA1BC`. Section eyebrow margin 34px 0 10px.
- Title `Costs`: 27px, weight 700, letter-spacing -.02em. Badge `DEMO · SIMULATED FLEET`: 10px, weight 700, letter-spacing .06em, `#6B7392`, 1px `rgba(10,10,10,.16)` border, 3px radius, padding 2px 7px, fill `rgba(10,10,10,.04)`.
- Period pill `Aug 10 – 31, 2026`: 12.5px, weight 700, hairline border, 4px radius, padding 8px 14px. Site filter `All 3 sites ⌄` beside it, same size, weight 600.
- Headline figure: 36px, weight 700, letter-spacing -.03em, line-height 1.1, tabular numerals.
- Tile value 26px weight 700 tabular; tile note 11.5px `#9AA1BC` line-height 1.55.
- Robot rows: 13px padding top and bottom, hairline between. Name 13.5px weight 600; qualifier 11.5px `#9AA1BC`; money right-aligned 15px weight 700 tabular; arithmetic line in `ui-monospace, Menlo, "SF Mono", monospace` 11px `#9AA1BC` line-height 1.6, margin-top 7px.
- Lead sentence 14px `#16204A` line-height 1.7. Small print 11px `#9AA1BC` line-height 1.75.
- All money and counts use `font-variant-numeric: tabular-nums`.
- **No status colours anywhere.** No red, green, or amber. Ink density carries magnitude.
- Hit targets at least 44px.

## 2. The default state: 60 words or fewer

Count them. Everything visible before any click, including header, hero, both rows, and the footer link, totals 60 words or fewer.

**Header.** Left: `Costs` and the badge. Right: `All 3 sites ⌄` and the period pill.

**Hero card.** Eyebrow `BEYOND THE LEASE`. Figure `$948.00`. Below it a 14px stacked bar, 2px gaps, 2px radius, full card width: $16,700.00 lease in `#16204A` at 28% opacity, $444.00 measured labour in solid `#16204A`, $504.00 estimated labour hatched with `repeating-linear-gradient(135deg, rgba(10,10,10,.35) 0 2px, rgba(10,10,10,.08) 2px 5px)`. Labels under the bar, 11.5px `#9AA1BC` with figures in `#6B7392` weight 600: left `lease $16,700.00`, right `measured $444.00 · estimated $504.00`. These labels are the fill legend; add no other legend.

**Eyebrow** `WHAT TO DO`.

**Two rows, never padded to three.** Each row: 2px left rule, padding 14px 0 14px 15px, hairline between rows. A **solid** rule is money already spent; a **dashed** rule is money conditional on acting. One line plus a subline:

1. rank numeral, mono 11px `#9AA1BC`, 14px wide
2. headline, 14.5px weight 700, starts with a verb, six words or fewer
3. magnitude, right-aligned, 16px weight 700 tabular
4. shape, one 110 × 24 graphic, no axis, labels, or legend
5. chevron, 16px, 1.5px stroke, `#6B7392`, rotates 90° when open

Subline 13px `#6B7392`, indented 28px, ten words or fewer.

- **Row 1, solid rule:** `1` · `Go watch the 2pm shift` · `$948.00` · shape: the 24-hour stall strip in miniature, bars `#16204A` with opacity scaling from 35% to 100% by height, a 1px bracket over 2p–4p · subline `38% of it lands between 2p and 4p`
- **Row 2, dashed rule:** `2` · `Try Fetch on the Locus routes` · `$2,533` · shape: two horizontal bars, cheapest first, Locus at 0.44 lighter and shorter, Fetch at 0.61 darker and longer · subline `if it is the machine, not the route`

Costs rank before opportunities regardless of size. $948 spent outranks $2,533 conditional.

**Footer link**, right-aligned: `how we count ›` 12.5px weight 600 `#6B7392`, chevron rotates when open.

## 3. Click row 1: expands in place, indented 28px

Three tiles in a row:
- `CLEARING STALLS` · `$504.00` · `210 stalls, counted from telemetry, at an assumed 6 minutes of someone's time each`
- `DRIVING BY HAND` · `$444.00` · `18.5 hours with a person on the controls, measured directly, no assumption`
- `ON TOP OF THE LEASE` · `$948.00` · `labour your invoice never shows, over the same period as every other figure here`

Panel with lead `210 stalls cleared by hand, about 21 hours, plus 18.5 hours with someone driving the robot directly.` then rows, worst first:
- `Scrubber 1 (nights)` · `driven by hand` · `$444.00` · `18.5 h driven by hand × $24.00/h`
- `Picker 2 (Zone B)` · `142 stalls` · `$340.80` · `14.2 h clearing × $24.00/h · robot itself stalled 19.4 h`
- `Picker 5 (Zone A)` · `68 stalls` · `$163.20` · `6.8 h clearing × $24.00/h · robot itself stalled 9.6 h`

Zero terms are dropped from arithmetic lines. Hours always carry one decimal.

Above a hairline at the bottom of the panel: `Minutes of someone's time per stall`, a stepper (44px − and + buttons, `6` in the middle at weight 700), caption `assumed, not measured · moves the clearing figure and the total`. **Live:** clearing = 210 × minutes ÷ 60 × $24.00; Picker 2 = 142 × minutes ÷ 60 × $24.00; Picker 5 = 68 × minutes ÷ 60 × $24.00; the total, the hero figure, the hero bar's hatched segment, the row 1 magnitude and the tiles all recompute. Range 1 to 30.

Eyebrow `WHEN THEY GET STUCK`, then a panel:
- Lead `Your robots lost **31.0 hours** to stalls this period. Here is when.`
- `Order picking` 13px weight 600, `29.3 h lost` right in `#9AA1BC`
- 24-column strip, midnight to midnight, axis `12a 6a 12p 6p 12a` in 9px `#9AA1BC`, faint wash `rgba(10,10,10,.035)` over 6a to 6p, bracket above 2p–3p with `11.1h`. Hours from 6a: 0.5, 1.0, 1.5, 1.8, 2.0, 1.9, 1.7, 2.2, 5.2, 5.9, 2.9, 2.7.
- Reading 13px `#6B7392`: `**11.1 of them, 38%, fell between 2pm and 4pm**, which is only 17% of your working hours. In that window robots lost 4.4% of their working time to being stuck, against 1.9% across the day, so it is **2.3 times worse than a normal hour**. That is the shift to go and watch.`
- `Floor cleaning`, `1.7 h lost`. Same strip **on the same vertical scale** (ceiling 5.9h) so it renders as a sliver. Wash over 10p to 5a, wrapping midnight. Hours from 10p: 0.2, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25. No bracket.
- Reading `Spread evenly across the night shift. No shift to go and watch here; if anything, this points at the machines or the routes.`
- Legend 11px `#9AA1BC`: `shaded band is the operating window · bracket marks the worst two hours · every strip shares one scale, tallest bar = 5.9h`

No minimum bar height, no clamping.

## 4. Click row 2: expands in place, indented 28px

One panel:
- Lead `Your Locus machines do the same job for 44 cents per pick. Your Fetch machines cost 61 cents, 39% more.`
- `Locus` · `6 robots` · `$0.44` · `41,200 picks started · 388 active hours · $18,128.00 of invoice · 2.61x coverage`
- `Fetch` · `3 robots` · `$0.61` · `14,900 picks started · 152 active hours · $9,089.00 of invoice · 1.88x coverage`
- Small print `Cost per pick is the same figure used everywhere else on this page, invoice divided by work performed, so a brand row can be checked against the robot rows it came from. At the volume your Fetch machines actually ran, that gap is worth about $2,533 over this period. Compared inside order picking only; floor cleaning runs one make, so it has no table.`

Opening row 2 closes row 1 and the reverse.

## 5. Click "how we count": expands under the link

Hairline on top, 13px `#6B7392` paragraphs, max-width 78ch, bold lead-ins in `#16204A`:

1. **Solid fill is measured. Hatched fill is estimated** from a stated assumption. Paired bars always compare money, and longer is more. A **solid left rule** is money already spent; a **dashed left rule** is money you only get if you act. Ink carries magnitude; there are no status colours anywhere.
2. **The stall count is measured. The minutes per stall are not.** They are our assumption about how long a person takes to notice, walk over, free the machine and walk back. Halve it and the clearing figure halves. The control sits next to the figure it changes.
3. **Stalled robot hours are shown and never billed as labour.** Your coverage figure already counts them as work the robot did not perform, and billing the same hours twice would flatter this page.
4. **Peaks are found inside one kind of work, never across the fleet.** A night scrubber scored against the day shift's picking peak would read as permanently idle. The share of running time inside the bracket is assumed rather than measured in this prototype.
5. **A brand gap is an observation, not an experiment.** Two brands in one fleet are rarely given the same routes, shifts or floors, so the gap only becomes a verdict on the machines once they have run the same work. Swapping them for a fortnight settles it. When a brand figure rests on a single machine, the row says so by name.
6. Every figure shows its arithmetic so it can be checked on paper. Counts are mission starts reported by the robot, so they read as runs started. Work is valued at replacement rates, never at what an order was worth.

## 6. Out of scope for this frame

The quiet period (zero rows) and the phone layout come in later iterations. Do not add frames for them.

## 7. Acceptance

- Default state is 60 words or fewer. Count it.
- Both headlines start with a verb and are six words or fewer.
- The two rows never describe the same money.
- Each row expands in place; one open at a time; chevron rotates.
- The stepper moves the clearing figure, the total, the hero, the hero bar, and the row 1 magnitude together.
- Both strips share one vertical scale.
- Every sentence not in the default state is reachable in one click.
- A reader who never clicks knows what to do first and how much it is worth.
