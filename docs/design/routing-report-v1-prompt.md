# Botlien Demo: who hears what, when to interrupt, and the week-one report

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

Run this after prompts 3 to 7. The live hook (`liveData()`,
`isLiveAccount()`, `LIVE_PREVIEW`, `previewLive()`), `isRobotCostAccount()`,
the Slack block on the Alerts page (prompt 6) and the Line editor and
"What limits the line" panel (prompt 7) are already in the page. Use them.
Do not add them again.

**The demo does not change.** With `?demo=1`, every screen, mock and number
stays exactly as it is today. Everything below appears only in a live
account, and in the new preview in section 1.

## Why

Antonio built a second set of screens for the coworker: an Integrations
page with message tiers and workflows, a "when to interrupt" setting, quiet
hours, per-person routing, a learning period with "that's normal", and the
week-one report. Several of them are things the overnight benchmark asked
for (message tiers with a customer-set interrupt level, the line map, the
week-one report) and the onboarding spec names (steps 5 to 8). This pass
brings those into the Demo we have, on top of everything already built,
and leaves out what we have covered another way or cannot make real yet.

Three rules from his screens carry over whole: the coworker proposes and
the owner confirms; nothing is sent from a screen that only looks like it
sends; every number says where it came from.

---

## 0. Rules

- **Only real numbers in a live account.** Never a demo figure. Where the
  server has not said, write "not reported" or say nothing.
- **No channel that cannot deliver.** Text is waiting on carrier approval
  and Teams is not available. They appear, say so, and cannot be chosen
  for a workflow. Slack and email can.
