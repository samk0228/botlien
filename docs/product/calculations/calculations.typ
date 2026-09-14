// Botlien calculations reference. Same design system as the deployment runbook.
#let fg1 = rgb("#16204A")
#let fg2 = rgb("#5B6486")
#let fg3 = rgb("#8B93B0")
#let wash = rgb("#F4F5FC")
#let hair = rgb("#DDE0EE")
#let hair2 = rgb("#C3C8DE")
#let ink = rgb("#0A0A0A")
#let warnbg = rgb("#FFF8EA")
#let warnline = rgb("#E8D3A8")
#let warnfg = rgb("#8A5A00")

#let sans = ("Helvetica Neue", "Helvetica", "Arial")
#let mono = ("Menlo", "DejaVu Sans Mono")

#set page(
  paper: "us-letter",
  margin: (x: 16mm, top: 16mm, bottom: 18mm),
  footer: context {
    set text(7pt, fill: fg3, font: sans)
    grid(
      columns: (1fr, auto),
      align(left)[Botlien calculations reference · fleet snapshot Aug 12, 2026, 8:40 PM · commit cbd3608],
      align(right)[#counter(page).display("1") / #counter(page).final().first()],
    )
  },
)

#set text(font: sans, size: 9.5pt, fill: fg1)
#set par(justify: false, leading: 0.62em, spacing: 0.85em)

// ---------- helpers ----------
#let ic(s) = box(
  fill: wash, stroke: 0.5pt + hair, radius: 1.5pt,
  inset: (x: 2.5pt, y: 1pt), outset: (y: 1.5pt),
  text(8pt, font: mono, fill: fg1, s),
)

#let code(s) = block(
  width: 100%, fill: wash,
  stroke: (left: 2pt + fg1, rest: 0.5pt + hair),
  radius: 2pt, inset: (x: 9pt, y: 7pt), above: 6pt, below: 6pt,
  breakable: false,
  text(8.2pt, font: mono, fill: fg1, raw(s)),
)

#let sect(num, title) = {
  block(above: 18pt, below: 7pt, breakable: false)[
    #line(length: 100%, stroke: 0.5pt + hair)
    #v(7pt)
    #text(12.5pt, weight: 700, fill: fg3, num)
    #h(6pt)
    #text(12.5pt, weight: 700, fill: fg1, title)
  ]
}

#let note(body) = block(above: 4pt, below: 0pt, text(8.6pt, fill: fg2, body))

#let callout(body) = block(
  width: 100%, fill: warnbg, stroke: 0.6pt + warnline, radius: 2pt,
  inset: (x: 10pt, y: 8pt), above: 10pt, below: 10pt,
  text(8.6pt, body),
)

#let boxed(label, body) = block(
  width: 100%, stroke: 0.9pt + ink, radius: 2pt,
  inset: (x: 10pt, y: 8pt), above: 10pt, below: 10pt,
)[
  #text(7.2pt, weight: 700, tracking: 0.7pt, upper(label))
  #v(3pt)
  #text(8.6pt, body)
]

#let hdr(s) = text(7pt, weight: 700, tracking: 0.7pt, fill: fg3, upper(s))

#let tbl(cols, ..cells) = block(above: 8pt, below: 8pt)[
  #table(
    columns: cols,
    stroke: (x, y) => (
      bottom: if y == 0 { 1pt + hair2 } else { 0.5pt + hair },
    ),
    inset: (x: 0pt, y: 5.5pt),
    column-gutter: 9pt,
    align: top,
    ..cells
  )
]

#let fig(path, caption) = block(above: 10pt, below: 10pt, breakable: false)[
  #block(stroke: 0.7pt + hair2, radius: 2pt, inset: 4pt, image(path, width: 100%))
  #v(2pt)
  #text(7.6pt, font: mono, fill: fg3, caption)
]

