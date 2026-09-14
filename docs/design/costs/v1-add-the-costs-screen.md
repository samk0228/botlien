# Botlien prototype: add the Costs screen

**Source of truth, verified by fingerprinting the published artifact against every copy in
the repo:**

- Branch: `origin/owner-formula-discretion`
- Commit: `07ea9aa7` ("Remove the How figures read section from Settings", 18 Aug 2026)
- Generated file: `prototype/botlien-prototype.html` (524,895 bytes)
- **Edit these, never the generated file:** `prototype/src/botlien.part.html` and
  `prototype/src/assets.json`, then `cd prototype/src && node build.cjs`

This version is NOT on `main`. Main's copy is 51KB smaller and still carries the benchmark
opt-in screen that this one dropped. Branch from `owner-formula-discretion`, not `main`.

Keep every existing screen, card, token and interaction exactly as it is. The rail
(Dashboard, Fleet, Numbers), the date range control, the site filter, Customize, the
coverage chart, the utilization chart, Needs attention, Where the work is, and the
sensitivity slider are all wired and must not change. This revision is one edit to one
existing card, plus one new screen.

---

## THE RULE THAT OVERRIDES EVERYTHING BELOW

Every other card in this product tells the operator their robots were a good decision.
This screen is the only one that does not, and that is the entire reason it earns trust.
So it must never overstate the cost, the same way the rest of the page must never
overstate the benefit.

Three hard rules:

1. **Measured and estimated are never blended into one figure.** A number the robot
   reported and a number we inferred from an assumption are different claims. They get
   different labels, on screen, next to the money.
2. **State every assumption where the number is, not in a footnote.** If a figure depends
   on "six minutes per stall," those words appear beside the figure, and the reader is
   told that halving it halves the figure.
3. **Never charge the same hour twice.** Stalled robot time is already counted as work the
   robot did not perform in the coverage figure. It appears here as context only and is
   never priced as labour.

If any instruction below conflicts with these three, these three win.

---

## 0. The one edit to an existing card

The **"A person vs your robots"** card currently reads:

```
A PERSON      $39,974.40
YOUR ROBOTS   $16,700.00
Your robots cost $23,274.40 less this period
```

`$16,700.00` is the lease invoice. It is not what the robots cost. The time your team
spends unsticking and hand-driving them is missing, and any operator who has actually run
a fleet knows it is missing. Leaving it out is what makes the card read as a brochure.

Change the robots side to two lines and restate the conclusion:

```
A PERSON      $39,974.40
              What people would have been paid for the same work

YOUR ROBOTS   $17,648.00
              $16,700.00 leased + $948.00 of your team's time keeping them running

Your robots cost $22,326.40 less this period
Keeping them running is counted here. See Costs.
```

`See Costs` links to the new screen. The arithmetic must tie exactly:
39,974.40 − 17,648.00 = 22,326.40.

This is the single most valuable change in this document. Ship it even if nothing else
below gets built.

---

## 1. New rail item

Add **Costs** to the rail, between Fleet and Numbers. Same item metrics as the existing
three: 32px tall, 8px padding, 8px radius, 14px type, 500 idle and 600 active, same
active background. No badge.

One tab, not three. The three sections below answer one question between them, and two of
them can be legitimately absent for a given operator, so as separate tabs they would risk
being dead tabs.

---

## 2. Costs screen header

Same header pattern as Dashboard: title, date range control on the right, the period
sentence under it, the site filter and Customize row. The site filter applies to all three
sections below.

Then a headline card in the existing headline style:

```
BEYOND THE LEASE INVOICE
$948.00
Labour spent keeping the robots working this period. It arrives on no invoice and appears
in no vendor dashboard. It sits on top of the lease payments already counted in your
coverage, not inside them.
```

---

## 3. Section: What it costs to keep them running

Three cards in a row, using the existing tile style. The split between the first two is
the point of the section, so their captions carry the distinction:

**Clearing stalls · $504.00**
210 stalls, counted from telemetry, at an assumed 6 minutes of someone's time each

**Driving by hand · $444.00**
18.5 hours with a person on the controls, measured directly, no assumption