- **A rule that is saved is a rule the server follows.** The server reads
  `routing` (section 1). Do not invent a rule the shape below cannot hold.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`,
  figures in `--fg1`, the accent in its five places, no text under 11.5px,
  no em dashes anywhere, 390px works.
- **Every button states what happens,** using `BUTTON_STATES`. No button
  that does nothing.
- Plain words, one idea per sentence, short.

---

## 1. The data, and the preview

**The routing rules** are one account input, `routing`, saved with every
other input (add `routing: null` to `S`; the page already saves inputs; do
not add a save call). The server checks the shape and follows it:

```js
S.routing = {
  interrupt: { minutes: 3 },             // a stop or jam shorter than this goes to the digest, not to anyone right away. 1 to 60.
  dollars: { show: false, valuePerUnitCents: null },   // off by default; needs what one part is worth, which only the owner knows
  quietHours: { from: '22:00', to: '05:30', onCall: 'U0LEAD01', onCallInterrupts: true } | null,
  workflows: [ {
    id: 'w1', name: 'Big stops to Slack',
    tier: 'interrupt_now' | 'hourly_digest' | 'shift_summary',
    channel: 'slack' | 'email',
    people: [ 'U0LEAD01', 'dana@linelab.io' ],   // Slack member IDs for slack, addresses for email
    active: true,
    created: '2026-10-01T15:00:00Z', by: 'owner'
  } ],
  history: [ { at, summary, before: {...}, by } ]  // the last 20 changes, newest first, for Rules in effect and Undo
}
```

`liveData().ROUTING` is the saved object or `null`. When it is null the
page starts from one workflow built from the Slack settings already saved
(prompt 6): `interrupt_now` to Slack for the lead and the manager, three
minutes, no quiet hours.

**People** carry a role and how to reach them. The People settings page
already lists people; add to each `role` (`Owner`, `Operations manager`,
`Maintenance lead`, `Shift supervisor`), `slackId` and `email`. Saved as the
account input `people` the page already keeps. A workflow's `people` list is
chosen from these; a person with no Slack ID cannot be put on a Slack
workflow (say why).

**Integrations** read the server's existing data: Slack from `GET
/api/v1/slack` (prompt 6), email from the account's address, and two that
are not live. Activity is what the server actually sent: the `incidents`
from `/api/v1/slack` (each with `notifiedAt`, `escalated`) and
`LINE_EVENTS` jams with `notifiedAt`.

**The learning period** reads `NOW[i].baselineDays` and `baselineReady`
(prompt 4). **"That's normal"** is one more account input, `normal`:
`[ { label: 'Planned changeover', days: ['fri'], from: '15:00', to: '16:00' } ]`.
The server leaves stops and jams inside those windows out of alerts and
the line summary.

**Preview.** Add `?livepreview=rules`: the `line` preview plus a saved
`routing` with the four workflows from Antonio's screens (big stops to
Slack for the operations manager and maintenance lead at 3 minutes; hourly
digest to email for the operations manager; shift summary to email for the
operations manager; a paused maintenance digest), quiet hours 10 PM to
5:30 AM with the maintenance lead on call, three people with roles, nine
activity rows across today and yesterday (one failed, one held by quiet
hours), one planned changeover, and `baselineDays: 5`.

---

## 2. Integrations (the Alerts page grows into it)

Rename the Alerts page **Integrations**. The Slack block from prompt 6 stays
as the first app. Three tabs: **Apps**, **Workflows**, **Activity**.

**Apps.** One card each:
- **Slack**: the prompt 6 block, unchanged.
- **Email**: `Sends to the addresses on People.` Always connected; nothing
  to set up. Under it, the morning brief's delivery line from prompt 4.
- **Text**: pill `waiting on carrier approval` tone `warn`, one line
  `Carrier registration takes 1 to 3 weeks. Big stops reach people on Slack
  the moment they happen until then.` No button.
- **Teams**: pill `not available yet`, a secondary `Ask for Teams` that
  opens a prefilled email to info@botlien.com. That is the only thing it
  does, and it says so.

Each connected app also shows `Pause` (asks once: `Nothing is sent through
Slack until you resume. Stops are still recorded.`) which sets every
workflow on that channel inactive, and `Resume`.

**Workflows.** The three tiers as three groups, each with its sentence from
Antonio's screens:
- **Interrupt now**: `Long stops, anything still stuck, wear warnings.
  Straight to the channel.`
- **Hourly digest**: `Short stops that cleared on their own. One message
  an hour, only if something happened.`
- **Shift summary**: `Output against normal, idle robots, slowdowns. At the
  end of each shift.`

A workflow row: name, channel chip, the people, `when` in words (`Stops
over 3 minutes`, `Short stops that cleared on their own`, `End of each
shift`), a switch for `active`, `Remove` (asks once: `The workflow is
removed. Past messages stay in Activity.`). `+ Add a workflow` opens an
inline form: tier, channel (Slack or email only), people (from People,
filtered to those reachable on that channel), name. Every change writes a
`history` entry and re-saves `routing`.

**Activity.** Newest first: when, tier, channel, person, workflow name,
and a status pill: `sent` tone `good`, `failed` tone `bad`, `held by quiet
hours` neutral. Built from the server's incidents and jams (section 1),
one row per person told. Empty: `Nothing sent yet.`

---

## 3. When to interrupt, and Rules in effect

Above the Workflows tab, one block, **When to interrupt**:

- `Interrupt me for line disruptions longer than` a number field, minutes,
  default 3. Under it, from the open period's `LINE_EVENTS` and
  `DOWNTIME`: `This period, N of M stops and jams would have interrupted
  someone. The rest would go to the hourly digest.`
- A switch `Also show dollars`, off by default, with `It needs the value of
  one part, which only you know.` On, a field `Value of one <unitLabel>`.
  Off, messages lead with the cause and the output lost; dollars stay out
  of the first line.
- **Quiet hours**: from and to, `On call` (a person from People), and a
  switch `On call still gets interrupts`. One line: `Quiet hours hold
  digests and summaries at night. On call still gets interrupts.`

**Rules in effect**, on the dashboard as a block (in `dashLayout`, after
the brief) and at the top of Integrations: the six lines Antonio's screens
show, each as `label: sentence`: Interrupt now, Hourly digest, Shift
summary (who, how, when), When to interrupt, Quiet hours, Dashboard (the
lead tile and hidden blocks). Under it `Change history` as a fold: the
last changes with `Undo` on the newest (puts `before` back and saves).

---

## 4. Who hears what (People)

On Settings > People, each person gains `Role`, `Slack member ID` and
`Email`, and a read-only line **Hears about**: the tiers their workflows put
them on (`Big stops right away on Slack · Hourly digest by email`), or
`nothing yet` with a link to Workflows. The prompt 6 lead and manager
fields on the Slack block become read-only and say `Set on People and
Workflows`: the lead is the first interrupt-now person with a Slack ID,
the manager the second. The server keeps escalating to them.

---

## 5. Learning your normal, and "that's normal"

**On the dashboard**, while any robot has `baselineReady` false, one slim
card under the brief: `Learning your normal: day 5 of 14. Botlien watches
quietly and only speaks up when something is not normal.` with a thin
progress line, and under it what is being measured: `Each robot's working
share and pace · Each robot's normal motor load, to spot wear later · Where
the line is held up`. Gone once every robot is ready.

**That's normal.** On the Incidents page and on each stop row in the
prompt 7 table, a small link `That's normal` opens an inline form: label,
days of the week, from and to. Saving adds to the `normal` input and says
`Planned changeover, Fridays 3 pm to 4 pm. Botlien will not flag this
again.` The Line settings page lists them under **What is normal** with
`Remove`. Stops and jams inside a window show a quiet pill `planned` in
the tables and are left out of "What limits the line".