// ---------- masthead ----------
#block(below: 0pt)[
  #text(8.5pt, weight: 700, tracking: 1.4pt, fill: fg3, "BOTLIEN")
  #v(9pt)
  #text(25pt, weight: 700, fill: fg1, "Calculations Reference")
  #v(4pt)
  #text(11pt, fill: fg2)[How the dashboard computes every number, traced through a live fleet]
  #v(10pt)
  #text(8pt, fill: fg3)[
    #text(weight: 700, fill: fg1, "Date") August 12, 2026 #h(16pt)
    #text(weight: 700, fill: fg1, "Fleet") 6 robots, 21 days of telemetry #h(16pt)
    #text(weight: 700, fill: fg1, "Source") samk0228/botlien
  ]
  #v(9pt)
  #line(length: 100%, stroke: 1.6pt + ink)
]

#v(10pt)
#note[
  Every screenshot in this document is the real application rendering a simulated
  six-robot fleet, and every worked example below uses the numbers visible in
  those screenshots. All of them were re-derived by hand for this document: the
  six per-robot work figures sum to the headline to the cent, and the variance
  effects sum to the coverage move with zero residual. The dashboard prints its
  own arithmetic under every figure for exactly this reason: nothing on the page
  is a score, everything is a division that can be checked.
]

#boxed("The pipeline")[
  #text(8.2pt, font: mono)[
    pings (thousands per robot per day) \
    #h(12pt)→ hourly buckets: online_ms, active_ms, missions #h(8pt) [rollup.mjs] \
    #h(24pt)→ × economics (rate = wage ÷ throughput) #h(30pt) [rates.mjs] \
    #h(36pt)→ per robot: work · invoice · coverage · util #h(9pt) [finance.mjs] \
    #h(48pt)→ fleet: Σ work ÷ Σ invoice #h(66pt) (never an average of ratios) \
    #h(48pt)→ tips: idle hours × the robot's own \$/active-hour \
    #h(48pt)→ variance: ΔW = availability + intensity + rate, residual = 0
  ]
]

// ---------- 1 ----------
#sect("1", "Snapshots: what a robot actually says")

A robot never reports "I did \$50 of work." It reports tiny status pings, roughly
once a minute:

#code("at: 6:04pm · online · mission_state: active · mission_id: m-4412 · battery: 71% · pose (x, y)")

Everything else in this document is arithmetic stacked on thousands of these.
Two timestamps are kept per ping, #ic("at") (when it happened) and
#ic("received_at") (when it was ingested), which is what lets a three-week-old
CSV export replay through the same tables as live data.

// ---------- 2 ----------
#sect("2", "Rollups: compressing pings into hourly buckets")

Tens of thousands of pings per robot per month are too many to do finance on,
so pings fold into one row per robot per hour carrying three quantities:

#tbl(
  (auto, 1fr),
  hdr("Field"), hdr("Meaning"),
  ic("online_ms"), text(8.8pt)[Time the robot was reachable.],
  ic("active_ms"), text(8.8pt)[Time it was actually running a mission.],
  ic("mission_count"), text(8.8pt)[Missions #text(weight: 700, "started") in that hour.],
)

Two rules here matter more than they look.

#text(9.5pt, weight: 600, "The gap rule.")
Time between two pings counts as online only when the gap is under five
minutes. A robot that goes dark for three hours earns nothing for those hours,
rather than having its outage smeared across the record as uptime.

#text(9.5pt, weight: 600, "Missions are counted by distinct id, not by state flips.")
Counting every idle-to-active transition would make polling cadence look like
workload: ask the robot twice as often and a thirty-second pause between two
legs of the same delivery becomes a second "mission." Counting distinct
#ic("mission_id") values means the number is what the robot reported, not an
artifact of how often it was asked.

// ---------- 3 ----------
#sect("3", "Economics: the five numbers the owner supplies")

Telemetry cannot say what work is worth. That takes five inputs per robot, and
until the owner types them, benchmarks fill in, always labelled
#ic("benchmark default") on screen. The central idea:

