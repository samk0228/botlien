# Botlien Demo: stop alerts in Slack (Settings > Alerts, and the stops list)

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

Run this after prompts 3, 4 and 5. The live hook (`liveData()`,
`isLiveAccount()`, `LIVE_PREVIEW`, `previewLive()`) and
`isRobotCostAccount()` are already in the page. Use them. Do not add them
again.

**The demo does not change.** With `?demo=1`, every screen, mock and number
stays exactly as it is today. Everything below appears only in a live
account, and in the new preview in section 1.

## Why

When a robot stops, the person who can fix it should know inside a minute,
in the place they already look. The server now does that: for every stop it
posts one message to the customer's Slack channel with the cause, how long
the robot has been down, and what that is in robot time, edits that same
message as the stop goes on, pings the lead in the thread after ten
unclaimed minutes and the manager ten after that, and turns the message
green when the robot is back. Two buttons on the message, `I've got it` and
`Escalate`, come back to the server.

What is missing is the screen where an owner connects the channel and says
who the lead and the manager are, and a place on the dashboard to see the
stops the way Slack saw them. This pass adds both.

---

## 0. Rules

- **Only real numbers in a live account.** Never a demo figure. Where the
  server has not said, write "not reported" or say nothing.
- **The bot token is a secret.** A password field, sent once, never shown
  again, never kept in `S` after the reply, never in the URL.
- **Say what the server does, not more.** Alerts go out for stops only. No
  warnings, no texts, no daily summary in Slack yet. Do not mock them.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`,
  figures in `--fg1`, the accent in its five places, no text under 11.5px,
  no em dashes anywhere, 390px works.
- **Every button states what happens,** using `BUTTON_STATES`. No button
  that does nothing.
- Plain words, one idea per sentence, short.

---

## 1. The data, and the preview

`GET /api/v1/slack`, fetched when the Alerts page opens in a live account
and kept in `S.slack`:

```js
{
  slack: null | {
    channel: 'botlien-alerts-test',   // no leading #
    lead: 'U0LEAD01', manager: 'U0BOSS01',   // Slack member IDs, or null
    team: 'Line Lab', botUserId: 'UBOT', connectedAt: 1791000000000
  },
  incidents: [ {                      // the last 30 days, newest first
    id: 7, robotId: 2,                // ROBOTS row with this id
    kind: 'stop' | 'e-stop' | 'fault' | 'offline',
    code: 'UR-SAFETY-3', description: 'protective stop',   // either may be null
    startedAt: 1791000000000, lastSeenAt: 1791000700000,
    endedAt: null | 1791001560000,    // null while the robot is still down
    repeats: 1,                       // 3 = it came back and stopped again twice, within ten minutes each time
    status: 'open' | 'closed',
    claimedBy: null | '<@U0DANA>',    // a Slack mention, as the button press gave it
    claimedAt: null | 1791000720000,
    escalated: 0 | 1 | 2,             // 1 the lead was told, 2 the manager too
    escalatedAt: null | 1791000600000,
    notifiedAt: null | 1791000030000  // when the Slack message went out
  } ]
}
```

`POST /api/v1/slack` with `{ botToken, channel, lead, manager }` replies
`{ ok, slack }` or 400 `{ error }` in the owner's words (the server checks
the token with Slack before saving anything). `DELETE /api/v1/slack`
replies `{ ok, had, slack: null, incidents }`.

**Preview.** Add `?livepreview=slack`: the `mfg` preview plus a `SLACK`
fixture, connected to `Line Lab`, channel `botlien-alerts-test`, lead
`U0LEAD01`, no manager, and four stops on the preview's arms: one open and
unclaimed for 7 minutes (a protective stop, `UR-SAFETY-3`, escalated 0),
one open and claimed by `<@U0DANA>` 20 minutes ago (an emergency stop,
escalated 1), one closed after 12 minutes with `repeats: 3`, and one closed
`offline` for 41 minutes, unclaimed, escalated 2. Dates are today in the
account's time zone.

---

## 2. Settings > Alerts: where stop alerts go

A new block at the top of the Alerts page in a live account, above the
rules table: **Stop alerts in Slack**.

**Not connected.** One sentence: `When a robot stops, Botlien posts one
message to a Slack channel, keeps it up to date, and pings your lead if
nobody claims it in 10 minutes.` Then four fields:

- **Bot token:** a password input, placeholder `xoxb-…`
- **Channel:** text, placeholder `botlien-alerts`
- **Lead:** text, placeholder `Slack member ID, like U0…`, under it `Who is
  pinged after 10 unclaimed minutes.`
- **Manager:** same, `…and 10 minutes after that.` Both optional.

Under the fields, a fold `How to make the Slack app (5 minutes)` with four
steps: `1. api.slack.com/apps, Create New App, From scratch, name it
Botlien.` `2. OAuth & Permissions: add the bot scopes chat:write and
chat:write.public, then Install to Workspace and copy the Bot User OAuth
Token.` `3. Interactivity & Shortcuts: switch it on and set the Request URL
to https://app.botlien.com/api/slack/interactions.` `4. Member IDs: open a
person's profile in Slack, the three dots, Copy member ID.`

