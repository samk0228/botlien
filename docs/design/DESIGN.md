# Botlien design system

One committed light palette, monochrome ink, hairline cards, arithmetic shown
everywhere. This file is the source of truth for tokens. When the prototype
(`prototype/src/botlien.part.html`) and the served app (`src/owner.mjs`)
disagree, this file wins and the code is brought to it.

Decisions recorded here were made in the 2026-09-14 design review
(`dashboard-review-2026-09-14.md`).

## Ground and ink

| Token | Value | Use |
|---|---|---|
| `--page-bg` | `#FFFFFF` | Page ground. White, as the prototype. The served app's lavender gradient is retired on the next port (decision D6). |
| `--fg1` | `#16204A` | Primary text, figures, bars, left rules |
| `--fg2` | `#5E6685` | Secondary text, sublines, helper copy (was `#6B7392`; darkened with fg3 so the ramp stays distinct) |
| `--fg3` | `#6F7793` | Captions, arithmetic lines, tile notes, "not reported" tags. Was `#9AA1BC` at 2.7:1 on white; now about 4.6:1 (decision D7). |
| `--ink` / `--ink-fg` | `#0A0A0A` / `#FFFFFF` | Primary buttons |
| `--hair` | `rgba(10,10,10,.10)` | Card borders, row dividers |
| `--hair2` | `rgba(10,10,10,.16)` | Control borders, badges |
| `--hair3` | `rgba(10,10,10,.28)` | Focus and pressed borders |
| `--ghost` / `--ghost2` | `rgba(10,10,10,.04)` / `.05` | Hover fills, badge fills |
| `--hatch` | `repeating-linear-gradient(135deg, rgba(10,10,10,.35) 0 2px, rgba(10,10,10,.08) 2px 5px)` | Estimated quantities, never measured ones |

No status colours. No red, green or amber anywhere in the product. Ink density
carries magnitude; shape and position carry state.

## Type

Inter, weights 400 to 800, `system-ui` fallback, antialiased. Inter is a
deliberate choice and is embedded in both builds.

| Role | Size / weight / tracking |
|---|---|
| Page title | 27px / 700 / -.02em |
| Anchor figure (Dashboard coverage) | 48px / 700 / -.03em, tabular |
| Headline figure (hero cards) | 36px / 700 / -.03em, tabular |
| Tile value | 26px / 700 / -.01em, tabular |
| Row headline (action rows) | 14.5px / 700 |
| Row magnitude | 16px / 700, tabular |
| Body, lead sentence | 14px / 400, line-height 1.7 |
| Robot name | 13.5px / 600 |
| Subline, helper | 13px / 400, fg2 |
| Period pill, nav, sublabels | 12.5px / 600 to 700 |
| Caption, tile note, qualifier | 11.5px / 400, fg3 (minimum size for any text that carries meaning) |
| Eyebrow, section label | 11px / 700 / .08em, uppercase, fg3 |
| Arithmetic line | 11px mono (`ui-monospace, Menlo, "SF Mono", monospace`), fg3, line-height 1.6 |

Every money figure and count uses `font-variant-numeric: tabular-nums`.

## Surfaces

- Card: 1px `--hair` border, 6px radius, transparent fill. Headline card
  padding 22px 24px 20px. Tile 15px 16px. Panel 4px 18px.
- Rows: 13px padding top and bottom, `--hair` divider, no card.
- Action rows (Costs): 2px left rule, padding 14px 0 14px 15px. Solid rule is
  money already spent, dashed rule is money conditional on acting.
- Row detail (expanded): nested 28px under the row, eyebrow-size headings,
  one legend line per section, never a page-level heading inside a row.
- Badge: 10px / 700 / .06em, `--hair2` border, 3px radius, padding 2px 7px.
- Buttons: primary `--ink` fill, 4px radius, 12px 20px, 13.5px / 700.
  Secondary: transparent, `--hair` border. All hit targets 44px or larger.
- Charts: bars in `--fg1` with opacity 35% to 100% by height; every strip on a
  page shares one vertical scale; operating window is a `rgba(10,10,10,.035)`
  wash; no minimum bar height, no clamping.

## Layout

- Rail 256px, items 32px tall, 8px radius, 14px type, 500 idle and 600
  active. Four items: Dashboard, Fleet, Costs, Numbers. Account menu at the
  bottom holds Notifications, Settings, Log out.
- Content column max-width 1060px, padding 32px 24px 64px.
- Below 900px the rail becomes a top bar and grids collapse to one column.
- At 390px a Fleet or Numbers row is two lines: name with its status tag on
  the left, the figure that ranks the row on the right; every other column
  moves into the expanded row (decision D8).

## Copy

- Utility language: orientation, status, action. No mood copy.
- Every figure shows its arithmetic. Unknown is stated, never blank.
- Method prose does not live on working screens. One short footnote per
  screen at most; the long form was removed on purpose (2026-09-14).
- No em dashes anywhere in the product.