#boxed("The rate is derived, never asserted")[
  #text(9.5pt, font: mono, "rate per task  =  loaded human wage per hour  ÷  tasks a human completes per hour")
  #v(4pt)
  For tray delivery: a runner costs about \$22.00/hr loaded and hand-carries
  about 30 trays an hour, so #text(font: mono, "\$22.00 ÷ 30 = \$0.73 per run").
  That is checkable on a napkin, which is the point. An unexplained "\$1.25
  benchmark" would not permit the check.
]

Hour-based work skips the division: one robot-hour of scrubbing is valued at
one contracted human-hour, \$25.00, with no productivity multiplier. There are
two counting bases because the wrong one is off by an order of magnitude:

#tbl(
  (auto, 1fr, 1fr),
  hdr("Basis"), hdr("Counts"), hdr("Suits"),
  ic("mission"), text(8.8pt)[Whole runs started, from #ic("mission_count")], text(8.8pt)[Trays, picks, room deliveries: discrete trips],
  ic("active_hour"), text(8.8pt)[#ic("active_ms") ÷ 1 hour, fractional], text(8.8pt)[Cleaning, laundry: one mission lasting hours would otherwise count as one task],
)

// ---------- 4 ----------
#sect("4", "Robot financials: the four core numbers")

For each robot over the window, four formulas produce the whole reading. The
dashboard prints the arithmetic under every robot; this is Servi 1's line,
verbatim, from the screenshot on the next page:

#code("1670 runs started x $0.73 = $1219.10 of work serviced · rate $0.73 per run
= $22.00/hr ÷ 30 runs per hour · invoice $700.24 (21d of $999.00/mo) · coverage 1.74x")

#text(9.5pt, weight: 600, "1. Work serviced = tasks × rate.")
#h(4pt) 1,670 runs × \$0.73 = \$1,219.10.

#text(9.5pt, weight: 600, "2. Prorated invoice.")
The lease is \$999.00 per month, but only 21.02 days were observed, so the
invoice is scaled to the same period against a stated 30-day month:
#text(font: mono, "\$999.00 × (21.02 ÷ 30) = \$700.24").
Without this clamp a three-day export would be judged against a full month's
invoice and every robot would look like a disaster for no real reason.

#text(9.5pt, weight: 600, "3. Coverage = work ÷ invoice.")
#h(4pt) \$1,219.10 ÷ \$700.24 = 1.74x. Above 1.00x the robot performed more
value than it cost; below, it did not. This is the headline number.

#text(9.5pt, weight: 600, "4. Utilization = active time ÷ declared capacity.")
Capacity is the hours the owner says the robot runs (12 h/day here), never
wall-clock, so a 12-hour restaurant is not scored against 3 a.m. Duty above
capacity renders as more than 100% instead of being capped: it means the
declared hours are wrong, which the owner should see, not a number to tidy.

And one derived bonus. Because rate = wage ÷ throughput, dividing work by the
wage cancels back to hours of that one task:

#code("labor-equivalent hours = $1,219.10 ÷ $22.00/hr = 55.4 hours of tray-carrying by hand")

The UI states plainly this is not headcount and not labor saved. Claiming
displaced labor would require knowing what the business would have done without
the robot, which telemetry cannot show, and which is precisely the leap vendor
ROI calculators make.

#fig("figs/fig-robots.jpg", "Per-robot rows with their audit lines. Every figure on the page shows its own arithmetic.")

#callout[
  #text(weight: 700, fill: warnfg, "The null discipline.")
  No invoice means coverage renders as "–", never infinity. Zero tasks means
  cost per task is "n/a", never \$0.00. A robot with no rate for its work is
  left out of totals rather than counted as zero. Unknown renders as unknown,
  because a zeroed dashboard looks exactly like real data.
]

// ---------- 5 ----------
#sect("5", "Fleet totals: sum, then divide")

