# Botlien clickable prototype

## The published version

The prototype we are working toward is the **Botlien Demo** artifact:
https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9. Its exact source is
`src/botlien.part.html` on `main`: the build reproduces the artifact page byte
for byte (unwrap the publish shell, drop the Claude Design badge, and the two
are identical). Last synced Sep 16, 2026 from artifact version
`1789623340-fba9`, which added Trends, Payback, Contract, Decisions, Benchmark,
Incidents, Vendors and the printable evidence pack. When the artifact changes,
bring the change back here the same way so the repo never falls behind the
design again.

Design explorations that have not been ported yet live in `design/`, one folder
per canvas, as `.dc.html` artboards plus the generator that writes them:

- `design/costs-action-queue/`: the Costs screen as an action queue (v3 brief),
  published at https://claude.ai/artifact/12gVKZRVAcpKhRNDGjiFPR.

## The manufacturing dashboard (Antonio's v4, merged Oct 5, 2026)

`botlien-mfg.html` is a second page built from the same assets. Its source is
`src/botlien-mfg.part.html`: Antonio's Dashboard Package v4 merged three ways
into this prototype, so it carries his Ask panel, Integrations, Line page and
URSim replay together with everything here (the line editor, the Slack
settings code, the live data adapter, the repo's fixes).

- **View it:** open `botlien-mfg.html`. With no parameters it shows the CNC
  cell sample. `onboarding.html` and `onboarding_chat.html` are his onboarding
  pages, copied as they came, linked from the Line page.
- **How it was merged:** `git merge-file` with ours = `src/botlien.part.html`,
  base = the prompt 5 Claude Design artifact (`JpnEcJ5yZAcu7S17G7fCBY`,
  template unwrapped), theirs = v4. Use the artifact as the base, not the repo
  file, or the repo's live wiring is reverted. Fifteen conflicts, all small.
- **What v4 changes besides adding pages:** the sample is a CNC shop, pills
  become plain labels, and cost inputs are read only and changed by telling
  Ask. v4 also hid ten pages (Trends, Payback, Contract, Decisions, What if,
  Vendors, Benchmark, Costs, Coverage, Evidence). They are back in the rail
  here, at Sam's request. Costs stays hidden for arms priced by cost per hour,
  as on the existing page, because there it only repeats the Dashboard.
- **Known rough spots on the restored pages** (the existing page has the same
  ones in its manufacturing preview): Trends prints working share as `0.22x`
  instead of 22%, What if still lists the warehouse sample's saved plans, and
  Payback and Contract keep their lease wording.
- **Not served to real accounts.** Ask is scripted, rules and app connections
  live in the browser's local storage, and the Line page plays a recording of
  a simulated URSim run. `botlien-prototype.html` is unchanged and is still
  what `/app` serves. Real accounts move to this page as each part is wired to
  the server.

One self-contained HTML file covering the whole product: sign-in flow, four-step
first run, and the coverage statement. No build step needed to view it, no
network calls, fonts and logo inlined as data URIs.

- **View it:** open `botlien-prototype.html` in a browser.
- **Live artifact:** https://claude.ai/code/artifact/963bddb6-d6b2-489b-8483-ddf7d766c59a

## Where it came from

Merged 2026-08-07 from two Claude Design components that cross-linked by
filename (`./Botlien Dashboard.dc.html`, `./Login Page.dc.html`), which never
resolves once published. Rebuilt as one vanilla-JS app so the links are real:
sign-in leads into the statement, log out leads back.

Then revised against a three-lens audit (VC, owner, SaaS builder). What that
added: live sensitivity on the throughput assumption, period-over-period trend,
cohort benchmark, effective-dated rates with history, open vs closed periods,
org/site hierarchy and an all-sites roll-up, roles, notification rules,
scheduled delivery and an accountant share link, vendor export instructions,
sample-data path, workspace-join detection, and import overlap handling.

This is now the only Botlien design. The earlier dashboard and login page it was
merged from are retired; nothing should be traced back to them.

## Reaching a specific screen

Sign-in has no rail. An owner arriving here sees one card, because that is what
a sign-in screen is, and a state navigator standing next to it reads as a
prototype rather than a product. The app keeps its rail, since moving between
Coverage, Robots, Rates and Settings *is* the product.

Every screen is still addressable, just not advertised:

```
?screen=expired      any key in AUTH_JOURNEY or AUTH_STATES
?view=rates          any key in COPY
```

Unknown keys are ignored rather than rendering an empty page, so a stale demo
link opens at sign-in instead of at nothing. `?screen=` also survives a reload,
which the old rail did not.

## Editing

`botlien-prototype.html` is generated. Edit the source, do not edit it directly.

```
cd src
node build.cjs          # writes ../botlien-prototype.html
```

- `src/botlien.part.html` is the whole app: CSS tokens, data, views, actions.
  Placeholders `__LOGO__`, `__INTER__`, `__INTER_EXT__`, `__ICONS_JSON__` get
  substituted at build. (The mono subset, `__MONO__`, left with the visible
  arithmetic; nothing references it any more.)
- `src/assets.json` holds those substitutions (woff2 subsets, logo PNG, lucide
  icon paths) extracted from the original bundles.

The built file is a complete HTML document since the Sep 16 sync, so it opens
directly; no wrapping step. Every screen is addressable with `?view=` (see
below), and `?demo=1` lands on the populated Dashboard the way botlien.com/demo
does.

## Numbers

Every figure ties out and the arithmetic is shown on the page. Rate is rounded
to the cent before it is multiplied, which is how the statement asks to be
checked by hand. Demo fleet: 12,060 tray runs at $0.73 plus 120 cleaning hours
at $25.00 is $11,803.80 of work against $4,796.00 invoiced, so 2.46x.

Coverage only falls to 1.00x at about 151 runs per hour per person, which is
why the sensitivity slider reads as a robustness argument rather than a
disclosure.

## Not built here

Auth, tenancy and roles are designed in these screens but do not exist in the
server. See the repo (`samk0228/botlien`) for what is real.
