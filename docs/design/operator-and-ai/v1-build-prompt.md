# Botlien Demo: the operator layer and the AI layer

Extend the Botlien Demo, the clickable prototype at
https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9. One self-contained HTML
app: vanilla JS, one `S` state object, `render()` rebuilds the page,
`ACTIONS` keyed by `data-act`. Build inside it. Everything that exists stays
as it is; these are additions. This prompt assumes the sibling prompt
`promise-to-verdict/v1-build-prompt.md` (Payback, Contract, Decisions,
Benchmark, the Contract tab on Numbers, `DOWNTIME`, `CONTRACT`) has been
built or is being built alongside; where this prompt reads from those, it
says so.

Two layers. The **operator layer** is what a fleet operator needs from the
infrastructure to run robots day to day: getting data in, a log of what
went wrong, a scorecard on each vendor, reports out, a plan. The **AI
layer** is an assistant that is synced to the same numbers every page reads
and can quantify, explain and operate the dashboard on the operator's
behalf.

---

## 0. Rules. Same as the rest of the app, plus four from the design audit.

- **One calculation, many views.** Every figure reads from one function
  (`computeStatement`, `computeKeeping`, `computeStallTiming`,
  `computeBrands`, `computePayback`, `computeContract`, `computeDecisions`
  and the new ones below). Nothing recomputes on its own. The AI reads the
  same functions; it never does arithmetic of its own.
- **Inputs are live** and live-patch in place; no re-render mid-keystroke.
- **Measured vs assumed is stated at the figure.** Solid is measured,
  hatched (`--hatch`) is estimated, `yours` / `benchmark` pills name who
  set a number.
- **Absent looks absent, never like zero.**
- **No status colours.** Tokens: `--fg1 #16204A`, `--fg2 #5E6685`,
  `--fg3 #6F7793`, `--page-bg #F4F5F9`, `--card #FFFFFF`, `--hair`,
  `--hair2`, `--ghost`.
- **Use the existing components**: `metricTabs()` + `metricPanel()`, the
  Fleet table shape, `pill()`, `cardTitle()`, `sparklineChart()`,
  `subNav()`, `board()`, `statRow()`.
- **Respect scope and search** on every table.
- **Prose stays short.** One lead sentence, figures, a one-line source note.
  No em dashes anywhere.
- **Never claim what a robot could do.** Report what it did. Headroom is
  unused scheduled hours, not a forecast.
- From the 2026-09-16 audit: **a metric strip holds at most four tiles and
  the tiles shrink to fit one row** (`flex:1 1 0; min-width:120px`, full
  width under 700px); **no text under 11.5px**; **no decorative icon tile
  on table rows**; **a Status column answers one question**.
- **Phone width works** below 900px, no horizontal scroll.

---

## Part A. The AI layer

### A1. The principle

The code computes, the AI explains and operates. The assistant is a client
of the same functions the pages call. Every number in an answer arrives
from a tool call and carries a **source chip** that links to the tile it
came from. If the assistant cannot get a number from a tool, it says so
rather than estimating.

### A2. The tool surface (`AI_TOOLS`)

Define once, as data, so the demo and the served app share it. Each tool
is `{ name, description, input, run }` where `run` calls the existing
function and returns a plain object. This same table is what the served app
hands to the model as tools and what the MCP server exposes.

Read tools:

| Tool | Reads | Returns |
|---|---|---|
| `statement` | `computeStatement(true, scope)` | fleet totals, per-robot rows (name, work, units, rate, value, invoice, coverage, site) |
| `coverage_history` | `PERIODS`, `covForPeriod` | six periods × site |
| `keeping` | `computeKeeping(S.stallMinutes)` | per-robot stalls, hand hours, dollars; `stallMinutes` flagged assumed |
| `stall_timing` | `computeStallTiming()` | per work: worst window, ratio |
| `brands` | `computeBrands()` | per work: brand, robots, cost per unit, gap |
| `payback` | `computePayback()` | per robot: earned, price, verdict, break-even month |
| `contract` | `computeContract()` | per robot: promised, delivered, gap, credit, incidents |
| `decisions` | `computeDecisions()` | piles with reasons |
| `health` | `computeHealth()` (Health page if built; else parts from `ROBOTS[].parts`) | parts, days to zero, 90-day bill |
| `incidents` | `DOWNTIME`, `SAFETY` (A7) | filtered list by robot, site, cause, date range |
| `vendors` | `computeVendors()` (B3) | scorecard rows |
| `budget` | `computeBudget()` (B5) | budget vs actual by month and line |
| `headroom` | `computeHeadroom()` (B5) | unused scheduled hours by site and robot |
| `data_quality` | `IMPORTS`, `COMPLETENESS` (B1) | days covered, gaps, missing fields per robot |

Write tools (every one is a proposal until confirmed, see A4):

| Tool | Sets | Note |
|---|---|---|
| `set_wage` | `S.workWage[work]` | blank clears to benchmark |
| `set_throughput` | `S.workThroughput[work]` | |
| `set_hours` | `S.robotHours[i]` | |
| `set_invoice` | `S.robotInvoice[i]` | |
| `set_stall_minutes` | `S.stallMinutes` | |
| `set_contract` | `S.contract[i].{payback,uptime,start,term}` | |
| `set_scope` | `S.dashScope` | not a proposal, just navigation |
| `go` | `goView(view, extra)` | opens a page or a robot |

Every tool result includes `source: { view, tab?, robot? }` so the answer
can render chips.

### A3. The Ask panel

The top-bar search becomes **Ask**. Same 260px pill, placeholder `Ask about
your fleet`, `search` icon swapped for a small `sparkles` glyph (add the
lucide path). Typing still narrows Fleet and Numbers as it does today; press
Enter or click a suggestion and the panel opens.

The panel is a right-side drawer, 420px, full height under the top bar,
hairline left border, `--card` background, closes on Escape or the X. Above
900px it overlays the page; below, it is a full-screen sheet. State:
`S.askOpen`, `S.askThread` (array of turns), `S.askDraft`.

Panel anatomy, top to bottom:

1. **Suggestions** (when the thread is empty): six chips, the questions the
   demo answers best. `Why is Picker 2 (Zone B) under its lease?` · `Which
   robot costs the most to keep running?` · `What does Locus owe me?` ·
   `How many robots have paid back?` · `What changed since July?` · `Set
   picking wage to $26 and show me coverage`.
2. **Thread.** User turns right-aligned in `--ghost`; assistant turns
   left-aligned, 14px, line-height 1.6, at most three sentences, then a row
   of **source chips**: `pill()` with the view name and the robot or tile
   (`Fleet · Picker 2 (Zone B)`, `Costs · Keeping them running`, `Contract ·
   Credit owed`). Chips are `data-act="go"` links. A number without a chip
   does not appear.
3. **Proposals** (A4) render inline in the thread as a card with Apply /
   Dismiss.
4. **Composer** at the foot: text field, Enter to send, 44px send button.
   Under it, 11.5px `--fg3`: `Answers come from the same figures on the
   pages. Nothing here is estimated by the assistant.`

### A4. What-if by talking

A write intent (`set …`, `what if …`, `change … to …`) never edits state
directly. It renders a **proposal card**: the change in one line (`Picking
wage $24.00 → $26.00`), the before and after of the figures it moves
(`Coverage 2.39x → 2.21x · Picker 2 (Zone B) 0.69x → 0.64x`), computed by
applying the change to a cloned state and calling the same function, and
two buttons: **Apply** (44px, `--ink`) and **Dismiss**. Apply writes the
overlay through the same path Numbers uses, live-patches, and appends a
line to the audit log (B4): `Proposed by assistant, applied by Sam ·
picking wage 24 → 26 · Sep 16, 2:41p`. An applied proposal shows an
**Undo** link for the rest of the session.