The fleet number is not the average of the robot coverages. Numerators and
denominators are summed separately, then divided once:

#tbl(
  (1fr, auto, auto, auto),
  hdr("Robot"), hdr("Work serviced"), hdr("Invoice (21d)"), hdr("Coverage"),
  text(8.8pt)[Servi 1 (front) · 1,670 runs], text(8.8pt, font: mono)[\$1,219.10], text(8.8pt, font: mono)[\$700.24], text(8.8pt, font: mono)[1.74x],
  text(8.8pt)[Servi 2 (patio) · 538 runs], text(8.8pt, font: mono)[\$392.74], text(8.8pt, font: mono)[\$700.24], text(8.8pt, font: mono)[0.56x],
  text(8.8pt)[P3 runner · 1,796 runs], text(8.8pt, font: mono)[\$1,311.08], text(8.8pt, font: mono)[\$700.24], text(8.8pt, font: mono)[1.87x],
  text(8.8pt)[Scrubber 50 · 59.0 active hrs], text(8.8pt, font: mono)[\$1,474.59], text(8.8pt, font: mono)[\$560.75], text(8.8pt, font: mono)[2.63x],
  text(8.8pt)[Servi 3 (banquet) · 1,890 runs], text(8.8pt, font: mono)[\$1,379.70], text(8.8pt, font: mono)[\$700.24], text(8.8pt, font: mono)[1.97x],
  text(8.8pt)[Scrubber 75 (nights) · 40.5 hrs], text(8.8pt, font: mono)[\$1,012.07], text(8.8pt, font: mono)[\$560.75], text(8.8pt, font: mono)[1.80x],
  text(8.8pt, weight: 700)[Fleet], text(8.8pt, font: mono, weight: 700)[\$6,789.28], text(8.8pt, font: mono, weight: 700)[\$3,922.46], text(8.8pt, font: mono, weight: 700)[1.73x],
)

#code("fleet coverage = $6,789.28 ÷ $3,922.46 = 1.73x")

Why not average the six ratios? Because an almost-idle robot with a tiny
invoice would swing the fleet number as hard as the workhorse. Averaging ratios
is how dashboards lie; summing dollars is how invoices work.

#fig("figs/fig-headline.jpg", "The headline and tiles these sums produce. 295 hrs = $4,302.62/$22 + $2,486.66/$25, checkable by hand.")

Cost per task is deliberately never fleet-wide in a mixed fleet: dividing one
invoice by "tray runs plus cleaning hours" produces a number with no unit. It
is shown per kind of work instead:

#fig("figs/fig-bytype.jpg", "Per kind of work: $2,800.96 of tray invoices ÷ 5,894 runs = $0.48 per run; $1,121.50 ÷ 99.5 hours = $11.28 per active hour.")

// ---------- 6 ----------
#sect("6", "Tips: pricing the fixes")

Coverage is a report card; the tips are the part an owner can act on. One rule
keeps them from becoming marketing:

#boxed("The tips rule")[
  A tip may only claim work this robot has #text(weight: 700, "already
  demonstrated"), priced at this robot's #text(weight: 700, "own observed
  earning rate") from this same window. Never a vendor throughput spec, never a
  fitted model, never "robots like yours." The pricing unit is
  #text(font: mono, "cents per active hour = work serviced ÷ active hours").
]

Worked example from the screenshot, the Scrubber 50 charging tip:

#code("8.6 peak hours charging x 75% observed peak duty = 6.5 active hours
x $25.00 per active hour it already earned = $162.42")

Reading it step by step: peak hours come from the fleet's own activity profile
(every hour at 60% or more of the busiest hour, computed within the same kind
of work, so a night scrubber is never judged against the dinner rush). The
robot spent 8.6 of those peak hours on the charger. In peak hours where it was
available it ran 75% duty, so only 75% of the recovered time is credited. The
result is labelled an upper bound on screen.

