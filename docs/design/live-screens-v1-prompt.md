# Botlien Demo: the screens a real account needs (data sources, locked periods, measured payback, named spots)

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

Run this after the first-run prompt (`DESIGN_PROMPT_first_run_live_v1.md`).
If that one has already added the live hook below, skip section 0.

**The demo does not change.** Everything below appears only in a real
account (and in the preview described in 0). With `?demo=1`, every screen,
mock and number stays exactly as it is today.

## Why

The server behind the Demo now does five things the page cannot show yet:
it connects vendors and takes pushed data with API keys, it imports exports
whose columns it does not recognise, it locks each billing period when it
ends (with the credit owed), it measures payback from real months instead of
estimating it, and it lets an owner name a stall spot. This pass gives each
of those a designed screen.

---

## 0. Before you start: the live hook

This project's copy of the Demo does not contain the live wiring. The server
adds it when it serves the page to a real account. You will not see that
code here, and you do not need it. Add only this, once, near the top of the
script beside `ICONS` and `LOGO`:

```js
const LIVE = null; // set by the server for a real account; leave as null here
// Preview only: ?livepreview=1 shows the live screens with a sample account
// built from the demo's own tables; ?livepreview=business, =import or
// =confirm opens that sample account at that first-run step. A real account
// never takes this path.
const LIVE_PREVIEW = (location.search.match(/[?&]livepreview=([a-z0-9]+)/) || [])[1] || null;
let previewLiveCache = null;
function liveData(){ return LIVE || (LIVE_PREVIEW ? (previewLiveCache || (previewLiveCache = previewLive())) : null); }
function isLiveAccount(){ return !!liveData() && !S.demoMode; }
```

Every live screen reads `liveData()`, never `LIVE` directly, and shows only
when `isLiveAccount()` is true. Wherever a prompt says `LIVE.X`, read it as
`liveData().X`.

`previewLive()` returns an object with the live fields the prompt lists,
filled from the demo's own tables and calculations (for first run: the
demo's business types and robots, with `FIRST_RUN.step` set from
`LIVE_PREVIEW` when it is `business`, `import` or `confirm`, else `done`).
The values do not need to be exact. They only let you see the screens. Show
nothing on screen that says "preview"; the parameter is the only switch.
Server calls fail in the preview (there is no server here), which is the
right way to see each screen's failed state.

---

## 0.1 Rules

- **Only real numbers in a live account.** Never a demo figure. Where the
  server has not said, write "not reported" or say nothing.
- **Every button states what happens,** using the page's `BUTTON_STATES`
  pattern: disabled with the reason, pending while the request runs, failed
  with the server's own `error` text and a way to try again.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`
  with its glyph, figures in `--fg1`, the accent in its five places, no text
  under 11.5px, no em dashes anywhere, 390px works.
- **No button that does nothing.** Hidden, not inert.
- Plain words, one idea per sentence, short.
- Server calls: same origin, `credentials:'same-origin'`, JSON unless said
  otherwise. A problem comes back as `{ error }` with status 400 (401 for a
  bad key, 404 for something already gone).

---

## 1. What the page already has in a live account

`liveData()` carries these, with the demo's table names, plus:

```js
PERIODS[i] = { label, status:'open'|'closed', closed:'Closed Sep 6'|'Closing'|'',
               locked: true|false, siteCov:[...], siteUtil:[...] }
// locked: the server froze this period's figures. 'Closing' = ended, not
// frozen yet (a day's grace for late data). The open period is never locked.

PERIOD_FIGURES[i] = {                 // same order as PERIODS
  frozen, closedAt,                    // closedAt: ms, or null
  totals: { robots, units, workCents, invoiceCents, coverage,
            downtimeMinutes, incidents, creditCents|null },
  robots: { <row index>: { name, site, work, units, workCents, invoiceCents,
            coverage, activeHours, dutyPct, incidents, downtimeMinutes,
            scheduledMinutes, deliveredUptimePct, promisedUptimePct,
            creditCents|null } }
}
// creditCents is null (not 0) when the lease states no uptime promise.

DOWNTIME[i][j].spot                    // '14,6': the 2 m grid key of a stop
DOWNTIME_PAST[i] = [{ period:'2026-07-04', date, start, minutes, cause, spot }]
// stops in the closed periods shown, each with its period's start date

PAYBACK[i] = {                         // null for a robot with no figures
  status: 'paid'|'on track'|'behind'|'missed'|'partly measured'|'no lease'|'no price',
  price, priceSource:'owner'|'benchmark',
  earned,                              // dollars earned in measured months
  monthsSinceStart, monthsUnmeasured,  // months before the data began
  paceMonths, promisedMonths,
  months: [{ start, end, work, frozen }]   // oldest first, dollars
}

SOURCES   // the dashboard's existing sources line, now including pushed data
```

