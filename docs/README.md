# Botlien docs

Everything an engineer or designer needs that is not code. Rendered PDFs of
several of these, plus screenshots and the fleet-operator target sheet, live in
Sam's vault (`Claude/Projects/operating_systems/botlien/`), not here.

## Start here

- [`company-brief.md`](company-brief.md): what Botlien is, who buys it, the
  product principles, the architecture, the exact schema, and the roadmap. Read
  this first. It is also the brief handed to any outside model or contractor.

## Product

| File | What it is |
|---|---|
| [`product/walkthrough.md`](product/walkthrough.md) | Tour of the served app screen by screen, as of Aug 7 |
| [`product/owner-walkthrough-v2.md`](product/owner-walkthrough-v2.md) | The owner statement: what each figure means and how it is computed |
| [`product/onboarding-spec-v1.md`](product/onboarding-spec-v1.md) | Import → confirm → setup → statement, and why the step is derived from data |
| [`product/dashboard-roadmap.md`](product/dashboard-roadmap.md) | Eleven dashboard ideas in three tiers, grounded in a field-by-field audit of the schema. Payback tracker is first. |
| [`product/calculations/calculations.typ`](product/calculations/calculations.typ) | Every formula on the statement, worked by hand against the demo fleet (Typst source; figures in `figs/`) |

## Design

The clickable prototype lives in [`../prototype/`](../prototype/README.md).
The published version is the **Botlien Demo** artifact:
https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9. Its exact source is
`prototype/src/botlien.part.html` on `main`.

### The Costs screen, in order

| File | Date | What changed |
|---|---|---|
| [`design/costs/v1-add-the-costs-screen.md`](design/costs/v1-add-the-costs-screen.md) | Aug 31 | Adds the screen: the three honesty rules, tiles, stall timing strip (replacing the floor map), brand against brand, all numbers |
| [`design/costs/v1.1-three-fixes.md`](design/costs/v1.1-three-fixes.md) | Aug 31 | One shared vertical scale across strips, cut the design rationale from the customer's screen |
| [`design/costs/v2-prototype-and-served-app.md`](design/costs/v2-prototype-and-served-app.md) | Aug 31 | Part A prototype fixes; Part B brings the served app to the prototype's decisions (timing strip, brand on import) |
| [`design/costs/v3-action-queue.md`](design/costs/v3-action-queue.md) | Sep 2 | Turns the screen into an action queue: 60 words visible, verb headlines, two rows never describing the same money, detail one layer down |
| [`design/costs/v3-build-prompt-for-claude-design.md`](design/costs/v3-build-prompt-for-claude-design.md) | Sep 14 | Self-contained build prompt for v3 (tokens, numbers, anatomy) used to compare the Claude Design route against the `/design` canvas |
| [`design/costs/v3-one-screen-prompt.md`](design/costs/v3-one-screen-prompt.md) | Sep 14 | The same v3 design as **one interactive frame** instead of six state frames. This is the one to iterate from in Claude Design. |

The v3 design canvas (six artboards, click-to-edit) is at
https://claude.ai/artifact/12gVKZRVAcpKhRNDGjiFPR; its sources are in
[`../prototype/design/costs-action-queue/`](../prototype/design/costs-action-queue/).

### Whole-dashboard review, Sep 14

| File | What it is |
|---|---|
| [`design/DESIGN.md`](design/DESIGN.md) | The design system: tokens, type scale, surfaces, layout rules. Source of truth when prototype and app disagree. |
| [`design/dashboard-review-2026-09-14.md`](design/dashboard-review-2026-09-14.md) | Seven-pass design review of every screen, rated before and after, nine decisions, ten tasks |
| [`design/dashboard-v2-iteration-prompt.md`](design/dashboard-v2-iteration-prompt.md) | The brief to run in Claude Design against the Demo prototype to apply those decisions |

## Ops

| File | What it is |
|---|---|
| [`ops/deploy-runbook.typ`](ops/deploy-runbook.typ) | Fly.io deploy, secrets, Resend mail, backups and restore rehearsal, the single-machine SQLite constraint (Typst source) |

## Conventions for these docs

- Plain prose, no em dashes, sixth-grade reading level where the audience is not an engineer.
- Briefs are frozen once acted on. Write a new version rather than editing v1.
- Numbers in a brief must tie: if one changes, recompute the rest and say so.