**On top of the lease · $948.00**
labour your invoice never shows, over the same period as every other figure here

Beneath them, one sentence in the existing lead-sentence style:

> 210 stalls cleared by hand, about 21 hours, plus 18.5 hours with someone driving the
> robot directly.

Then the robots that account for it, as rows in the existing robot-row style, worst first,
maximum five. Name on the left, a short qualifier, money on the right, arithmetic on a
second line in the mono style. Drop any term that is zero: a robot whose whole cost is
hand-driving must not read "0.0 h clearing," and one that never stalled must not carry a
trailing "stalled 0.0 h."

```
Picker 2 (Zone B)      142 stalls                          $340.80
14.2 h clearing × $24.00/h · robot itself stalled 19.4 h

Scrubber 1 (nights)    driven by hand                      $444.00
18.5 h driven by hand × $24.00/h
```

Hours in the arithmetic line carry one decimal, always, even when the prose above rounds.
`21 hours × $24.00/h = $504.00` does not survive being checked on paper; `21.0` does.

Close the section with the honesty note, in the existing small-print style:

> The stall count is measured. The 6 minutes per stall is not: it is our assumption about
> how long a person takes to notice, walk over, free the machine and walk back. Halve it
> and this figure halves. The hours the robot spent stalled are shown for context and are
> deliberately not charged here as labour, because your coverage figure already counts
> them as work the robot did not really perform, and billing the same hours twice would
> flatter this panel.

Add one control next to the assumption: an inline editable field for minutes per stall,
defaulting to 6, that recomputes the clearing figure, the total, and the "A person vs your
robots" card live. The sensitivity slider on the Dashboard already establishes this
pattern. An assumption the reader can move is an assumption they can trust.

---

## 4. Section: When they get stuck

**This replaces an earlier floor-map version of this section. Do not build a map.**
The map was cut for two reasons, both fatal. It needed x/y coordinates, which
`src/importer.mjs` discards unconditionally (`pose: null`), so no file-based customer
could ever see it. And nobody could read it: a dark square seven across and three down is
not a place a warehouse manager knows how to walk to. They think in aisles and shifts, not
in metres from an arbitrary origin.

The same question, asked on an axis every human already knows how to read: not **where**
they get stuck, but **when**. This needs only a timestamp and a stuck or error field,
which every export on earth carries.

### The chart

A single horizontal strip, midnight to midnight, 24 columns, one per hour of the day.
Height of each column is the stall time that landed in that hour, summed across the period.

- Axis labelled at `12a`, `6a`, `12p`, `6p`, `12a`. Not 0 through 23.
- The fleet's operating window carries a faint background wash so an operator can see at a
  glance that the quiet hours are quiet because nothing was running, not because nothing
  went wrong.
- Monochrome. Ink height carries the quantity. No status colours, no red band on the peak.
- The worst contiguous two-hour window is marked with a bracket above the strip and its
  figure, for example `11.8h`.

### The reading underneath

Raw stall hours by hour of day mostly reproduce the operating schedule, which tells the
operator nothing they did not know. The finding is the **rate**: how much of the time the
robots were actually working in that hour got lost to being stuck. Both numbers appear:

> Your robots lost **31.0 hours** to stalls this period. **11.8 of them, 38%, fell between
> 2pm and 4pm**, which is only 17% of your working hours. In that window robots lost 4.4%
> of their working time to being stuck, against 1.9% across the day as a whole, so it is
> **2.3 times worse than a normal hour**. That is the shift to go and watch.

Every figure ties: 11.8 ÷ 31.0 = 38%. 2 of 12 operating hours = 17%. 4.4 ÷ 1.9 = 2.3.

If no window stands out, the sentence must say so plainly and name the flat reading:
stalls spread evenly across the working day point at the machines or the routes rather than
at a moment in the shift. Both readings are real findings and the section must deliver
either without editorialising.

### Split by kind of work, never fleet-wide