Add `placeNames: {}` to `S`: `{ <site slug>: { '<spot>': 'aisle 14' } }`.
The server's copy of the page saves it on its own, like every other input.

---

## 2. Data sources (Settings > Data sources, and the `creds` view)

One screen for every way data reaches the account. In a live account it
replaces the link to the server page. Three blocks, in this order.

### 2.1 Connected vendors

`GET /api/v1/connections` returns a list, one entry per vendor Botlien can
connect: `{ vendor, label, help, fields:[{ key, label, secret }], connected,
state:'ok'|'degraded'|'down'|null, robotCount, lastOkAt, error,
history:{ state, days, jobs, robots, failed, error }|null }`.

- **Connected:** the label, a pill for the state (`syncing` tone `good`,
  `syncing with problems` tone `warn`, `not syncing` tone `bad`), `N robots`, `last
  good sync 4 min ago`, the history line (`90 days loaded: 212 jobs across
  6 robots`, or `Loading your last 90 days`), and the server's `error` when
  there is one. Secondary button `Disconnect`, which asks once (`Data
  already synced stays on your dashboard.`) then calls
  `DELETE /api/v1/connections/<vendor>`.
- **Not connected:** the `fields` (secret ones as password inputs), `help`
  under them, primary `Test and connect` calling `POST /api/v1/connections`
  with `{ vendor, credentials:{ <field key>: value } }`. Pending: `Checking
  your keys with Gausium…`. Success replies `{ ok, robotCount, robots,
  sources }`: say `Connected. N robots found.` and refresh the list.

### 2.2 Push from your own system

For fleet software, an integrator, or a make Botlien cannot connect yet.

- `GET /api/v1/keys` returns `{ keys:[{ id, prefix, label, createdAt,
  lastUsedAt }] }`. One row per key: `blk_7Hq2…` in a mono chip, the label,
  `made 3 days ago · last used 2 min ago`, secondary `Revoke` (asks once,
  then `DELETE /api/v1/keys/<id>`).
- Primary `Make an API key` with an optional `What it is for` field. It
  calls `POST /api/v1/keys` with `{ label }` and gets `{ id, key, prefix }`.
- **The full key is shown once.** A panel with the key in a mono field, a
  `Copy` button, and one sentence: `Copy it now. For safety we only keep a
  fingerprint, so it cannot be shown again.` Closing the panel forgets the
  key from `S`. Never put it in the URL.
- A short how-to beside the list, as a copyable block:
  ```
  POST https://app.botlien.com/api/v1/events
  Authorization: Bearer blk_...
  { "events": [ { "robot_id": "AMR-7", "at": "2026-09-23T14:05:00Z",
                  "mission_state": "active", "battery_pct": 81 } ] }
  ```
  and one line: `Only robot_id and at are required. Up to 1,000 events a
  request.`
- An account holds at most five keys. At five, the button is disabled with
  that reason.

### 2.3 Upload an export, any make

The import drop zone, with one new state. `POST /api/v1/setup/import?name=
<file>` with the file's text. When the file has no rows the server can read,
the 400 reply carries `headers`: the file's own column names.

