# Botlien Costs section: everything outstanding

Supersedes `DESIGN_PROMPT_costs_v1.md` and `DESIGN_PROMPT_costs_v1.1_fixes.md`.

**There are two targets and they have drifted apart. Do not mix them up.**

| | Target | Where | State today |
|---|---|---|---|
| **Part A** | The clickable prototype | branch `owner-formula-discretion` @ `07ea9aa7`, `prototype/src/botlien.part.html` | Costs screen built, uses the **timing strip** |
| **Part B** | The served app | `main`, `src/`, uncommitted working tree | Costs tab built, still uses the **floor map** |

The prototype is correct and the app is behind. Part B brings the app to the prototype's
decision, not the other way round.

---

# PART A — the prototype

Edit `prototype/src/botlien.part.html`, then `cd prototype/src && node build.cjs`. Never
edit the generated file. This is a surgical patch: do not rebuild a section, do not
restyle, do not touch the tiles, the brand table, the guards or the small print.

## A1. One shared vertical scale across every timing strip

The bug, and it is the same failure the floor map had: the picture argues against the
sentence printed under it.

Each strip is normalised to its own maximum, so:

| strip | total lost | how it draws |
|---|---|---|
| Order picking | **29.3 hours** | bars vary, peak bracket 11.1h |
| Floor cleaning | **1.7 hours** | every bar in the window solid at full height, bracket 0.5h |

The strip for the trivial problem draws heavier than the strip for a problem seventeen
times larger. Anyone scanning concludes the floor cleaners are the disaster, which is the
opposite of what the text says.

**Fix.** Compute the ceiling **once per page**, from the tallest single-hour stall figure
across every strip, and scale all strips against it. Floor cleaning then renders as a
barely visible sliver, which is the truth.

- **No minimum bar height, no clamping.** A near-zero hour draws as near-zero. An
  always-visible floor is the same lie in a smaller form.
- **Keep each strip's own bracket and figure.** Only the vertical scale is shared. The
  bracket still marks that strip's own worst two hours, which stays a real finding.
- **Name the ceiling in the legend**, e.g. `tallest bar = 6.2h`, after "bracket marks the
  worst two hours". Bar height is one hour of stall time, the bracket figure is a two-hour
  total. Different quantities, and the legend must not let a reader merge them.

## A2. Take the design rationale off the customer's screen

Currently:

> Your robots lost 31.0 hours to stalls this period. Everyone can read a clock, so this is
> on the hour of the day rather than a spot on a floor plan, and it needs only a timestamp,
> which your export already carries. Peaks are found inside one kind of work, never across
> the fleet: a night scrubber scored against the day shift's picking peak would read as
> permanently idle.

Everything after the first sentence is our reasoning about how we built the chart. The
customer never saw a floor plan and does not care that we rejected one. Replace the whole
paragraph with:

> Your robots lost **31.0 hours** to stalls this period. Here is when.

The "peaks inside one kind of work" reasoning goes, it does not move. The separate strips
demonstrate it without narrating it.

## A3. Confirm §0 shipped

The **"A person vs your robots"** card on the Dashboard must read:

```
YOUR ROBOTS   $17,648.00
              $16,700.00 leased + $948.00 of your team's time keeping them running
Your robots cost $22,326.40 less this period
```

If it still shows `$16,700.00` and `$23,274.40 less`, that edit was missed. It is the
single most valuable change in the whole brief.

## A4. What not to touch in the prototype

- The three tiles, their figures, their measured-versus-estimated captions.
- The small print naming the six-minute assumption.
- The small print saying the share of running time inside the bracket is assumed rather
  than measured. **Correct as written, it stays.**
- The brand table, its two guards, the "Fetch rests on one machine, Freight runner" note.
- The flat reading on floor cleaning ("no shift to go and watch here").
- Colour. Monochrome, no status colours anywhere.

---

# PART B — the served app

Working tree on `main`, uncommitted. Existing state: `src/interventions.mjs`,
`src/floorplan.mjs`, `src/brands.mjs`, three store queries, a `/owner/costs` route and
`renderCostsHTML`, plus `test/interventions.test.mjs`, `test/floorplan.test.mjs`,
`test/brands.test.mjs`. 250 tests green.

## B1. Replace the map with the timing strip

