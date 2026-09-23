# Botlien: turn the Costs screen into an action queue

Supersedes the layout in `DESIGN_PROMPT_costs_v2.md` Part A. Everything in v2 Part B
(the served app: brand on import, swapping the map for the timing strip) is unaffected and
still stands.

Target: branch `origin/owner-formula-discretion`, `prototype/src/botlien.part.html`, then
`cd prototype/src && node build.cjs`. Never edit the generated file.

---

## The problem, measured

The Costs screen currently renders **1,002 words**. A dashboard screen should be 80 to 150.

| Section | Words today |
|---|---|
| Header and headline | 112 |
| What it costs to keep them running | 275 |
| When they get stuck | 335 |
| Brand against brand | 280 |

Every section is written as an argument: claim, evidence, method, caveat. That is the
structure of a memo. A dashboard is state, magnitude, action. Nothing here is wrong, it is
all in the wrong layer.

**The deeper cause.** This product deliberately uses no status colours, which was a good
decision that was never paid for. Colour is a signal channel; refusing it means shape and
position have to work twice as hard. They currently do almost nothing, so words became the
only channel. This revision spends the budget on shape.

**Nothing gets deleted in this revision.** Every sentence, every figure and every caveat on
the screen today survives. It moves one layer down.

---

## 1. The new structure

```
COSTS · AUG 4 – SEP 3 · OPEN                       [All 3 sites ▾]

$948 beyond the lease
[██████████████████████ lease $16,700 ][██ labour $948]

What to do

1  Go watch the 2pm shift            $948      ▁▁▂▃▃▂█▇▃▂▁      ›
   38% of it lands between 2p and 4p

2  Try Locus on the Fetch routes     $2,533    ▓▓▓ vs ▓▓        ›
   if the difference is the machine and not the route

                                            how we count ›
```

**Hard budget: 60 words visible by default**, hero and rows and links included. It is at
1,002 today. The budget is the point of the exercise, so treat it as a constraint, not a
target to approach.

---

## 2. The ranking rule, and the trap in it

This is the load-bearing part. Get it wrong and the screen becomes dishonest in a new way.

**Rows must never describe the same money twice.** The current three sections overlap. The
2pm finding is not separate money from the $948, it is *where the $948 concentrates*. The
worst single robot is not separate money either, it is a slice of the same total. Listing
them as three rows would triple-count one problem and make the screen look busier than the
fleet actually is.

So the three existing sections collapse into **two independent findings** for this data:

- **Row 1** merges "what it costs to keep them running" and "when they get stuck". Same
  problem, and the timing is the instruction for acting on the cost.
- **Row 2** is the brand comparison, which is genuinely separate money.

**Two rows is the correct answer here and the screen must be comfortable showing two.**

### Ordering

1. **Costs before opportunities.** Money already spent is certain. Money conditional on an
   action is not. $2,533 of conditional upside must not outrank $948 of spent labour just
   because the number is bigger.
2. Within each group, by size descending.

### Row types, carried by the existing convention

Reuse the left-rule treatment `tips.mjs` already established, so this is not a new visual
language:

- **cost** row: solid left rule. Money already spent.
- **opportunity** row: dashed left rule. Money conditional on the operator doing something.

The dashed rule is what stops the brand row reading as a bill.

### Queue length

**Never pad to three.** The queue is 1, 2, 3 or 4 rows depending on what the data supports.
A month with one finding shows one row. Inventing a third to fill a grid is the same
failure as a zero-length bar.

### Empty state

A period with nothing worth acting on is a real and good result, and it must read that way
rather than as a broken screen:

> **Nothing to chase this period.** Your robots cost $61 in staff time across 31 days, which
> is noise. The detail is still here if you want it.

---

## 3. Anatomy of a row

Five elements, in this order, on one line plus a subline:

1. **Rank numeral.** Quiet, small, mono.
2. **The verb headline.** Maximum 6 words, and it must start with a verb. Not a noun phrase.
   "Go watch the 2pm shift", not "When they get stuck". "Try Locus on the Fetch routes", not
   "Brand against brand". The heading instructs, it does not describe.
3. **The magnitude.** One figure, tabular numerals, right of the headline.
4. **The shape.** One small graphic, roughly 110px wide and 24px tall, no axis, no labels,
   no legend. It carries the pattern only. The full chart lives in the detail.
   - Row 1: the 24-hour strip in miniature with the worst window marked.
   - Row 2: two bars, cheapest first.
5. **A chevron.** Opens the detail.

Plus one **subline**, maximum 10 words, that gives the single qualifying fact:
"38% of it lands between 2p and 4p", "if the difference is the machine and not the route".

Nothing else appears on a row. No method, no arithmetic, no caveat.

---

## 4. The detail layer

The chevron expands the row **in place**, pushing what is below it down. One row open at a
time. The chevron rotates. Do not build new routes or a modal.

Inside the expansion goes **the existing section, unchanged**: the tiles, the per-robot
rows, the full-size chart with its axis and legend, the arithmetic lines, the brand table
with both guards, and the small print. All of it is good work and all of it stays exactly
as written.

The only edit inside the detail: the three method paragraphs move out (see §5).

---

## 5. Stop teaching the method three times

Three separate paragraphs currently explain how we think:

- peaks are found inside one kind of work, never across the fleet
- this is an observation, not an experiment
- the share of running time inside the bracket is assumed, not measured

Each is correct and each is worth keeping. They do not belong in three places. Collect them
under one page-level **"how we count"** link, alongside the six-minute assumption and the
note that stalled hours are shown but never billed as labour.

The minutes-per-stall control stays editable and stays inside the row 1 detail, next to the
figure it changes. An assumption the reader can move is the one piece of method that earns
its place near the number.

---

## 6. Visual vocabulary, defined once

Declare these page-wide and never restate them in prose:

- **Paired bars** always mean a money comparison. Longer is more.
- **Solid fill** is measured. **Hatched fill** is estimated from a stated assumption.
  One legend, once, at page level.
- **Solid left rule** is a cost. **Dashed left rule** is conditional upside.
- **Ink density** carries magnitude. Still no status colours anywhere, no red, no green,
  no amber.
- Every chart on the page shares one vertical scale, as already fixed.

Once a reader learns four conventions they stop reading and start scanning, which is the
entire objective.

---

## 7. What must not change

- The hero figure and its stacked bar.
- Every number, every figure and every caveat, all of which move rather than go.
- The measured-versus-estimated distinction, now carried by fill instead of by sentence.
- Stalled hours shown as context and never priced as labour.
- The single-machine flag on a brand row, which moves into the detail.
- The flat reading ("no shift to go and watch here"), which becomes the row's own subline
  when it fires, or removes the row entirely if there is nothing to act on.
- Monochrome throughout.

---

## 8. Acceptance

- Default view is **60 words or fewer**. Count it.
- Every row headline **starts with a verb** and is 6 words or fewer.
- **No two rows describe the same money.**
- The queue renders correctly at one row, two rows, and zero rows.
- Every sentence removed from the default view is findable within one click.
- A reader who never opens a detail still knows what to do first, and how much it is worth.