`set_scope` and `go` execute immediately; they change nothing.

### A5. The demo implementation (no network)

The demo is one file with no backend, so the assistant is a
**deterministic router over the tool table**, not a language model. Build
`askRoute(text)`: lower-case, strip punctuation, match against an ordered
list of intents, each `{ test: RegExp | fn, tool, args: fn(text), say:
fn(result) }`. `say` composes the sentences from the tool result with
the same helpers the pages use (`money`, `money0`, `esc`). About fourteen
intents cover the six suggestions plus the obvious variants (`best site`,
`worst robot`, `parts due`, `credit`, `paid back`, `stalls`, `brand`,
`headroom`, `budget`, `what changed`, `set wage`, `set hours`, `set stall
minutes`, `open <page>`). Unmatched input answers: `I can answer from the
figures on Dashboard, Fleet, Costs, Payback, Contract, Decisions, Vendors,
Incidents, Reports and Planning. Try one of these:` and re-shows the chips.
Never fake a free-form answer.

Expected answers, so the demo can be checked:

- `Why is Picker 2 (Zone B) under its lease?` → `2,470 picks at $0.42 came
  to $1,037.40 against a $1,500.00 invoice, 0.69x. It stalled 142 times
  for 19.4 hours, six of them in aisle 14 between 2 and 4 in the
  afternoon, and delivered 89.70% uptime against a 95% promise.` Chips:
  `Fleet · Picker 2 (Zone B)`, `Costs · Keeping them running`, `Contract ·
  Picker 2 (Zone B)`.
- `Which robot costs the most to keep running?` → `Scrubber 75 (nights),
  $444.00 this period, 18.5 hours driven by hand at $24.00 an hour,
  measured. Picker 2 (Zone B) is next at $340.80, from 142 stalls at an
  assumed 6 minutes each.` Chips: `Costs · Keeping them running`.
- `What does Locus owe me?` → `$97.20 this period: Picker 2 (Zone B)
  $79.50 and Picker 3 (Airport) $17.70, both under the 95% uptime promise.
  Gausium owes a further $47.12 on Scrubber 75 (nights).` Chips:
  `Contract · Credit owed`.
- `How many robots have paid back?` → `4 of 13. Picker 1 (Zone A) in month
  11, Freight runner in month 10, Picker 3 (Zone C) in month 12, Picker 1
  (Airport) in month 10. Three are behind their quote; Picker 2 (Zone B)
  breaks even in month 38, after its lease ends.` Chips: `Payback`.
- `What changed since July?` → the narrated month (A6) for the current
  scope.
- `Set picking wage to $26 and show me coverage` → a proposal card,
  figures computed, not typed.

Timing: answers appear after a 400ms pause with the existing `spinner()`,
so the panel feels like it is working without pretending to think.

### A6. The narrated month

A card on Dashboard, band two, id `narrative`, label `What changed`, placed
after Needs attention. Three sentences, computed:

1. Coverage move: `Coverage went from 2.11x in July to 2.39x this period,
   up 0.28.` from `covForPeriod`.
2. The biggest mover: the robot with the largest `ROBOT_DELTA`, either
   direction: `Picker 3 (Zone C) moved the most, up 0.74, on 9,540 picks
   against 7,190 in July.` (July units from `unitsInRange` on the prior
   period.)
3. The drag: the robot with the most negative delta or the largest keeping
   cost: `Picker 2 (Zone B) is the drag, down 0.19 and $340.80 of stall
   time.`

Chips under it as in A3. When the period is closed, the card title reads
`What changed in <period>`. The `What changed since July?` intent returns
this same text; one function, `narrateMonth(scope)`, feeds both.

### A7. Alert explanations

