# Botlien Demo: add Payback, Contract, Decisions, and a locked Benchmark

Extend the Botlien Demo, the clickable prototype at
https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9. It is one self-contained
HTML app (vanilla JS, one `S` state object, `render()` rebuilds the page,
`ACTIONS` keyed by `data-act`). Build inside it. Everything that exists
stays byte-for-byte as it is; these are additions.

Four new pages, one new input tab, and the wiring that makes them part of
the product. Together they tell one story: what the robot company promised,
what it delivered, and what to do about it.

---

## 0. Rules the existing app already follows. Follow them.

- **One calculation, many views.** Every figure on a page reads from one
  function (the way Dashboard, Fleet and Numbers all read
  `computeStatement()`). Nothing recomputes on its own. An edit on Numbers
  moves every page that reads it.
- **Inputs are live.** Typing into a field patches the figures in place
  (see `applySetupRow`); a full re-render mid-keystroke would drop focus.
- **Measured vs assumed is stated at the figure**, not in a footnote. Solid
  fill is measured. Hatched fill (`--hatch`) is estimated. Anything the
  owner typed is marked "yours"; anything we supplied is marked
  "benchmark" (the `pill()` helper).
- **Absent looks absent, never like zero.** A robot with no downtime has no
  incident list, not an empty one. A robot that reports nothing gets the
  `not reported` tag.
- **No status colours.** No red, green or amber. Ink density and shape
  carry state. Use the existing tokens: `--fg1 #16204A`, `--fg2 #5E6685`,
  `--fg3 #6F7793`, `--page-bg #F4F5F9`, `--card #FFFFFF`, hairlines
  `--hair` / `--hair2`, `--ghost` for tinted fills.
- **Use the existing components.** `metricTabs()` + `metricPanel()` for
  the tile strip and its panel; the Fleet table shape (tinted header row,
  rows that are the click target, chevron that rotates, detail expands in
  place, one open at a time); `pill()`, `cardTitle()`, `sparklineChart()`,
  `miniPeriodBars()`, `subNav()`, `board()`.
- **Respect scope and search.** Every new table filters by `S.dashScope`
  (the All 3 sites / Pier 4 / Marina / Airport control) and narrows by the
  top-bar search, the way Fleet does.
- **Prose stays short.** No "how we count" essays on working screens. One
  lead sentence, figures, a one-line note where a figure needs its source
  named. Copy never uses em dashes; use commas or full stops.
- **Never claim what a robot could do.** Report what it did. Where a page
  has to talk about demand elsewhere, say the demand exists, not that this
  robot would meet it.
- **Phone width works.** Below 900px the rail is already a topbar; new
  tables collapse the secondary columns the way `[data-fleet-row]` does.

---

## 1. Inputs: a "Contract" tab on Numbers

Numbers currently has two sub-nav items, `Per robot` and `Where the rates
come from`. Add a third, `Contract`, icon `file-text`.

Four inputs per robot, typed once. Prefilled for the demo fleet with this
table, index-for-index with `CONFIRM` / `ROBOTS` / `SETUP`:

| # | Robot | Contract start | Term (months) | Promised payback (months) | Promised uptime |
|---|---|---|---|---|---|
| 0 | Picker 1 (Zone A) | 2025-07-01 | 36 | 14 | 95% |
| 1 | Picker 2 (Zone B) | 2025-07-01 | 36 | 14 | 95% |
| 2 | Freight runner | 2025-10-01 | 36 | 12 | 97% |
| 3 | Picker 3 (Zone C) | 2025-07-01 | 36 | 14 | 95% |
| 4 | Scrubber 50 | 2026-01-01 | 24 | 18 | 95% |
| 5 | Scrubber 75 (nights) | 2026-01-01 | 24 | 18 | 95% |
| 6 | Picker 1 (Marina) | 2026-03-01 | 12 | 14 | 95% |
| 7 | Picker 2 (Marina) | 2026-03-01 | 12 | 14 | 95% |
| 8 | Scrubber (Marina) | 2026-03-01 | 24 | 18 | 95% |
| 9 | Picker 1 (Airport) | 2025-11-01 | 36 | 14 | 95% |
| 10 | Picker 2 (Airport) | 2025-11-01 | 36 | 14 | 95% |
| 11 | Picker 3 (Airport) | 2025-11-01 | 36 | 14 | 95% |
| 12 | Scrubber (Airport) | 2025-11-01 | 24 | 18 | 95% |

