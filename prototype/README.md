# Botlien clickable prototype

## The published version

The prototype we are working toward is the **Botlien Demo** artifact:
https://claude.ai/artifact/GCaGNEseYu63EeQMDghUm9. Since Sep 14, 2026 its exact
source is `src/botlien.part.html` on `main`: the build reproduces the artifact
page byte for byte (unwrap the publish shell, drop the Claude Design badge, and
the two are identical). When the artifact changes, bring the change back here
the same way so the repo never falls behind the design again.

Design explorations that have not been ported yet live in `design/`, one folder
per canvas, as `.dc.html` artboards plus the generator that writes them:

- `design/costs-action-queue/`: the Costs screen as an action queue (v3 brief),
  published at https://claude.ai/artifact/12gVKZRVAcpKhRNDGjiFPR.

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
  Placeholders `__LOGO__`, `__INTER__`, `__INTER_EXT__`, `__MONO__`,
  `__ICONS_JSON__` get substituted at build.
- `src/assets.json` holds those substitutions (woff2 subsets, logo PNG, lucide
  icon paths) extracted from the original bundles.

To preview locally, wrap it, because the published page is injected into a
`<body>` and the file has no `<html>` tag of its own:

```
node -e "const f=require('fs');f.writeFileSync('/tmp/p.html','<!doctype html><html><head><meta charset=utf-8></head><body>'+f.readFileSync('../botlien-prototype.html','utf8')+'</body></html>')"
```

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