Primary `Test and connect` calls `POST /api/v1/slack`. Pending: `Checking
the token with Slack…`. A 400 shows the server's `error` under the fields
and keeps what was typed. Success: `Connected to Line Lab. Stop alerts go
to #botlien-alerts-test.`, the token field is cleared and forgotten, and the
block switches to connected.

**Connected.** `Line Lab · #botlien-alerts-test` with a pill `connected`
tone `good`, then `Lead U0LEAD01 · Manager not set` (Slack shows their
names; here we only have the IDs), then `since 30 Sep` from `connectedAt`.
One quiet line: `Changing the channel or who is pinged needs the bot token
again.` and a secondary `Change` that reopens the form with channel, lead
and manager filled and the token empty. Secondary `Disconnect` asks once
(`Stops already posted stay in Slack. Botlien forgets the token.`) then
calls `DELETE /api/v1/slack` and shows the not-connected form.

The rules table gains one row in a live account, first: `A robot stops` ·
`Slack, as it happens` · last sent from the newest incident's `notifiedAt`
(`2:14 pm today`) or `never`. When Slack is not connected the row reads
`connect Slack above`.

---

## 3. The stops, as Slack saw them

Under the Slack block, **Stops in the last 30 days**, one row per incident,
newest first, the same on the Alerts page and, filtered to one robot, in
that robot's drawer under a new `Stops` heading.

| Column | From |
|---|---|
| When | `startedAt` in the account's time zone: `2:14 pm today`, `Yesterday 9:02 am`, else `26 Sep 3:40 pm` |
| Robot | the `ROBOTS` name for `robotId`; the row opens that robot's drawer |
| What | the kind in words (section 4), then `description` if there is one, else `code` |
| Down | `endedAt - startedAt` as `12 min`; while open, `7 min so far` from now |
| Who | `claimedBy` as given (`<@U0DANA>` renders as `@U0DANA`), or `nobody` |
| Status | pill: `down` tone `bad` while open, `back` tone `good` when closed |

Two more pills on a row when they apply: `x3` tone `warn` when `repeats`
is above 1 (title `Came back and stopped again 2 times, within 10 minutes
each`), and `lead told` or `manager told` tone `warn` from `escalated`.

Empty: `No stops since Slack was connected.` Not connected: the table is
not shown at all.

On the dashboard's Needs attention list, an open incident goes first:
`Cell 2 UR10e has been down 7 min and nobody has claimed it` (or `…, <who>
has it`), linking to the Alerts page. When there is none, nothing changes.

---

## 4. Words

A stop's kind in words, everywhere on the page:

- `stop` → `protective stop` when the robot is an arm (it has a `COST`
  entry or its model starts with `UR`), else `stuck`
- `e-stop` → `emergency stop`
- `fault` → `fault`
- `offline` → `went offline`

Never say what a stop cost on these screens. The Slack message says it in
robot time because the person reading it is deciding whether to walk over;
the dashboard's idle cost a year is the number the owner needs, and it is
already there.

---

## 5. Not in this pass

- Text messages and who gets which problem per person (onboarding step 6).
- Quiet hours and who is on call at night.
- The daily summary in Slack (the morning brief email covers it).
- Joint drift and temperature warnings.

Leave room for them. Do not mock them.

---

## 6. Check before you call it done

- `?demo=1`: nothing changed. No request goes to a server.
- `?livepreview=1` and `?livepreview=mfg`: unchanged, and the Alerts page
  shows the not-connected Slack form.
- `?livepreview=slack`: the Alerts page shows `Line Lab ·
  #botlien-alerts-test`, `Lead U0LEAD01 · Manager not set`, the rules row
  `A robot stops` with a time, and four stop rows: the first `7 min so far`
  with `down`, the second with `@U0DANA` and `lead told`, the third with
  `x3` and `back`, the fourth `went offline` with `manager told`. Loader
  2's drawer lists only its own stops. Needs attention leads with the open
  unclaimed stop.
- Typing a token, submitting, and getting the preview's failed reply keeps
  the channel and IDs typed and clears nothing else; after a success the
  token is nowhere in `S`.
- No em dash. No text under 11.5px. 390px works on every changed screen.