Store as `const CONTRACT = [...]` plus a per-robot overlay in state
(`S.contract[i] = { start, term, payback, uptime }`, undefined means "as
imported"), the same overlay pattern as `S.robotInvoice`.

Table columns: Robot (tile, name over model) · Contract start (date input)
· Term (number, `mo`) · Ends (derived, read-only: start + term, e.g. `Jun
30, 2028`) · Promised payback (number, `mo`) · Promised uptime (number, `%`)
· Source pill (`yours` once any field on the row is edited, `from your
contract` otherwise). Bare-number inputs with a dashed underline, the
Numbers style, not boxed fields.

Header: `Four inputs per robot` with the subline `What the contract says.
Payback, Contract and Decisions are worked out from these.`

"As of" date for every calculation below is the end of the open period,
`PERIODS[0].end` (Sep 3, 2026). Months elapsed = whole months from contract
start to that date (Jul 1, 2025 → 14; Oct 1, 2025 → 11; Nov 1, 2025 → 10;
Jan 1, 2026 → 8; Mar 1, 2026 → 6).

---

## 2. Payback

Rail item after Costs, icon `coins`, title `Payback`, section label
`Statement`. Description line under the title: `What the salesperson
quoted, against what each robot has actually earned back.`

### The calculation (`computePayback()`)

Per robot, from the same row `computeStatement(true, scope)` already
produces:

- **Price** = `EQUIP_COST[work] / 100` (the purchase-equivalent cost the
  Tax shield card already uses: $32,000 for order picking, $28,000 for
  floor cleaning).
- **Monthly value series**, one entry per elapsed month, oldest first. For
  the month `k` months ago (k = 0 is the latest complete month) and `m`
  months since the contract started:
  `value = currentMonthlyValue × trend(k) × ramp(m)` where
  `currentMonthlyValue` is the row's `value` (units × rate, live),
  `trend(k) = k < 6 ? siteCov[k] / siteCov[0] : (siteCov[5] / siteCov[0]) × 0.985^(k−5)`
  using that robot's site column of `PERIODS[].siteCov` (so the six known
  periods reproduce Coverage over time exactly), and
  `ramp(m) = [0.55, 0.78, 0.92][m]` for the first three months, 1 after.
- **Earned back** = sum of the series. **Earned %** = earned ÷ price.
- **Paid in** (context only) = monthly invoice × months elapsed.
- **Crossed** = the first month (1-based) where the running total reaches
  the price, if any.
- **Break-even at your pace** = if crossed, that month; otherwise
  `elapsed + ceil((price − earned) ÷ mean of the last 3 months)`.
- **Verdict**: crossed → `paid back`, with `month X, promised P`.
  Not crossed and break-even ≤ promised → `on track`. Otherwise `behind`,
  by `break-even − promised` months. If elapsed ≥ promised and not
  crossed, the pill reads `promise missed`.

### What it should come out to (tie-out, do not type these in)

| Robot | Value / mo | Elapsed | Earned back | Verdict |
|---|---|---|---|---|
| Picker 1 (Zone A) | $4,144 | 14 | $44,244 · 138% | paid back in month 11, promised 14 |
| Picker 2 (Zone B) | $988 | 14 | $10,549 · 33% | promise missed · break-even month 38, promised 14 |
| Freight runner | $4,276 | 11 | $36,432 · 114% | paid back in month 10, promised 12 |
| Picker 3 (Zone C) | $3,816 | 14 | $40,742 · 127% | paid back in month 12, promised 14 |
| Scrubber 50 | $3,000 | 8 | $18,791 · 67% | on track · month 12, promised 18 |
| Scrubber 75 (nights) | $1,530 | 8 | $9,583 · 34% | behind by 3 · month 21, promised 18 |
| Picker 1 (Marina) | $2,848 | 6 | $13,932 · 44% | on track · month 13, promised 14 |
| Picker 2 (Marina) | $2,300 | 6 | $11,251 · 35% | behind by 2 · month 16, promised 14 |
| Scrubber (Marina) | $1,875 | 6 | $9,172 · 33% | on track · month 17, promised 18 |
| Picker 1 (Airport) | $4,056 | 10 | $32,827 · 103% | paid back in month 10, promised 14 |
| Picker 2 (Airport) | $3,892 | 10 | $31,499 · 98% | on track · month 11, promised 14 |
| Picker 3 (Airport) | $3,508 | 10 | $28,391 · 89% | on track · month 12, promised 14 |
| Scrubber (Airport) | $2,250 | 10 | $18,210 · 65% | on track · month 15, promised 18 |