#fig("figs/fig-tips.jpg", "What to fix first, ranked by money, each with its arithmetic printed.")

The stuck-robot tip is priced differently on purpose. Scrubber 50 stalled 15
hours, 79% of it within one two-meter grid cell, worth \$302.87, but marked
#text(weight: 700, "counted, not earned"): that time is already inside the
coverage number as active time, so clearing it makes the number honest rather
than bigger. That is why the totals line reads:

#code("recoverable = $872.35 + $162.42 + $159.86 = $1,194.63   ($302.87 excluded as at-risk)")

Evidence floors (48 observed hours, 2 active hours, 20 stall samples) keep the
engine silent rather than narrating noise.

// ---------- 7 ----------
#sect("7", "Variance: why the number moved")

A dashboard that says 1.73x when it said 1.81x has raised a question and
refused to answer it. The variance panel answers with arithmetic. Work is
modelled as a chain of three factors:

#code("W = R × H × I     rate × hours online × intensity (tasks per online hour)")

Between a prior period (0) and the current one (1), the change splits into
three effects that sum exactly, no residual:

#code("availability = R0 × I0 × (H1 − H0)    it was up for more or less time
intensity    = R0 × H1 × (I1 − I0)    it did more or less per hour it was up
rate         = (R1 − R0) × H1 × I1    the work is worth more or less")

The panel compares the two halves of the observed window rather than reaching
back for a prior month, so it works on whatever history exists. From the
screenshot: coverage fell 1.81x to 1.66x, hours online cost 0.11x and work per
hour online cost 0.04x, and the renderer verifies the parts sum to the whole
before drawing anything. The named contributors are ranked by absolute dollars:
Servi 1 lost \$213.16 of work, mostly through hours online.

#fig("figs/fig-variance.jpg", "The decomposition as rendered. The code refuses to draw this panel if the effects stop summing to the total.")

#callout[
  #text(weight: 700, fill: warnfg, "Why a lender cares about the same split.")
  Decay through availability is an asset-condition story: the collateral is
  degrading (LGD). Decay through intensity while fully online is a demand
  story: the borrower's business is slowing (PD). The owner dashboard and the
  creditor thesis are the same decomposition wearing different labels.
]

// ---------- 8 ----------
#sect("8", "The honesty rules that run through everything")

#tbl(
  (auto, 1fr),
  hdr("Rule"), hdr("Why"),
  text(8.8pt, weight: 600)[Starts, not completions], text(8.8pt)[Telemetry reports a mission beginning and cannot prove it finished, so every count reads "runs started," never "deliveries completed."],
  text(8.8pt, weight: 600)[Window clamping], text(8.8pt)[Figures cover the telemetry that exists, anchored to its end. A 3-day export is judged against 3 days of invoice, and the caption states the exact period.],
  text(8.8pt, weight: 600)[Stated 30-day month], text(8.8pt)[Proration uses a named convention rather than drifting with calendar length, so the same data always produces the same figure.],
  text(8.8pt, weight: 600)[Nulls, never zeros], text(8.8pt)[Missing inputs render as "–" or "n/a." Zero is a claim; unknown is not.],
  text(8.8pt, weight: 600)[Service value, not revenue], text(8.8pt)[Work is priced at what it costs to buy elsewhere, never at what the order was worth, and never as "labor saved."],
  text(8.8pt, weight: 600)[Own rates only], text(8.8pt)[Tips price recovered hours at the robot's own demonstrated rate, and suppress the dollar line when the robot has not earned enough for a rate to exist.],
)

// ---------- appendix ----------
#sect("A", "Appendix: the other two screens")

#fig("figs/fig-fleet.jpg", "Fleet: each robot against its own lease. Bars are drawn against the strongest robot present, not against 1.00x, so the list keeps its shape when every robot clears its lease.")

#fig("figs/fig-numbers.jpg", "Numbers: the five inputs per robot behind every figure in this document. Until saved, benchmarks fill in and every screen says so.")