On Notifications, each rule row gains a chevron and expands to a **why**
block for its last firing: the evidence (`Picker 2 (Zone B), Aug 4 – Sep
3: 0.69x, $1,037.40 of work against $1,500.00`), the rule as it evaluated
(`coverage below 1.00x for a full period: 0.69x`), and one chip to the
robot. Computed from the same functions; the row's `last` text stays as
is. No advice beyond the Decisions rules; if Decisions has a pile for the
robot, one line names it: `Decisions puts this robot in Move.`

### A8. Vendor briefs

On Contract's credit ledger, the `Draft the credit request` button from the
sibling prompt becomes the first of two: **Draft the credit request** and
**Draft the renewal brief** (the latter on the Lease terms panel, per robot
whose lease ends inside 9 months). The renewal brief is a plain-text panel:
`Picker 2 (Marina) · Locus LocusBot · lease ends Feb 28, 2027. Coverage
1.61x, down 0.05 vs July. Earned back 35% of its $32,000 price, break-even
month 16 against a 14-month quote. Delivered uptime 97.22% against 95%.
Cost per pick $0.26 against $0.14 on the Fetch. Three numbers to bring:
the quote it missed, the pick cost gap, and the $0 credit record.` Every
figure from a tool. `Copy` button. Both drafts route through the Ask
panel's `say` helpers, so the assistant can also produce them on request
(`draft the renewal brief for Marina`).

### A9. The import assistant

On the Import page (`start`), after a file is dropped and read, a **column
mapper** step appears before Confirm: a two-column table, `In your file` →
`Botlien reads it as`, one row per column in the export. Demo file
`pudu_export_aug.csv` with headers `robot_sn, task_start_ts, task_end_ts,
state_code, batt_pct, err_code, pos_x, pos_y, zone_name`. Prefilled
mapping: `robot_sn → robot id`, `task_start_ts → mission start`,
`task_end_ts → mission end`, `state_code → stuck or error` (with a note
`values 3 and 7 read as stuck, 9 as error`), `batt_pct → battery %`,
`err_code → error code`, `pos_x, pos_y → position (not used)`, `zone_name →
place`. Each right-hand cell is a select of the schema fields plus `ignore`.
Under the table, the **unlock list**: `Read this way, the file unlocks:
Coverage, Fleet, Costs (keeping them running, when they get stuck),
Contract. It does not unlock: Health (no wear column), Benchmark brand
split (one make in this file).` Computed from which schema fields are
mapped. A `This looks right` button proceeds to Confirm. In the demo the
mapper is deterministic; in the served app the model proposes the mapping
(A11) and the operator confirms it, same screen.

### A10. Guardrails (the served app's system prompt, also shown on the panel's About)

Write these into the system prompt verbatim and keep them in
`docs/ai/guardrails.md`:

1. Every number you state comes from a tool result in this conversation.
   If a tool did not return it, say you do not have it.
2. Carry measured vs assumed into your sentence. Say `assumed` next to any
   figure the tool marked assumed.
3. Never say what a robot could do, would do, or is capable of. Report what
   it did. Demand elsewhere is stated as demand, not as this robot's
   potential.
4. A change to an input is a proposal. Return it as a proposal; do not
   apply it.
5. Every answer ends with the sources it used, as `view · item` pairs.
6. Three sentences or fewer unless asked for a brief.
7. No em dashes.

### A11. The served app (notes for the port, not built in the demo)

Node, `@anthropic-ai/sdk`. Model `claude-opus-5` with adaptive thinking
(`thinking: { type: "adaptive" }`) and streaming. Tools are `AI_TOOLS`
serialised as tool definitions with `strict: true`, run server-side
against the tenant's database through the same `finance.mjs` / `rates.mjs`
/ `tips.mjs` / `variance.mjs` functions the owner board uses; use the SDK's
beta tool runner (`client.beta.messages.toolRunner` with `betaZodTool`) so
the loop is not hand-written. Write tools return proposals; the confirm
click is a second request path that applies the overlay and logs it.
Prompt caching: system prompt and tool list first, the thread after.
Expose the same read tools as an **MCP server** (`botlien-mcp`, one tool
per row of the read table, per-tenant API key) so an operator's own
assistant can query their fleet. Slack: the same router, one channel per
site, later.