Fleet, all 3 sites: **4 paid back, 6 on track, 3 behind**; $305,623 earned
back of $400,000 of price, 76%.

### The page

**Metric strip** (four tiles, one panel), `S.paybackTab`:

1. `Paid back` · `4 of 13` · `ahead of the quote`
2. `On track` · `6` · `will beat the quote`
3. `Behind the quote` · `3` · `one past its promise`
4. `Earned back` · `$305,623` · `of $400,000 · 76%`

Tiles 1 to 3 open the same panel, the robot table, pre-sorted so the
selected group is on top. Tile 4 opens a fleet panel: the cumulative
earned-back curve for the whole scope (a `sparklineChart` with `area:true`,
one point per month from the earliest contract start, the price total as
the dashed reference line) and one sentence: `Across all 13 robots you have
earned back $305,623 of the $400,000 they cost. At the pace of the last
three months the fleet as a whole crosses its price in month 17 from the
first contract.` Compute that month; do not hardcode it.

**Robot table** columns: Robot (tile, name over model) · Started (`Jul 1,
2025`) · Quoted (`14 mo`) · Earned back (a bar, price = full track, fill =
earned, capped at 100%, with `138%` right of it) · At your pace (`month
11`) · Verdict pill · chevron. Sort: behind first, then on track, then paid
back, then by earned % within each.

Verdict pills use the glyphs the app already uses: `triangle-alert` for
behind / promise missed, `check` for paid back, `sliders-horizontal` for on
track.

**Row detail** (expands in place, one open at a time), two columns:

Left: the curve. `sparklineChart` of the running total, one point per
month, the price as the dashed reference line, the promised month marked
on the axis. Under it the legend line, 11.5px `--fg3`: `running total of
work at your rate · dashed line is what the robot cost · 0.55, 0.78, 0.92
ramp assumed on the first three months`.

Right: the sentence, then three stats (`statRow`):
- Sentence, 14px, for Picker 2 (Zone B): `You were told this robot would
  pay for itself in 14 months. It is 14 months in and has earned back 33%.
  At the pace of the last three months it breaks even in month 38, two
  months after the lease ends.` The "after the lease ends" clause appears
  only when break-even > term. For a paid-back robot: `You were told 14
  months. It crossed in month 11.`
- `EARNED BACK` · `$10,549` · `of $32,000`
- `PAID IN SO FAR` · `$21,000` · `14 invoices at $1,500`
- `LEASE ENDS` · `Jun 30, 2028` · `22 months left`

Under the stats, a bare-number input `Promised payback` with the current
value and `mo`, live: changing it here is the same overlay as the Contract
tab and re-verdicts the row, the tiles and the Dashboard tile as you type.
Note beside it: `yours to correct · what the quote said`.

**Empty state** (manual estimate mode, no per-robot rows): one card, `A
typed estimate has no contract behind it. Import your export and set the
start date and quoted payback on Numbers.` with a button to Numbers.

---

## 3. Contract

Rail item after Payback, icon `file-text`, title `Contract`, section
`Statement`. Description: `What the contract promises, what the robots
delivered, and what the gap is worth back to you.`

### Data: downtime incidents for the open period

`const DOWNTIME = [...]`, index-for-index with `CONFIRM`, each entry an
array of `{ date, start, minutes, cause }`. Cause is one of `stuck`,
`error E-217`, `offline`, `low battery`; stuck carries a place (`stuck ·
aisle 14`). Scheduled minutes per robot = its Numbers hours/day × 31 days
× 60 (12 h pickers: 22,320; 8 h scrubbers: 14,880).

The three under-promise robots, in full:

**Picker 2 (Zone B)**, 8 incidents, 2,300 min:
Aug 5 2:05p 310 stuck · aisle 14 / Aug 8 3:20p 265 stuck · aisle 14 / Aug 13
1:50p 340 stuck · aisle 12 / Aug 15 2:30p 280 stuck · aisle 14 / Aug 19
9:15a 190 error E-217 / Aug 22 2:40p 330 stuck · aisle 14 / Aug 28 3:05p
355 stuck · aisle 14 / Sep 1 2:15p 230 stuck · aisle 12.

**Scrubber 75 (nights)**, 6 incidents, 1,620 min:
Aug 6 12:40a 310 stuck · dock corridor / Aug 10 2:15a 240 error E-217 / Aug
16 11:50p 290 stuck · dock corridor / Aug 21 1:05a 260 low battery / Aug 26
3:30a 300 stuck · dock corridor / Sep 2 12:20a 220 error E-217.

**Picker 3 (Airport)**, 5 incidents, 1,380 min:
Aug 5 2:00p 320 stuck · aisle 7 / Aug 12 1:30p 290 stuck · aisle 7 / Aug 19
3:15p 260 error E-217 / Aug 26 2:45p 280 stuck · aisle 7 / Sep 1 1:55p 230
stuck · aisle 9.

Everyone else, count and total (fill in plausible dates and causes that
sum to these): Picker 1 (Zone A) 2 · 95 / Freight runner 3 · 210 / Picker 3
(Zone C) 1 · 40 / Scrubber 50 2 · 130 / Picker 1 (Marina) 2 · 160 / Picker
2 (Marina) 4 · 620 / Scrubber (Marina) 1 · 45 / Picker 1 (Airport) 2 · 120
/ Picker 2 (Airport) 3 · 260 / Scrubber (Airport) 1 · 30.

### The calculation (`computeContract()`)

- **Delivered uptime** = 1 − downtime minutes ÷ scheduled minutes.
- **Gap** = promised − delivered, floored at zero.
- **Credit** = gap points × 1% × that robot's monthly invoice. State the
  clause once on the page: `Worked out as one percent of the month's
  invoice for every point under the promise, the usual shape of a service
  credit. If your clause reads differently, change the promised figure on
  Numbers and read the incident list as the evidence.`
- Fleet delivered uptime is scheduled-minute weighted.

Tie-out: Picker 2 (Zone B) 89.70%, gap 5.30, credit $79.50. Scrubber 75
(nights) 89.11%, gap 5.89, credit $47.12. Picker 3 (Airport) 93.82%, gap
1.18, credit $17.70. Everyone else at or above promise (Freight runner
99.06% against 97). Fleet: 40 incidents, 7,010 minutes, 97.31% delivered.
**Credit owed this period $144.32**, `$1,732 a year at this rate`.

### The page

**Metric strip** (four tiles), `S.contractTab`:

1. `Promised uptime` · `95%` · `97% on the Fetch` (state the mode, name
   the exception; if all equal, just the figure)
2. `Delivered` · `97.31%` · `scheduled-hours weighted`
3. `Credit owed` · `$144.32` · `this period · $1,732 a year at this rate`
4. `Incidents` · `40` · `7,010 minutes down`

Tiles 1, 2 and 4 open the uptime table. Tile 3 opens the credit ledger.

**Uptime table**: Robot · Promised · Delivered · Gap (`5.30 pts`, blank
when none) · Credit (`$79.50`, blank when none) · Incidents (`8 · 38.3 h`)
· chevron. Rows under promise carry the `triangle-alert` caution beside the
name, the Fleet convention. Sort: largest gap first, then by incidents.

**Row detail**: the incident list for that robot, a plain table: Date ·
Started · Down for (`5 h 10 m`) · What the robot reported. Under it, one
line: `Eight incidents, 38.3 hours. Six of them are the same spot, aisle
14, between 2 and 4 in the afternoon.` Compute the repeated place and the
window; only say it when one place accounts for at least half. A robot
with no incidents does not expand; its chevron is absent and the Incidents
cell reads `none`.