---

## 6. The week-one report

A new page, **Report**, in the rail under Incidents, and a card on the
dashboard the day it first exists. Before day 7 it reads `Your first report
arrives after seven days of data. Day 5 of 7.` From day 7, one page in four
parts, every figure from the tables the page already has:

1. **Where the line is held up**: `LINE_SUMMARY` for each line: what
   limited it, `a machine, not a robot` or `a robot`, the robot-minutes idle
   because of machines against because of robots, the sentence `Non-robot
   machines caused 62% of your robots' waiting.` Then each arm's working
   share from `COST[i].workingPct`, lowest first.
2. **The top three things costing money**: the three largest of: each
   arm's `idleCostYearCents`, each jam's `costCents` summed by machine, each
   stop's cost summed by robot. Each with its source (`estimated` pill while
   the arm is estimated). Under it: `Idle cost is the most you could win
   back, not a promise. Some waiting is built into the line.`
3. **Anything unusual**: a robot whose working share this week is more
   than 10 points under its baseline (from `ROBOT_DELTA`), a robot stopped
   more than three times, a jam longer than 10 minutes. None: `Nothing
   unusual this week.` Wear and twins are not measured yet: say `Wear
   comparison starts once twins are marked on the Line page and two weeks
   of data exist.` only when a twin is marked.
4. **What happens next**: `Day 30: we check progress against the goal you
   set, tune the interrupt level, and replace estimated numbers with real
   ones.` with a link to Setup for the cost inputs.

`Print` uses the page's existing print styles.

---

## 7. Consent, and the IT one-pager

- **First run**, between Your business and Your data: a step **What Botlien
  reads, and what it never does**, Antonio's wording: `Botlien reads
  whether each robot is running, stopped or waiting, how it moves, its
  motor load, and its stop events. It keeps these in your Botlien account.
  It never controls a robot: it cannot start, stop, move or change
  anything.` A checkbox `I understand that Botlien only reads from my
  robots and never controls them.` gates Continue. Saved as the account
  input `consent: { at }`. A live account that has no `consent` sees this
  step once on its next visit.
- **Settings > Data sources** gains a fold **For your IT team**, the facts
  from the gateway: read only; RTDE outputs on port 30004 only; refuses
  29999 and 30001 to 30003; outbound HTTPS to app.botlien.com only; opens
  no port; holds events while the uplink is down. A `Copy` button.

---

## 8. Words carried over from Antonio's screens

Put these where the figure they explain is, as the quiet `--fg3` line:

- On the Working tile: `An arm counts as working when its program is
  running and the arm is actually moving. Waiting for a machine, a part or
  a person is not working time, even though the program is still running.`
- On Setup, under the cost inputs: `Hours a year are assumed until you say
  otherwise.` and `Prices and wear are assumed from list prices.`
- On Incidents: `Stops come from the robot, causes come from your line
  map. The likely cause is a suggestion, not a diagnosis.` and each stop
  row gains `Likely cause` from `LINE_EVENTS`: the jam on the same line
  that overlaps it, or `the robot itself`.

---

## 9. Not in this pass

- The chat onboarding (Antonio's `onboarding_chat.html`): a separate
  prompt, since it replaces first run and needs the server to read free
  text.
- Ask Botlien in the dashboard: needs the server to answer; nothing on
  screen pretends to.
- The invoice reader, Teams, sending texts, the simulator feed
  (`OURS_REPLAY`) and its endpoints: the gateway and push path cover the
  feed.

Leave room for them. Do not mock them.

---

## 10. Check before you call it done

- `?demo=1`: nothing changed. No request goes to a server.
- `?livepreview=line` and earlier previews: unchanged, with the Alerts page
  now called Integrations and one workflow built from the Slack settings.
- `?livepreview=rules`: Integrations shows four apps with Text and Teams
  unavailable, four workflows (one paused), nine activity rows with one
  `failed` and one `held by quiet hours`; When to interrupt reads 3 minutes
  and `N of M stops and jams would have interrupted someone`; Rules in
  effect lists six lines; People shows three roles with Hears about; the
  dashboard shows Learning your normal day 5 of 14 and the Report page says
  day 5 of 7; the Line page lists one planned changeover.
- Adding a workflow, changing the interrupt minutes and undoing the last
  change each re-save `routing` (one `{ account: { routing } }` input) and
  add a history entry; the preview's failed reply keeps every edit.
- A person with no Slack ID cannot be added to a Slack workflow, with the
  reason shown.
- No channel that cannot deliver can be chosen. No em dash. No text under
  11.5px. 390px works on every changed screen.