---

## Part B. The operator layer

### B1. Data (rail item, icon `database`, section `Records`)

Description: `What has been read, from where, and how much of each figure
it can carry.`

**Three sub-nav items** (`subNav`): `Imports`, `Assets`, `Completeness`.

**Imports.** A table of `IMPORTS`:

| When | Source | Rows | Robots | Days | Result |
|---|---|---|---|---|---|
| Sep 4, 2026 6:02a | gausium-openapi · live sync | 3,118 | 2 | 31 | read, wear included |
| Sep 4, 2026 6:00a | locus_export_aug.csv · uploaded by Dana | 41,206 | 9 | 31 | read |
| Sep 4, 2026 6:00a | fetch_freight_aug.csv · uploaded by Dana | 8,576 | 1 | 31 | read |
| Aug 5, 2026 7:14a | locus_export_jul.csv · uploaded by Sam | 39,880 | 9 | 30 | read |
| Aug 5, 2026 7:14a | pudu_export_jul.csv · uploaded by Sam | 0 | 0 | 0 | not read: no timestamp column |

Rows expand to the column list read and the panels each file unlocks (the
same unlock list as A9). The failed row's detail reads `The file has no
column that reads as a timestamp, so nothing in it can be placed on a day.
Map one on the next import.` and a link to Import. Header line: `Five
imports. Everything on the statement comes from these.` A `Forward exports
to fleet@botlien.com` line with a copy button, and `Scheduled sync ·
Gausium daily at 6:00a · Locus and Fetch by file` as a small table.

**Assets.** The registry, one row per robot, index-for-index with
`CONFIRM`: Robot · Serial (`LB-2231-A` style, invent 13) · Model · Site ·
Lease ID (`LOC-2025-0417`) · Started · Ends (from `CONTRACT`) · Vendor
contact (`fleet-support@locus.example`, one per brand). Editable: name,
site (select), serial, lease ID. Moving a robot's site here is the same
`CONFIRM[i].site` every page reads; do it live and note `Moving a robot
here moves its history with it; Decisions and Sites recompute.` A `Retire`
action per row sets `S.excluded[i]` and pills the row `retired`, the same
flag Confirm uses; a `+ Add a robot` button opens a row with blanks.

**Completeness.** Per robot: days with telemetry of 31 (`COMPLETENESS`
table: 31 for all but Picker 2 (Marina) 29, Scrubber (Marina) 27, Scrubber
75 (nights) 30), the missing days listed, and which fields are present
(`missions`, `stuck/error`, `battery`, `wear`, `position`) as check marks
or `not sent`. A fleet line: `Coverage this period rests on 397 of 403
robot-days.` Every figure on Dashboard, Fleet and Costs gains one 11.5px
line where days are under 31 for the scope: `on 29 of 31 days` beside the
robot's coverage on Fleet, `on 397 of 403 robot-days` under the Dashboard
coverage figure. Computed from `COMPLETENESS`.

### B2. Incidents (rail item, icon `list`, section `Operations`)

Description: `Every stall, error, outage and safety event, when it
happened, and what it cost.`

One table, the open period, from `DOWNTIME` plus a new `SAFETY` table
(index-for-index with `CONFIRM`, each `{ date, time, kind, note }`, kinds
`e-stop`, `collision`, `near miss`; give the fleet nine: five e-stops,
three near misses, one collision on Freight runner, Aug 20 4:10p, `dock 2,
no injury, 75 min down` which is the same incident as its DOWNTIME row and
must not double count).

Columns: Date · Time · Robot · Site · Kind (`stuck · aisle 14`, `error
E-217`, `offline`, `low battery`, `e-stop`, `collision`) · Down for · Cost
(stall rows: minutes ÷ 60 × `S.stallMinutes` ÷ 6 … no: cost = the keeping
arithmetic already on Costs, so `stuck` rows carry `clearing` dollars at
the assumed minutes, hatched; hand-driven time is not per incident and
does not appear here) · Shift (from B6).

Filters above the table, all `pill()`-style toggles: by kind, by site, by
robot (search box narrows), by shift. A **Metric strip** with four tiles:
`Incidents · 49 · 40 downtime, 9 safety` · `Hours down · 116.8 h` · `Worst
hour · 2p to 4p · 38% of stall time` (from `computeStallTiming`) · `Repeat
spot · aisle 14 · 6 incidents`. Tile 3 opens the Costs stall strip inline;
tile 4 opens the list filtered to that place.

Export: `Download CSV` writes the filtered rows via a Blob URL, columns as
shown, plus `assumed_minutes_per_stall` as its own column so the assumption
travels with the data.

### B3. Vendors (rail item, icon `building`, section `Operations`)

Description: `One row per make. What they promised, what they delivered,
what they cost, what they report.`

`computeVendors()` groups every robot in scope by `brandOf(model)`. Per
brand: robots · delivered uptime (scheduled-minute weighted, from
`computeContract`) · promised uptime (mode) · incidents per 100 active
hours · cost per unit by work (from `computeBrands`, one figure per work
the brand does) · parts spend last 90 days (from Health if built, else
`0 · not reported`) · credits owed this period · support tickets
(`VENDOR_TICKETS`: Locus 2 open, median first reply 3.4 days; Gausium 1,
9 days; Fetch 0) · what they report.

The page is a **comparison table**, brands as columns, facts as rows, the
transpose of Fleet, because three columns of eleven facts read better
than eleven columns of three. Best value per row in `--fg1` weight 600,
the others `--fg2`. Rows in this order: Robots · Uptime delivered · Uptime
promised · Incidents per 100 h · Cost per pick · Cost per cleaning hour ·
Parts, 90 days · Credits owed · Support, first reply · Reports condition ·
Reports battery · Reports position. The report rows are check marks or
`not sent`, and this is the row that explains every `not reported` tag in
the app in one place.

Under the table, per brand, two buttons: **Evidence pack** (opens a
print-styled view: the brand's incident list, uptime arithmetic, and the
credit request text, with `@media print` rules and a `Print` button that
calls `window.print()`) and **Renewal brief** (A8) for any of its robots
ending inside 9 months. Tie-out: Locus delivered uptime 97.63%, Fetch
99.06%, Gausium 97.73% at All 3 sites; Locus credits $97.20, Gausium $47.12,
Fetch none.

### B4. Reports (rail item, icon `file-text`, section `Records`)

Description: `Closed statements, per site and per robot, the way they were
when they closed. Plus every figure as a file.`

**Sub-nav:** `Statements`, `Exports`, `Activity`.

**Statements.** A list of the six periods, newest first, each row: period ·
status (`open` / `closed Aug 4`) · coverage at close · robots · `View` ·
`PDF`. `View` opens a **statement page** (`view: 'statement'`, with
`S.statementPeriod`): one printable column, 760px, the period title, the
coverage figure and lead sentence from `coverageKpiCard`, the Where the
work is bars, then one block per robot with `robotEquation(s)` for that
period's units (`unitsInRange`) and that period's rate from
`RATE_HISTORY` (the closed-period rule already stated on Numbers: a
closed statement keeps the rate it closed with). Footer: `Prepared by
Botlien for Harbor Grill Group · counts are mission starts · work valued at
replacement rates`. `PDF` calls `window.print()` on that page with print
CSS (no rail, no top bar, page breaks between robots). This is the
"one page per robot" the outreach promises; make the per-robot block
stand on its own when printed.

A `Share with your accountant` control: an input showing a read-only link
(`app.botlien.com/s/7f3a…`, not live) and a `Copy` button, with `Priya
Shah · view only · closed statements` under it (from `PEOPLE`).

**Exports.** Three buttons that write real files via Blob URLs: `Statement
rows (CSV)` from `computeStatement(true, scope).rows` with a `formula`
column (`units × rate`, `value ÷ invoice`); `Incidents (CSV)` as B2;
`Every figure (JSON)` as one object with every compute function's output
and a `generated_at`. A line under them: `Power BI and Sheets connectors
read these same files on a schedule. Not in the demo.` Tag each row with
its **cost center** (below).

**Cost centers.** A small table on the Exports pane: `COST_CENTERS` =
`{ 'Pier 4': 'Own operations', 'Marina': 'Own operations', 'Airport':
'Client · Northwind 3PL contract' }`, editable text per site, and a per-
robot override select on Assets. The statement CSV carries a
`cost_center` column so a 3PL can bill Airport's robot cost through to
the client whose orders they picked.

**Activity.** The audit log, `ACTIVITY`, newest first: what changed, who,
when, from where. Seed it with `RATE_HISTORY` rows rewritten as events,
the five imports, the six alert sends from `ALERT_RULES`, and every
proposal the assistant applies (A4) and every edit on Numbers or Assets
during the session (push on the same handlers that live-patch). Columns:
When · What · By · Where (`Numbers`, `Assets`, `Ask`, `Import`). One
line under the table: `Every input change is here. A lender or an
accountant can read this instead of asking.`

### B5. Planning (rail item, icon `calendar`, section `Operations`)

Description: `What the robots cost against what you budgeted, and where
scheduled hours went unused.`

**Metric strip**, four tiles: `This period vs budget · +$94 · over` ·
`Labour vs budget · +$348 · 58% over` · `Unused scheduled hours · 4,391 h ·
across 3 sites` · `Run rate · $211,700 / yr · lease + labour + parts`.

**Budget vs actual** panel (tiles 1, 2, 4): `BUDGET` = per month, per
line: lease $16,700, labour $600, parts $250, credits $0. Actual from the
functions: lease = `totalInvoice`, labour = `computeKeeping().total`,
parts = Health's replaced-this-period figure or `$140 · one rolling brush`
seeded, credits = minus `computeContract().creditTotal`. A table, six
periods as columns, four lines plus total as rows, actual over budget in
weight 600, and a one-line reading computed from the data: `Labour has
been over budget every month since May. The lease has never moved.` Budget
cells are editable (bare-number inputs, live). Run rate = last three
periods' total × 4.

**Headroom** panel (tile 3): per site, then per robot: declared hours this
period (`hours/day × 31`), active hours (`ROBOTS[].hours`, the first
number), unused hours, unused as a percent, and a bar with the active
share solid and the unused share in `--ghost`. Airport reads `1,320
scheduled · 529 active · 791 unused · 60%`. The panel's only sentence:
`Unused hours are scheduled hours the robot did not run. They say where a
schedule is wider than the work, not what another robot would do.` Sort
by unused hours, most first.

### B6. Small additions on existing pages

- **Shifts** (Settings › Site): three named windows, editable: `Day 6a to
  2p`, `Swing 2p to 10p`, `Night 10p to 6a`. `SHIFTS` in state. Incidents
  and the stall strip on Costs label windows by shift name where one
  window falls inside a shift: the bracket on the picking strip reads
  `2p to 4p · Swing`.
- **Safety** row on Fleet's expanded robot page: `Safety this period · 2
  e-stops, 1 near miss` or `none reported`, from `SAFETY`.
- **Lender view**: not built. One line on Settings › People: `Lender
  (read only): asset condition and utilization trend, coming.` with
  `not in demo` styling. It is the creditor product's door; leave it
  marked, not built.

---

## Part C. Wiring

- **Rail** grows to twelve items, so it needs structure: hairline dividers
  between groups and **permanent 10.5px labels are not allowed** (audit),
  so use 11.5px labels under each icon at the 64px width and let the rail
  scroll if the viewport is short. Order: Dashboard · Fleet · Costs ·
  Payback · Contract · Decisions · Benchmark | Incidents · Vendors ·
  Planning | Reports · Data | Numbers, Settings at the foot. Top bar
  `SECTION` map: the first seven `Statement`, the next three
  `Operations`, Reports and Data `Records`, Numbers `Inputs`.
- **Icons** to add as lucide paths: `sparkles`, `database`, `building`,
  `list` (exists), `calendar`, `file-text`, `printer`, `download`,
  `copy`, `undo-2`, `shield-check`.
- **COPY**: add `incidents`, `vendors`, `planning`, `reports`, `data`,
  `statement`, so `?view=` deep links work.
- **State**: `askOpen:false, askThread:[], askDraft:'', askPending:null,
  proposals:[], activity:ACTIVITY.slice(), shifts:SHIFTS, budget:{},
  costCenters:{}, assets:{}, incidentFilter:{kind:'',site:'',shift:''},
  dataTab:'imports', reportsTab:'statements', planningTab:'budget',
  statementPeriod:0, importMapping:{}`. Add the transient ones to
  `CLOSED_UI_STATE`.
- **Dashboard**: the `narrative` card (A6) joins `DASH_BLOCKS` and the
  default layout after `attn`. The Payback tile from the sibling prompt
  brings the strip to six tiles; that breaks the four-tile rule, so the
  strip becomes `Coverage · A person vs your robots · Payback · Utilization`
  and Tax shield and Rate assumption live only in band three, collapsed,
  as decision D3 already said.
- **Notifications** gains two rules from the sibling prompt and the why
  blocks (A7); the header keeps counting off the rows.
- **appsMenu**: `Ask`, `Open Incidents`, `Open Vendors`, `Open Reports`
  tiles.
- **Keyboard**: `/` focuses Ask from anywhere; Escape closes the drawer.

---

## Part D. Check before you call it done

- Ask, six suggestion chips, each answer matches A5 word for word where a
  string is given, and every number in every answer has a chip that opens
  the right page.
- `Set picking wage to $26 and show me coverage` renders a proposal with
  before and after figures; Apply moves Dashboard, Fleet and Numbers and
  writes an Activity row; Undo reverts all three.
- Type gibberish into Ask: the fallback sentence and the chips, no
  invented answer.
- Dashboard strip is four tiles on one row at 1280, 1440 and 1920.
- Data › Imports: five rows, the failed one explains itself and links to
  Import. Assets: move Picker 2 (Zone B) to Airport; Fleet, Decisions and
  Vendors recompute; Activity logs it; move it back.
- Incidents: 49 rows at All 3 sites, 40 with downtime and 9 safety, the
  Freight runner collision appears once. Filter to Swing shift: 2p to 4p
  stalls dominate. CSV downloads with the assumed-minutes column.
- Vendors: three columns, Locus uptime 97.63%, credits $97.20; the
  `Reports condition` row shows Gausium only. Evidence pack prints without
  the rail.
- Reports: the Jul 4 – Aug 3 statement shows July's units and the $0.36
  rate from `RATE_HISTORY`, not today's $0.40. PDF prints one robot per
  page. Statement CSV has `formula` and `cost_center` columns and Airport
  rows read `Client · Northwind 3PL contract`.
- Planning: budget table ties to Costs and Contract for the open period;
  editing a budget cell moves the tiles; headroom for Airport reads 791
  unused hours.
- Search `marina` narrows Incidents, Vendors' robot counts, Data › Assets
  and Reports' statement rows.
- 390px: Ask is a full-screen sheet; every new table drops to two columns
  plus a chevron; no horizontal scroll on any page.
- No new colour, no text under 11.5px, no em dash in any string, nothing
  on an existing page moved except the Dashboard strip change named
  above.

## Part E. What must not change

Every existing figure and its arithmetic. The scope control's meaning.
Sources named at the figure. The rule that the assistant computes nothing:
if a question needs a number no tool returns, the answer says so.