Peaks are computed **inside** one kind of work, mirroring the rule already in `tips.mjs`. A
night scrubber scored against the day shift's picking peak reads as permanently idle, and
the board would confidently tell an operator to fix a robot doing exactly what it should at
exactly the right hour. A fleet doing two kinds of work gets two strips, labelled.

### Why this one earns its place

- Everyone can read a clock. Nothing has to be oriented or decoded.
- It needs timestamps, which the file drop already parses today. It ships to 100% of
  customers on day one rather than to none of them.
- It is equally actionable. "Your stalls cluster in the two hours you can least afford
  them" sends someone to stand on the floor at 2pm, which is the same outcome the map was
  reaching for.

---

## 5. Section: Brand against brand

This is the one comparison a robot manufacturer structurally cannot ship, because a vendor
dashboard only ever sees that vendor's own machines. Nothing anywhere else in this product
compares makes. Give it a full card.

Lead sentence:

> Your Locus machines do the same job for 44 cents per pick. Your Fetch machines cost 61
> cents, 39% more.

Then one row per brand, cheapest first, in the robot-row style:

```
Locus     6 robots                                          $0.44
41,200 picks started · 388 active hours · $18,128.00 of invoice · 2.61x coverage

Fetch     3 robots                                          $0.61
14,900 picks started · 152 active hours · $9,089.00 of invoice · 1.88x coverage
```

Cost per pick is invoice divided by work performed, the same definition used everywhere
else on the page, so a brand row can be checked against the robot rows it came from. Every
figure must tie to the per-robot data already in the prototype.

Two guards, both visible:

- **Compare only inside one kind of work.** Cost per pick and cost per cleaning hour are
  different units and ranking them together produces a number with no dimension. Order
  picking gets a table. Floor cleaning gets its own, or none if only one make cleans.
- **Say when a row rests on one machine.** One machine can be a good machine rather than
  evidence about a brand. If either side has a single robot, the note says so by name.

Close with:

> At the volume your Fetch machines actually ran, that gap is worth about $2,533 over this
> period. This is an observation, not an experiment. Two brands in one fleet are rarely
> given the same routes, shifts or floors, so the gap only becomes a verdict on the
> machines once they have run the same work. Swapping them for a fortnight settles it, and
> that is a thing you can do that nobody else can measure for you.

---

## 6. Empty states

Every section here can be absent for a real operator, and absent must look absent rather
than look like zero.

- Fewer than 3 stalls in the period: the whole first section does not render. Two stalls in
  a month is a Tuesday, not a staffing cost.
- No stuck or error field in the feed: no timing strip. Some exports carry only uptime.
- One make in the fleet, or only one priced: no brand table.

If all three are absent, the screen shows one short empty state naming exactly which field
would unlock each section: a stuck or error column, a timestamp, and a second make priced. Never an empty chart frame waiting to be filled, never a zero-length bar.

---

## 7. What not to do

- Do not add status colours anywhere on this screen.
- Do not put a dollar figure on stalled robot time. It is already in coverage.
- Do not present the six-minute assumption as measured, and do not hide it in a tooltip.
- Do not compare brands across kinds of work.
- Do not move, restyle or "improve" any existing card other than the single edit in §0.
- Do not add a fourth and fifth rail item for the timing strip and the brand table.
- **Do not build a floor map**, and do not reintroduce one later without first fixing
  `src/importer.mjs` to read coordinates instead of hardcoding `pose: null`. A section that
  cannot render for a file-based customer does not belong in a demo shown to file-based
  customers.

---

## Numbers, for reference

All figures above are internally consistent and must stay that way if any are changed:

```
clearing:     210 stalls × 6 min = 21.0 h × $24.00/h = $504.00
hand driving: 18.5 h × $24.00/h                      = $444.00
total                                                 = $948.00

person vs robots: $16,700.00 leased + $948.00 = $17,648.00
                  $39,974.40 − $17,648.00     = $22,326.40 ahead

brand gap:    ($0.61 - $0.44) x 14,900 picks  ≈ $2,533

stall timing: 11.8 h ÷ 31.0 h                  = 38% of stall time
              2 of 12 operating hours          = 17% of the working day
              4.4% ÷ 1.9%                      = 2.3x a normal hour
```
