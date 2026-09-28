# Botlien Demo: first run inside the app, for real accounts

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

**The demo does not change.** Everything below runs only when the page is a
real account's dashboard, which the page already knows: `LIVE` is set (the
account's data, from `liveTables()`) and `S.demoMode` is false. With
`?demo=1`, every screen, mock and number stays exactly as it is today.

## Why

The page is now served to real accounts at `/app`. Today a brand-new account
is sent away from it to four plain server pages (pick a business, upload,
confirm) and only comes back once it has a fleet. This pass moves that first
run into the Demo's own designed screens, talking to the real server, so a
new customer never leaves the app.

When you are done, add this line near the top of the script, beside `LIVE`:

```js
const LIVE_FIRST_RUN = true;
```

The server looks for it. Once the page carries it, `/app` stops redirecting
new accounts away and serves this page instead. Without it nothing changes,
so this pass can land at any time.

---

## 0. Rules

- **Only real numbers.** In a live account never show a demo figure: no
  "52,900 rows", no "13 robots", no "locus-fleet-export.csv", no made-up
  percentage bar. Every figure on these screens comes from the server's
  reply. Where the server has not said, say nothing or say "not reported".
- **Every button states what happens,** and follows the page's existing
  `BUTTON_STATES` pattern: disabled with the reason, pending while the
  request runs ("Checking your keys…"), failed with the server's own
  `error` text and a way to try again. Never a silent failure.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`
  with its glyph, figures in `--fg1`, accent in its five places, no text
  under 11.5px, no em dashes anywhere, 390px works.
- **No button that does nothing.** A step the server cannot do yet is
  hidden in a live account, not shown and inert (see 6).
- Plain words, one idea per sentence, short.

---

## 1. What the page already has

`LIVE.FIRST_RUN` is the account's first-run state. The same object comes back
from every setup call below, so after any call, replace it with the reply and
re-render.

```js
LIVE.FIRST_RUN = {
  step: 'business' | 'import' | 'confirm' | 'setup' | 'done',
  business: 'restaurant' | null,          // key of the chosen type
  businessTypes: [{ key, label, blurb, exportHint, works:[labels], unit,
                    rateCents, derivation, operatingHoursDay }],
  robots: [{ id, name, brand, model, category, excluded, seen, site }],
  categories: [{ key, label }],           // the kinds of work for this business
  sites: ['Pier 4', ...],
  lastImport: { filename, rows, imported, skipped, skipReasons, robots,
                rangeLabel, at } | null,
  vendors: [{ vendor:'gausium', label:'Gausium', help,
              fields:[{ key, label, secret }], connected, state,
              robotCount, lastOkAt, error,
              history: { state:'running'|'done'|'failed', days, jobs,
                         robots, failed:[...], error } | null }]
}
```

Server calls (same origin, the session cookie rides along, always
`credentials:'same-origin'`). Every one replies with the new `FIRST_RUN`
object on success, or `{ error }` with status 400 on a problem:

| Call | Body | Does |
|---|---|---|
| `GET /api/v1/setup` | | Current state |
| `POST /api/v1/setup/business` | `{ business: key }` | Saves the business type |
| `POST /api/v1/setup/import?name=<file name>` | the file's raw text, `Content-Type: text/csv` | Reads a vendor export |
| `POST /api/v1/connections` | `{ vendor:'gausium', credentials:{ client_id, client_secret, open_access_key } }` | Tests the keys with the vendor, saves them sealed, starts the 90-day history pull. Replies `{ ok, robotCount, robots, sources }` |
| `POST /api/v1/setup/sites` | `{ sites:['Pier 4','Marina'], robots:{ <id>:'Marina' } }` | Names the sites, places robots |
| `POST /api/v1/setup/confirm` | `{ robots:[{ id, name, category, excluded }] }` | Saves the fleet. **Always send `name` and `category` for every robot**, even unchanged: the server reads a row with both empty as "leave it alone" and would drop its `excluded` flag |

---

## 2. Where first run starts

In `bootScreen()`, inside the existing `if (LIVE){ ... }` branch: when
`LIVE.FIRST_RUN` is present and its `step` is `business`, `import` or
`confirm`, open first run instead of the dashboard:

- `S.stage = 'app'`, `S.onboarding = true` (no rail, the centred first-run
  column the page already uses for `start` and `confirm`)
- `S.view` = `business`, `start` or `confirm` for the three steps

`step` of `setup` or `done` means the fleet exists: open the dashboard as
today.

Change `LIVE_PAGES` so `business`, `start` and `confirm` stay in the page
when `LIVE_FIRST_RUN` is true. Keep `creds` pointing at `/owner/sources`,
which is where an owner disconnects or replaces keys later.

A thin progress line runs across the top of all three screens:
`1 Your business · 2 Your data · 3 Your fleet`, the current one in `--fg1`
weight 600, done ones with the check glyph, the rest `--fg3`.

---

## 3. Your business (`business` view)

One card per entry in `LIVE.FIRST_RUN.businessTypes`, in that order: the
`label`, the `blurb`, the kinds of work (`works` joined with commas), and
the rate the page will start from, written as its derivation, for example
`$0.73 per run, from $22.00 an hour ÷ 30 runs an hour`. The one already
chosen (`business`) is selected.

Primary button: `Continue`. Disabled until a card is picked, reason
`Pick the closest match. You can change it later.` On click, POST it; on
success go to the data step.

---

## 4. Your data (`start` view)

Two ways in, side by side above 900px, stacked below: the file first, the
live connection second. That order is deliberate: a file works today, vendor
keys can take weeks.

### 4.1 Upload an export

The existing drop zone, made real:
- A real file chooser and drag and drop. Read the file as text in the
  browser and POST it with its name. Refuse anything over 25 MB before
  sending, with that sentence.
- **Loading:** the file name and "Reading rows. This takes a few seconds
  for a month of data." with the page's spinner. No percentage: the server
  does not report one.
- **Read:** from `lastImport`, `Read <imported> rows across <robots> robots
  · <rangeLabel>`, the file name, and when `skipped > 0`, one line per
  entry in `skipReasons`. Primary button `Check your fleet` goes to 5.
- **Could not read it:** the server's `error` text as the heading's
  sentence, the columns we accept (the list the demo already shows), and
  `Try another file`.
- The line under the zone uses the chosen business's `exportHint` instead of
  "A Locus Portal or Fetch Portal CSV".

### 4.2 Or connect your robots

One small panel per entry in `vendors` (Gausium today):
- The `fields`, `secret` ones as password inputs, `help` under them.
- Primary button `Test and connect`. Pending: `Checking your keys with
  Gausium…`. Failed: the server's `error` (it already reads like "Gausium
  did not accept these keys. Check each one and try again.").
- **Connected:** `Connected. <robotCount> robots found.` and the first few
  robot names. Then `Loading your last 90 days` with the spinner, and poll
  `GET /api/v1/setup` every 3 seconds. When `step` moves past `import`, go
  to 5 on its own. If `history.state` is `failed`, say so in one line and
  still go to 5: live data keeps syncing.

### 4.3 Also on this screen

- `See a sample statement first` opens `/app?demo=1` in the same tab.
- The manual-estimate path (`startManual`) is hidden in a live account.

---

## 5. Your fleet (`confirm` view)

One row per robot in `robots`:
- **Name**, editable, placeholder the current name.
- **Brand and model**, and `seen` (the dates its data covers) in `--fg3`.
- **What it does:** a select of `categories` labels, current `category`
  selected.
- **Where it works:** a select of site names. Above the table, a small
  `Sites` line with the names as removable chips and `+ Add a site`. When
  `sites` is empty, start with one site named after the business (the
  business label is fine, editable).
- **Include:** a switch, on unless `excluded`. Off reads `left out of your
  numbers`.

Primary button `This is my fleet`. On click: POST sites (every robot
placed), then POST confirm with every robot's `id`, `name`, `category` and
`excluded`. On success, `location.href = '/app'`: the server now has a
fleet and serves the full dashboard with the account's data.

Validation before sending: every robot has a site, and at least one robot
is included (`Include at least one robot, or there is nothing to measure.`).

---

## 6. What stays out in a live account

- **Invites** (`first-run-3`, "Who else needs it") and the sign-in screens:
  the server does not have team accounts yet. Hidden, not inert.
- `uploadBad`, `sampleData` as a mock import, and every other demo-only
  shortcut on these screens.

## 7. After first run

On the dashboard, once, while every robot still runs on benchmark rates: a
single slim card at the top, `Your numbers are benchmarks until you set
yours`, with a link to Numbers (the `setup` view). It goes away once any
robot has its own invoice. Numbers already saves on its own.

---

## 8. Check before you call it done

- `?demo=1`: every first-run screen and the dashboard look and behave exactly
  as before this pass. No request goes to the server.
- A live account at `step:'business'` opens on Your business with no rail.
  Continue is disabled until a pick; after it, the data step opens.
- Upload a real CSV: loading shows the file name and no percentage; read
  shows the server's counts and range; a bad file shows the server's error.
- Connect with wrong keys: the server's error, nothing else changes. With
  good keys: robots found, the 90-day line, and the fleet step opens on its
  own when the history lands.
- Your fleet: rename one robot, move one to a second site, leave one out,
  submit. The dashboard opens with the new name, both sites in the scope
  control, and the left-out robot absent from the figures.
- Reload at any point: the page opens on the step the server says.
- No demo figure anywhere in a live account's first run. No em dash. No
  text under 11.5px. 390px works on all three screens.
- `const LIVE_FIRST_RUN = true;` is in the script.
