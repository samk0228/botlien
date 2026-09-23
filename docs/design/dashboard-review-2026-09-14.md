# Dashboard design review, 2026-09-14

Scope: the whole Botlien dashboard as it stands in the **Botlien Demo** artifact
(https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9, source
`prototype/src/botlien.part.html` on `main`): Sign in, Dashboard, Fleet, Costs,
Numbers, Settings, Notifications, plus the standalone one-screen Costs build from
Claude Design (https://claude.ai/artifact/GaRCMWsj8bwk1d4pCgcZQ6). UI only; the
served app's backend was not in scope.

Method: `/plan-design-review`, seven passes, each rated before and after. The user
chose a graded report with questions only on real choices. Nine decisions were made
(D1 to D9). The output is `dashboard-v2-iteration-prompt.md` (the brief to run in
Claude Design against the Demo prototype) and `DESIGN.md` (tokens).

## Summary

| Pass | Before | After | What moved it |
|---|---|---|---|
| 1 Information architecture | 6 | 9 | Full-width anchor row on Dashboard (D3); Costs detail nested; period preamble folded into the pill |
| 2 Interaction states | 6 | 8 | Fleet absences as a tag plus one footnote (D4); states table written |
| 3 User journey | 7 | 8 | Demo promoted to a button on Sign in, Google kept for later (D5); Costs rows get a "tried" state |
| 4 AI slop risk | 8 | 9 | Fleet essay cut; two copy defects fixed; Inter recorded as deliberate |
| 5 Design system | 5 | 8 | White ground canonical (D6); DESIGN.md written from the prototype tokens |
| 6 Responsive and accessibility | 5 | 8 | fg3 darkened to about 4.6:1 (D7); two-line phone rows (D8) |
| 7 Unresolved decisions | 9 open | 0 open | Costs iterates in the Demo prototype; the one-screen artifact is retired (D9) |
| **Overall** | **7** | **8** | |

## What already exists and should be kept

- A rail that passes the trunk test on every screen: four items, brand top-left,
  current item lit, page title first.
- The Fleet expanded row: every figure carries a provenance tag (FROM THE ROBOT,
  YOU SET THIS, WORKED OUT) and the arithmetic reads top to bottom to the result.
  This is the best hierarchy in the product and the pattern the rest should copy.
- The Costs v3 action queue is already built in the prototype, including the
  correct row 2 headline ("Try Locus on the Fetch routes") and both timing strips on
  one vertical scale.
- Monochrome ink, hairline cards, 6px radius, tabular numerals, no status colours,
  utility copy with no marketing language anywhere.
- Real states already present: the open-period tag, the under-lease badge, the
  Notifications "never sent" cell, the empty Dashboard view, the Costs flat reading.

## Pass 1: Information architecture (6 to 9)

Findings:
- Dashboard opened as nine cards of equal weight in three columns. The 2.39x figure,
  the product's whole claim, shared its size class and frame with Utilization and a
  Tax shield card whose $109,000 and $291,000 rendered at the same display size.
- The Costs row detail rendered "What it costs to keep them running" as a 17px page
  heading, so the layer-down design read as a new section rather than the row's
  contents. The strip legend repeated under both strips.
- The same two-line period preamble opened Dashboard, Fleet and Costs.

Decisions and fixes:
- **D3, decided:** one full-width anchor row (coverage figure at 48px with its two
  sentences on the left, the person-vs-robots comparison on the right). Second band
  two columns in question order: Needs attention, Where the work is, Coverage over
  time, Utilization. Third band collapsed: Tax shield, The one input you cannot
  measure. Customize applies to bands two and three.
- Costs detail nested 28px under the headline, eyebrow-size headings, one legend per
  expansion.
- Period preamble folded into the period pill, which now reads `Aug 4 – Sep 3, 2026 ·
  open` and reveals the two sentences when opened.

Hierarchy after the fix, Dashboard:

```
[ rail ]  Dashboard                                   [ Aug 4 – Sep 3 · open ] [sites] [Customize]
          +----------------------------------------------------------------------------+
          |  2.39x  open period            |  A PERSON      $39,974.40  ============    |
          |  Your whole fleet ...          |  YOUR ROBOTS   $17,648.00  =====           |
          |  Every $1 of lease bought ...  |  Your robots cost $22,326.40 less  See Costs|
          +----------------------------------------------------------------------------+
          [ Needs attention          ]  [ Where the work is            ]
          [ Coverage over time       ]  [ Utilization                  ]
          > Tax shield and depreciation   $109,000.00
          > The one input you cannot measure   30 picks/hr = 4.22x
```

## Pass 2: Interaction states (6 to 8)

Findings:
- No loading state anywhere. The prototype is instant; the served app is not.
- Costs had no quiet-period state in the prototype (the v3 brief specifies it).
- Numbers had no per-row indication of benchmark versus set values.
- Fleet rendered an absence as a full sentence on eleven of thirteen rows, which made
  the two robots that do report condition the quiet ones.

Decisions and fixes:
- **D4, decided:** absences render as a small fg3 `not reported` tag; the single
  footnote under the list explains it once and drops the list of robot names.
- States table added to the iteration brief (section 10) covering loading, empty,
  error, success and partial for every screen.
- Numbers rows gain a `benchmark` or `yours` tag.

## Pass 3: User journey (7 to 8)

Storyboard, prospect arriving from the outreach email:

| Step | User does | User feels | Specified now? |
|---|---|---|---|
| 1 | Opens the link, lands on Sign in | "Where is the no-account statement I was promised?" | Yes: demo becomes a secondary button under the email field (D5) |
| 2 | Opens the demo, sees Dashboard | Should be "2.39x, my money is working" in five seconds | Yes: anchor row (D3) |
| 3 | Scans Needs attention, opens Fleet | "Picker 2 is the problem, here is the receipt" | Already strong; absences quieter (D4) |
| 4 | Opens Costs | "Two things to do, ranked, with a dollar each" | Already built; detail nested |
| 5 | Acts on row 1, comes back next week | Wants to see that it was acted on | New: `Mark as tried` state on the row |
| 6 | Month closes | Trusts the locked figures; accountant exports | Already designed (roles, closed periods) |

Decision: **D5, decided:** promote the demo to a secondary button above the divider;
keep `Continue with Google`. Google sign-in is planned and will be connected later;
until then the prototype shows it and the served app does not.

## Pass 4: AI slop risk (8 to 9)

Classifier: APP UI. Hard rejections: none after D3 (the card mosaic was the one
borderline hit). Litmus: brand unmistakable yes; one anchor yes after D3; scannable by
headlines yes; one job per section yes; cards necessary mostly (Dashboard band two
stays cards because each is a distinct reading); motion not used; premium without
shadows yes (there are none).

Fixes made without asking, all in the direction of the user's stated preference for
less prose:
- Fleet's 110-word "Why condition sits next to the money" cut to one sentence plus the
  existing footnote.
- Notifications subhead "Four rules" corrected to match six rows.
- The Costs briefs and the design canvas had the row 2 headline inverted ("Try Fetch
  on the Locus routes"); corrected to "Try Locus on the Fetch routes" in
  `costs/v3-action-queue.md`, `costs/v3-build-prompt-for-claude-design.md`,
  `costs/v3-one-screen-prompt.md` and `prototype/design/costs-action-queue/`. The
  prototype itself was already right.
- Inter recorded in DESIGN.md as a deliberate choice, not a default.

## Pass 5: Design system (5 to 8)

Finding: no DESIGN.md. Tokens lived in two `:root` blocks that had drifted: the
prototype is white, the served app is a lavender gradient, and every downstream
prompt inherited whichever was copied.

Decision: **D6, decided:** white is canonical. `DESIGN.md` written from the prototype
tokens with D6 and D7 applied. The served app's `:root` in `src/owner.mjs` changes on
the next port.

## Pass 6: Responsive and accessibility (5 to 8)

Findings:
- `--fg3 #9AA1BC` on white is about 2.7:1 and is used for the smallest text on every
  screen: captions, arithmetic lines, tile notes, the caveats the product's honesty
  depends on. AA wants 4.5:1.
- Fleet rows carry eight values and Numbers rows five; the mobile rules (rail to top
  bar under 900px) did not say which survive at 390px.
- Row expanders are 12px `+` glyphs; the row must be the click target and the glyph a
  16px chevron.

Decisions:
- **D7, decided:** `--fg3` becomes `#6F7793` (about 4.6:1), `--fg2` becomes `#5E6685`.
- **D8, decided:** at 390px a Fleet or Numbers row is two lines, name with status tag
  left, ranking figure right, everything else in the expansion.

## Pass 7: Unresolved decisions (0 open)

**D9, decided:** Costs iterates in the Demo prototype. The standalone one-screen
Claude Design artifact is retired: as published its clicks do nothing, its method
block is empty, and the prototype's Costs screen is ahead of it. The six-frame design
canvas (https://claude.ai/artifact/12gVKZRVAcpKhRNDGjiFPR) stays as the state
reference for Costs.

Also recorded: "how we count" was removed from the product on purpose for being too
wordy. Method prose does not live on working screens.

## NOT in scope

- The served app's backend and its port of these changes (this review graded UI only).
- Typeface change (Inter is deliberate; revisit only in a brand pass).
- Google sign-in implementation (planned, will be connected later).
- Numbers grouped by kind of work instead of a flat list (tags chosen instead; grouping
  is a larger IA change for a screen operators visit once).
- Motion. None is used and none was asked for.
- Onboarding screens (import, confirm, business type). Reviewed in the Aug 5 spec.

## Implementation Tasks

Synthesized from the findings above. All land in the Demo prototype via Claude Design
using `dashboard-v2-iteration-prompt.md`, then come back into the repo the same way
the artifact was reversed on Sep 14.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** · Dashboard · Build the full-width anchor row and the collapsed third band
  - Surfaced by: Pass 1, D3
  - Files: `prototype/src/botlien.part.html` (dashv2 view)
  - Verify: one figure is first at a glance; Tax shield collapsed by default
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** · Tokens · Change `--fg3` to `#6F7793`, `--fg2` to `#5E6685` in the prototype `:root`; mirror in `src/owner.mjs` on the next port
  - Surfaced by: Pass 6, D7
  - Files: `prototype/src/botlien.part.html`, `src/owner.mjs`
  - Verify: contrast checker reads at least 4.5:1 for fg3 on white
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** · Costs · Nest the row detail 28px, eyebrow headings, one strip legend
  - Surfaced by: Pass 1
  - Files: `prototype/src/botlien.part.html` (costs view)
  - Verify: expanded detail reads as nested; only one legend line per expansion
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** · Fleet · `not reported` tag per row, one footnote, essay cut to one sentence, chevron expander with whole-row target
  - Surfaced by: Pass 2 D4, Pass 4, Pass 6
  - Files: `prototype/src/botlien.part.html` (robots view)
  - Verify: two rows show readings, eleven show the tag; footnote has no name list
- [ ] **T5 (P2, human: ~45min / CC: ~5min)** · Header · Fold the period preamble into the period pill on Dashboard, Fleet, Costs
  - Surfaced by: Pass 1
  - Files: `prototype/src/botlien.part.html`
  - Verify: no screen opens with the two-line preamble
- [ ] **T6 (P2, human: ~45min / CC: ~5min)** · Sign in · Demo as a secondary button under the email field; Google stays
  - Surfaced by: Pass 3, D5
  - Files: `prototype/src/botlien.part.html` (auth stage)
  - Verify: demo button visible above the divider at 390px and 1180px
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** · Numbers · `benchmark` / `yours` tags; derived cost rendered as WORKED OUT text; duplicate helper removed
  - Surfaced by: Pass 2, Pass 4
  - Files: `prototype/src/botlien.part.html` (setup view)
  - Verify: every row carries one tag; edit form shows one helper per field
- [ ] **T8 (P2, human: ~2h / CC: ~15min)** · Mobile · Two-line rows on Fleet and Numbers at 390px; anchor row stacks
  - Surfaced by: Pass 6, D8
  - Files: `prototype/src/botlien.part.html` (max-width 900px rules)
  - Verify: at 390px each row is two lines with the ranking figure visible
- [ ] **T9 (P3, human: ~30min / CC: ~5min)** · Costs · `Mark as tried` state on each action row
  - Surfaced by: Pass 3
  - Files: `prototype/src/botlien.part.html` (costs view)
  - Verify: pressing adds `tried <date>` to the subline; reload keeps it in prototype state
- [ ] **T10 (P3, human: ~10min / CC: ~2min)** · Notifications · Subhead count matches rows
  - Surfaced by: Pass 4
  - Files: `prototype/src/botlien.part.html` (alerts view)
  - Verify: text reads "Six rules" or counts dynamically
- [x] **T11 (P2, done 2026-09-14)** · Docs and canvas · Row 2 headline corrected in three briefs and the design canvas; canvas republished (version 2)
  - Surfaced by: Pass 4
- [x] **T12 (P2, done 2026-09-14)** · Docs · `DESIGN.md` written from the prototype tokens with D6 and D7 applied
  - Surfaced by: Pass 5

_No new tasks from Pass 7 beyond retiring the one-screen artifact (no code)._

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | none |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | not run | none |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | not run | none |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 7/10 → 8/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | none |

- **VERDICT:** DESIGN reviewed, 9 decisions made, 10 tasks open in the prototype; eng review required before the port to `src/` ships.

NO UNRESOLVED DECISIONS