**Credit ledger panel** (tile 3): a short table, only the robots with a
credit: Robot · Gap · Invoice · Credit. Total row. Then a primary button
`Draft the credit request` that opens a plain-text panel below it with a
ready-to-send note: `To: [vendor] · Re: service credit, Aug 4 – Sep 3 2026
· Your agreement promises 95% uptime on Picker 2 (Zone B). Delivered uptime
for the period was 89.70% across 8 logged incidents totalling 38.3 hours
(list attached). Under the credit clause that is $79.50 against the
$1,500.00 invoice for the period.` One paragraph per robot with a credit.
Vendor is `brandOf(model)`. A `Copy` button beside it. This is the moment
the page hands the owner money; make it feel like one.

**Second panel under the strip**, always visible: `Lease terms`, a compact
table read from the Contract tab: Robot · Started · Term · Ends · Months
left, with a link `Edit on Numbers →`. Robots ending inside 9 months get
the pill `ends soon`.

Add two rows to `ALERT_RULES` on the Notifications page:
- `A promise is missed` · `A robot passes its quoted payback month without
  crossing its price` · `Sam` · `When the period closes` · `Sent Sep 4 ·
  Picker 2 (Zone B)`
- `A credit is owed` · `Delivered uptime under the promise for a full
  period` · `Sam, Priya` · `When the period closes` · `Sent Sep 4 · 3
  robots, $144.32`

Update the count word in the Notifications header so it still counts off
the rows.

---

## 4. Decisions

Rail item after Contract, icon `route`, title `Decisions`, section
`Statement`. Description: `Every robot in one of three piles, with the
reason. This is the advice a robot company is not allowed to give you.`

### The rules (`computeDecisions()`), applied in order, first match wins

1. **Move** if coverage < 1.00x AND the same kind of work at another site
   in scope averages ≥ 2.00x.
2. **Return when the lease ends** if the lease ends inside 9 months AND
   (coverage < 1.60x OR the vs-July delta is negative).
3. **Keep** otherwise.

Tie-out at All 3 sites: Move 1 (Picker 2 (Zone B)) · Return 1 (Picker 2
(Marina)) · Keep 11. Scoped to Marina alone, Picker 2 (Zone B) is not in
scope; scoped to Pier 4 alone, rule 1 still fires because Airport pickers
are compared across the whole fleet, not the scope (say so in the card).

### The page

A three-column board using `board()`, columns in this order with the
monthly invoice of the pile under each count:

- `Keep` · `11` · `$15,700 / mo`
- `Return when the lease ends` · `1` · `$1,500 / mo`
- `Move` · `1` · `$1,500 / mo`

Each card: name over model and site, the pile pill, a reason of at most
two sentences with the figures inline, and the lease end date in 11.5px
`--fg3`. Cards open that robot on Fleet on click (`toggleRobot`). Reasons,
computed not typed, in this shape:

- Keep, normal: `2.76x, up 0.10 vs July. Paid back in month 11. Lease runs
  to Jun 30, 2028.`
- Keep, with a caveat: Scrubber 75 (nights): `1.91x, up 0.61 vs July, but 4
  parts past life and 3 months behind its payback quote. Keep it; the
  parts come first.`
- Return: Picker 2 (Marina): `1.53x and slipping, down 0.05 vs July, with
  break-even 2 months past the quote. The lease ends Feb 28, 2027, the
  nearest exit in the fleet.`
- Move: Picker 2 (Zone B): `0.66x at Pier 4, promise missed. Pickers at
  Airport average 9,547 picks a month; this one did 2,470. The demand is
  there and here it is not. At Airport's average the same invoice would
  buy $2,831 more work a month; nothing here says this robot would reach
  it.`

Under the board, one line, 13px `--fg2`: `Rules: under its lease with the
same work running over 2x elsewhere is a move. A lease ending inside nine
months on a thin or slipping margin is a return. Everything else is a
keep.` That is the whole method statement; no more.

**Empty piles are kept** and read as a finding: an empty Move column with
`Nothing to move` in `--fg3`.

---

## 5. Benchmark, locked

Rail item after Decisions, icon `users`, title `Benchmark`, section
`Statement`. Description: `Your cost per unit against every fleet we watch
running the same brand on the same work. Locked until enough fleets opt
in.`

One card per kind of work in scope, in this shape, with the peer figures
**hatched placeholders, not numbers**:

`Order picking on Locus`
- Your figure, measured: `$0.19 per pick` (invoice ÷ picks across your
  Locus pickers in scope, the same arithmetic Costs uses for brand against
  brand) with a solid bar.
- `Middle of fleets we watch`: a hatched bar of the same length, value
  shown as `••••`, tag `locked`.
- `Top third`: hatched, `••••`, `locked`.
- A lock glyph (`lock` icon) in the card header.

Under the cards, a panel: `Unlocks at 10 opted-in fleets running Locus on
order picking. 3 have opted in so far.` and a toggle `Share our anonymised
figures and see everyone else's` bound to `S.benchOptIn`. Flipping it on
changes the line to `4 have opted in so far, counting you.` and the
Dashboard bell does not fire; nothing else changes. Off by default.

Small print, 11.5px `--fg3`: `Figures are pooled by brand and kind of work
only. No fleet, site or company is identifiable, including yours.`

---

## 6. Wiring

- **Rail order**: Dashboard · Fleet · Costs · Payback · Contract ·
  Decisions · Benchmark · Numbers, then Settings at the foot as now. Add the
  icons `coins`, `file-text`, `route`, `users`, `lock`, `calendar`,
  `arrow-right` to `ICONS` as lucide paths at 24×24, stroke 2.
- **COPY**: add `payback`, `contract`, `decisions`, `benchmark` with the
  titles and description lines above, so `?view=payback` deep links work
  without any other change (bootScreen keys off COPY).
- **appTopbar SECTION map**: all four under `Statement`.
- **appHeader**: the scope toggle shows on all four. The period picker does
  not (they are to-date pages, not period pages). Contract's incident list
  is the open period only; say `Aug 4 – Sep 3` in its panel header.
- **appsMenu**: add `Open Payback`, `Open Contract`, `Open Decisions` tiles
  to the Statement group.
- **Dashboard**: add a sixth tile to the metric strip, `Payback` · `4 of
  13` · `paid back`. Its panel: the three counts as `statRow`s, the fleet
  earned-back sentence from Payback tile 4, and a link `Open Payback →`.
  Reads `computePayback()`, never its own arithmetic.
- **Needs attention** on Dashboard stays as it is (coverage under 1x only).
  Do not fold promise or credit findings into it.
- **State**: `paybackTab: 'behind'`, `contractTab: 'uptime'`,
  `openPayback: -1`, `openContract: -1`, `contract: {}`,
  `benchOptIn: false`, `creditDraftOpen: false`. Add the open-row keys to
  `CLOSED_UI_STATE` so navigating away closes them, as `openRobot` does.
- **Inputs**: the Contract tab's fields and the inline promised-payback
  field live-patch through one `applyContractRow(i)` in the style of
  `applySetupRow`. Blank clears the overlay back to the imported value;
  never store 0.

---

## 7. Check before you call it done

- All 3 sites, Payback: 4 / 6 / 3, $305,623 of $400,000. Picker 2 (Zone
  B) row says month 38 and "two months after the lease ends".
- Type 40 into Picker 2 (Zone B)'s promised payback: the row flips to `on
  track`, the Behind tile drops to 2, the Dashboard Payback tile still says
  `4 of 13`.
- Contract: credit owed $144.32; Picker 2 (Zone B) detail shows 8 rows
  summing to 2,300 minutes and the aisle 14 sentence.
- Decisions at All 3 sites: 1 / 1 / 11. At Airport alone: 0 / 0 / 4 and
  the Move column reads `Nothing to move`.
- Benchmark: your Locus figure is the same number Costs' brand table shows
  for Locus.
- Search `marina` in the top bar: Payback and Contract tables narrow to 3
  rows.
- `?view=decisions` opens straight to the board.
- 390px wide: every table drops to name + verdict/credit on one line, the
  detail restates the dropped columns, no horizontal scroll.
- Not a single new colour, no em dash in any string, nothing on an existing
  page moved.

## 8. What must not change

- Every existing page, figure, and interaction.
- The rule that a figure's source is named at the figure.
- The scope control's meaning: one site or all three, shared by every page.
- Coverage over time and Payback's month series agree on the six known
  periods, by construction.