The app still renders the floor map. It must not. Same two reasons: `src/importer.mjs`
hardcodes `pose: null`, so no file-based customer can ever produce one, and nobody could
read it.

- Delete `src/floorplan.mjs` and `test/floorplan.test.mjs`.
- Delete `store.poseGrid()`. Leave `stallHotspots()` and `stallSampleCount()` alone: the
  stall-hotspot **tip** still uses them and that tip is words, not a picture.
- Add `src/stalltiming.mjs`, pure, no store access, mirroring the shape of the other
  modules. It takes hourly rollups plus each robot's task type and returns, per task type:
  stall hours by hour of day (24 buckets), operating window, the worst contiguous two-hour
  window, that window's share of stall time, its share of working hours, the in-window
  stall rate and the all-day stall rate.
- **Per-hour running time is genuinely measured in the app.** `utilization_rollups` stores
  `active_ms` per hourly bucket, so unlike the prototype the rate is not an assumption.
  Drop the prototype's caveat sentence here and say plainly that both are measured.
- Buckets come from `bucket_start_at`, converted to hour-of-day in the **site's** timezone,
  not UTC and not the server's. A statement that puts the afternoon peak at 5am because of
  a timezone is worse than no statement.
- Peaks computed **inside one task type**, never fleet-wide, matching `tips.mjs`.
- Render one strip per task type in `renderCostsHTML`, with the **shared vertical scale**
  from A1 applied across every strip on the page.
- Tests: worst-window detection, the flat-reading branch, the shared ceiling, timezone
  conversion, and a fleet with no `stuck` data producing no section rather than an empty
  chart.

## B2. Read brand from the imported file

This is the highest-return change in the document. Brand against brand is the one section a
robot manufacturer structurally cannot ship, and today it can never render for a real
customer, because `importTelemetryFromText` takes `brand` as a function parameter
defaulting to `null` and never reads it from a row.

- Add brand to the accepted aliases: `brand`, `make`, `vendor`, `manufacturer`. Add it to
  `ACCEPTED_COLUMNS` so the import screen advertises it.
- Read it **per row**, not once per file. A mixed fleet is the entire point, and a
  file-level brand would flatten exactly the case the section exists to serve.
- Set it on first sight and never overwrite a known brand with a later null, so a file with
  the column populated on only some rows still works.
- Normalise for comparison but preserve what the operator typed for display: trim, collapse
  inner whitespace, case-insensitive match so `locus`, `Locus` and `LOCUS ` are one brand,
  displayed as first seen.
- Keep the existing `brand` parameter working for connector-fed callers, as a fallback when
  a row carries none.
- Tests: file with a brand column produces per-robot brands and a rendered comparison; file
  without produces null brands and **no** brand table; mixed casing collapses to one brand;
  a brand present on some rows only still attaches; the file-level parameter still applies
  when no column exists.

## B3. Hand-driving stays absent, never zero

`snapshot_conditions` is never written on import, so `manual_controlling` cannot exist for a
file-based customer. That is correct and must not be papered over.

- The "Driving by hand" tile must render as **absent with a reason**, never as `$0.00`.
  `fleetInterventions().hasManualFeed` already carries this; confirm the render path uses it
  and that the total does not silently include a zero.
- The empty state should name what would unlock it: a live vendor connection, not a column.

## B4. Do not regress the honesty rules

- Measured and estimated stay visually separated.
- Stalled robot hours stay context, never priced as labour, because coverage already counts
  them.
- The minutes-per-stall assumption stays stated on screen and stays editable.
- Zero terms stay dropped from the arithmetic lines.
- Hours in arithmetic lines keep one decimal so the multiplication survives being checked
  on paper.
- No status colours.

## B5. Ship discipline

- `npm test` and `npm run e2e` green before and after.
- Additive where possible. The Dashboard render function must stay untouched.
- Do not commit or deploy without a run through `/review`.

---

# The order I would do it in

1. **A3**, confirm the person-vs-robots edit shipped. It is one card and it is the most
   valuable thing here.
2. **A1**, the shared scale. It is a live misrepresentation on a screen you are demoing
   Friday.
3. **A2**, trim the intro paragraph. Five minutes.
4. **B2**, brand on import. Small, and it converts your most defensible section from
   undeliverable to deliverable.
5. **B1**, swap the app's map for the timing strip, so the two stop diverging.
6. **B3**, verify the absent-not-zero path.