- **Could not read it:** the server's `error`, then `Tell us which columns
  these are` with two selects filled from `headers`: `Robot id` and `Time`
  (both required), and under `More columns (optional)` selects for
  `Status`, `Mission id`, `Battery`, `Brand`, `Model`, `Kind of work`, `X`,
  `Y`. Primary `Import with these columns` re-sends the same file with
  `&columns=` + `encodeURIComponent(JSON.stringify({ robot_id:'serial no',
  at:'logged', ... }))`. The field names are `robot_id, at,
  connection_state, mission_state, mission_id, battery_pct, brand, model,
  category, x, y`.
- Keep the file in memory between the two tries so the owner does not pick
  it again.

---

## 3. Locked periods (the Period page and the period picker)

In a live account a period is only locked once the server froze it.
First, the period picker's sentence for a closed period: when
`PERIODS[p].locked === false` (live only), write `Closing. This period has
ended; its numbers lock once a day has passed and the next period's data
has arrived.` instead of `Numbers are locked…`. Then give the Period page
(Level 3 `period`) the same honesty and the figures behind it:

- **A locked badge** in the page header for a locked period: `pill('Locked
  Sep 6','lock','good')`. For `Closing`: `pill('Closing','calendar','warn')`
  and one line, `Locks once a day has passed and the next period's data has
  arrived.` The open period: `pill('Still moving','trending-up')`.
- **A `Credit and uptime` inner tab** from `PERIOD_FIGURES[p]`: one row per
  robot with delivered against promised uptime (`97.8% of 99.5%`), downtime
  (`fmtDownFor`), stops, and the credit. A robot whose lease states no
  promise reads `no promise stated` in `--fg3`, never `$0.00`. Totals row
  on top. When `totals.creditCents` is null, the headline says `No lease on
  this account states an uptime promise.`
- **A `Stops` inner tab** for a closed period, from `DOWNTIME_PAST`
  filtered by the period's start date, in the page's incident table shape
  (date, time, robot, cause, minutes). Each row opens the incident drawer
  as the open period's rows do.
- **Contract page:** a `Credit by period` strip under the current period's
  figures: one bar per locked period from `PERIOD_FIGURES[p].totals.creditCents`,
  the locked date under each, null periods drawn as a hollow outline with
  `no promise`.

---

## 4. Payback on measured months (the Payback page, live only)

In a live account, draw the Payback page from `PAYBACK` instead of
`computePayback()`'s estimate. The demo keeps its estimate.

- **The chart per robot:** one bar per measured month from `months`
  (solid, frozen months at full strength, the open month lighter), the
  cumulative line over them, and the price as a horizontal line labelled
  `$32,000 · your price` or `· benchmark price`. When
  `monthsUnmeasured > 0`, a hatched band at the left (`HATCH_EST`) labelled
  `14 months before your data began, not measured`. Never bars in that band.
- **Status chip** per robot, with these tones: `paid` and `on track`
  `good`, `behind` `warn`, `missed` `bad`, `partly measured` neutral with
  the glyph `help-circle`, `no lease` and `no price` neutral. Under the chip, one line:
  - paid: `Paid back its $32,000 price.`
  - on track / behind: `At this pace it pays back in month 19. The lease
    promised month 14.`
  - missed: `Passed its 14-month promise. $12,400 earned of $32,000.`
  - partly measured: `$6,100 earned in the 3 months we can see. The 14
    before your data began are not measured, so no verdict yet.`
  - no lease: `Enter the lease start on Numbers to measure payback.` with a
    link to Numbers.
- **Fleet summary** at the top: counts per status in the same chips, and
  `Measured on N months of your data.`
- The Alerts page already lists "A promise is missed". It now sends, once
  per robot, only on `missed`.

---

## 5. Name a stall spot

Stops carry `spot`, the 2 m grid key the page labels `near 14, 6 m`.

- In the **spot record** (Level 4 `spot` drawer) and on each **Fix list**
  row whose place still reads `near …`: a small `Name this spot` link that
  opens an inline field (`aisle 14`, `dock 2`) with `Save`.
- Saving sets `S.placeNames[siteSlug(site)][spot] = name`. It saves on its
  own. Until the next reload, show the name at once by reading
  `S.placeNames` wherever a stop's place is shown (`cause` reads
  `stuck · near 14, 6 m`; show `stuck · aisle 14`). After a reload the
  server sends the name already applied.
- A fix saved under the old label moves with the rename: when saving, if
  `S.fixes[fixKey(site, oldPlace)]` exists, move it to
  `fixKey(site, newName)`.
- A named spot shows `Rename` instead, and an empty save clears the name
  (back to `near …`).

---

## 6. Morning brief delivery, live

The Delivery form saves on its own and the server sends the brief by email.
The server's copy of the page already changes the save message for a live
account, so leave `briefSave` as it is. In a live account:

- Each recipient field accepts an email. A phone number shows, under the
  field, `Text messages are not sent yet. Add an email to get the brief.`
- A status line above the form once saved: `Emails 2 people at 5:30 AM on
  weekdays.` When no email is set: `Not sending: add an email address.`
- The SMS preview stays, retitled `Preview`.

---

## 7. Check before you call it done

- `?demo=1`: every screen looks and behaves exactly as before. No request
  goes to a server.
- `?livepreview=1`: Data sources shows the three blocks; making a key fails
  with the server error state (no server here); the Period page shows the
  badge and both new tabs for a closed period; Payback draws measured bars
  with the unmeasured band; naming a spot changes its label at once.
- In a live account, the full API key appears once and nowhere after
  closing the panel, not in the URL, not in `S`.
- A robot with no stated promise never shows `$0.00` credit.
- No demo figure anywhere in a live account. No em dash. No text under
  11.5px. 390px works on every new screen.
