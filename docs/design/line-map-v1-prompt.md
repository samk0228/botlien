# Botlien Demo: map your line (Settings > Line, and what limits the line)

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

Run this after prompts 3 to 6. The live hook (`liveData()`,
`isLiveAccount()`, `LIVE_PREVIEW`, `previewLive()`) and
`isRobotCostAccount()` are already in the page. Use them. Do not add them
again.

**The demo does not change.** With `?demo=1`, every screen, mock and number
stays exactly as it is today. Everything below appears only in a live
account, and in the new preview in section 1.

## Why

The overnight benchmark's biggest finding: non-robot machines caused 13%
to 47% of lost output while every robot looked normal. A robot dashboard
shows green through all of it. Botlien can name the machine, but only if
it knows the order of the line: which robot feeds which machine, and
which robot that machine feeds. When the robot on each side of a machine
is waiting and no robot has stopped, the machine between them is what is
holding the line.

The server now does this once a line map is saved: it records each jam
and each stop's impact (the other robots it left waiting), prices the
waiting at each robot's own hourly cost, and posts a jam to Slack. What
is missing is the screen where the owner draws the line (onboarding step
4, "Map your line") and the place on the dashboard that says what limited
the line this period. This pass adds both.

---

## 0. Rules

- **Only real numbers in a live account.** Never a demo figure. Where the
  server has not said, write "not reported" or say nothing.
- **A drafted line is a question, not a fact.** Until the owner confirms
  it, every screen that reads the map says so and asks.
- **Idle cost is what waiting cost, not what Botlien saved.** Never "we
  saved you". Dollars carry `estimated` until the owner's own prices are in.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`,
  figures in `--fg1`, the accent in its five places, no text under 11.5px,
  no em dashes anywhere, 390px works.
- **Every button states what happens,** using `BUTTON_STATES`. No button
  that does nothing.
- Plain words, one idea per sentence, short.

---

## 1. The data, and the preview

`liveData()` carries three more tables:

```js
LINE_MAP = {
  drafted: true | false,            // true until the owner saved one
  lines: [ { name: 'CNC cell 1', stations: [
    { kind: 'robot', robotId: 3, name: 'Loader 1', model: 'UR10e', twin: 'loaders' | undefined },
    { kind: 'machine', name: 'Mill A' },
    { kind: 'buffer', name: 'conveyor', holds: 10 | undefined },
    ...
  ] } ]
}
// robotId is the server's id: ROBOT_IDS[i] for row i.

LINE_EVENTS = [ {                   // the open period, newest first
  id, line: 'CNC cell 1',
  kind: 'jam' | 'stop',             // jam: a machine held the line; stop: a robot stopped
  station: 'Mill A' | 'Loader 1',   // the machine, or the robot that stopped
  robotId: null | 3,
  confidence: 'both sides' | 'one side' | null,
  startedAt, endedAt: null | ms, open: true | false,
  minutes: 6,
  idle: [ { robotId, name: 'Deburr', minutes: 4 } ],   // who waited, and how long
  idleMinutes: 12,                  // robot-minutes idle, all of them
  costCents: 81, priced: true       // false when a robot waiting has no cost block
} ]

LINE_SUMMARY = [ {                  // one per line, the open period
  name, robots, machines, jams, stops,
  idleMinutesByMachines, idleMinutesByRobots,
  costCentsByMachines, costCentsByRobots,
  shareByMachines: 0.62 | null,     // of idle robot-minutes; null when nothing happened
  limits: null | { kind: 'jam' | 'stop', station: 'Mill A', idleMinutes: 13, events: 1 }
} ]
```

**Saving.** Add `lineMap: null` to `S`. The page keeps the owner's map in
`S.lineMap` as `{ lines: [ { name, stations } ] }` with robot stations as
`{ kind: 'robot', robotId }` (the server's id), machines as `{ kind:
'machine', name }`, buffers as `{ kind: 'buffer', name, holds }`. It is
saved as the account input `lineMap` with every other input; the page
already does this. Do not add a save call. The server checks it (every
robot on the account and on one line only, every machine and buffer
named, a robot on every line) and answers 400 with a sentence when
something is off; show that sentence under the editor and keep the
owner's edits. Saving `null` puts the drafted line back.

**Preview.** Add `?livepreview=line`: the `mfg` preview plus a confirmed
map, `Loader 1 → Mill A → Loader 2 → Mill B → Deburr → conveyor (holds 10)
→ Inspection`, with Loader 1 and Loader 2 as twins `loaders`; and four
events today: an open jam on Mill A, 4 minutes so far, Loader 1 and
Loader 2 waiting; a closed jam on Mill B, 3.3 minutes, 11 robot-minutes,
$0.75; a stop by Loader 2 of 4 minutes that left Deburr waiting 3; and a
stop by Inspection of 2 minutes that left nobody waiting. The summary
reads 62% by machines, `limits` Mill A. `?livepreview=mfg` keeps its
drafted map: the four arms in a row, no machines.

---

## 2. Settings > Line: draw the line

A new Settings page, **Line**, with one block per line in `LINE_MAP` and
`+ Add a line` under them.

**Drafted.** A slim banner at the top: `We drew this line from the robots
we see. Put them in order, add the machines between them that are not
robots, then confirm.` with the glyph `help-circle`.

**The editor.** A line is a vertical list of stations in order, top to
bottom, each a row with a drag handle (and up and down buttons that do the
same thing, which is what 390px uses):

- a **robot** row shows its name and model as the page's robot chip, and
  a small `Same job as…` select listing the other robots on the line to
  mark twins (saves `twin`, the same label on both). `Remove` takes it off
  the line; it is not deleted, it waits in the `Add a station` list.
- a **machine** row is a name field with the placeholder `CNC mill, sealer,
  palletizer` and the glyph `cpu`.
- a **buffer** row is a name field and `holds about` with a number and
  `units` after it.

Under the list, `+ Add a station` opens three choices: `A robot` (a select
of robots not yet on any line, disabled with `Every robot is on a line`
when none are left), `A machine that is not a robot`, `A conveyor or
buffer`. The line's name is an editable heading.

Between two robots with nothing between them, a quiet hint on the join:
`Nothing between these two? If a machine sits here, add it. That is how
Botlien names what holds the line.`

Primary `This is my line` (one for the whole page, under every line).
Pending: `Saving…`. On success the banner goes away, the map draws as a
strip (section 3) and one line reads it back in words: `Loader 1 feeds
Mill A, which feeds Loader 2, which feeds Mill B…`. On a 400, the server's
sentence under the editor, nothing lost.

Secondary `Start again from the robots` puts the draft back (saves
`null`), after asking once.

---

## 3. What limits the line

**The strip.** On the dashboard, under the tile strip in a live account
with a map, one strip per line: robot chips, machine boxes (the `cpu`
glyph), buffer pills (`conveyor · 10`), joined left to right by thin
rules, wrapping at 390px. A station with an open event carries a dot in
`--bad`. Clicking a robot opens its drawer; clicking a machine opens the
events table filtered to it.

**The panel.** Beside the strip, `What limits CNC cell 1`, from
`LINE_SUMMARY`:

- When `limits` is set: the station, big, with under it `a machine, not a
  robot` for a jam or `a robot` for a stop, then `held the line for
  13 min this period` (`idleMinutes`, as robot-minutes idle because of it).
- A two-segment bar: idle because of machines against because of robots,
  labelled with minutes, and the sentence `Non-robot machines caused 62%
  of your robots' waiting this period. A robot dashboard shows green
  through all of it.` Only when `shareByMachines` is not null; otherwise
  `No jams or stops this period.`
- Dollars under the bar: `$0.81 in robot time because of machines, $0.13
  because of stops`, with the `estimated` pill while any arm is estimated.
  Never a yearly figure here; that is the Idle cost tile.
- While `drafted`: the panel reads `Confirm your line on Settings > Line
  and Botlien will say which machine holds it.` with a link, and nothing
  else.

**The table.** Under the panel, `Jams and stops`, one row per
`LINE_EVENTS` entry, newest first:

| Column | From |
|---|---|
| When | `startedAt` in the account's time zone, as the stops table does |
| What | jam: `Mill A held the line`, open: `Mill A is likely holding the line`; stop: `Loader 2 stopped` |
| How long | `minutes`, open rows `4 min so far` with the pill `still going` tone `bad` |
| Who waited | `idle` as `Loader 1 4 min · Loader 2 4 min`, or `nobody` |
| Robot time | `costCents` as money; `not priced` in `--fg3` when `priced` is false |

A jam read from one side carries, under What, in `--fg3`: `read from one
side: only one robot is next to it`.

**Needs attention.** An open jam goes above everything else: `Mill A is
likely holding CNC cell 1, 4 min so far`, linking to the table.

**The robot drawer.** One line under the robot's name: `Between Mill A and
Mill B on CNC cell 1` (its neighbours on the map, machines or robots), and
its own rows from the table.

---

## 4. Words

- A jam is `<machine> held the line` or, open, `is likely holding the
  line`. `Jam` appears only in the table's heading.
- Waiting because of something is `idle`; its price is `robot time`.
- Never `we saved`, `you lost $` or a yearly figure from these events.

---

## 5. Not in this pass

- The output-rate watch (a jam caught from cycles dropping with no
  waiting pattern).
- Twins and wear (the `twin` label is saved, nothing reads it yet).
- The line map inside first run; it lives in Settings until the chat
  onboarding exists.
- Buttons on a jam in Slack.

Leave room for them. Do not mock them.

---

## 6. Check before you call it done

- `?demo=1`: nothing changed. No request goes to a server.
- `?livepreview=mfg`: the dashboard strip shows four robot chips in a row,
  the panel asks to confirm the line, Settings > Line shows the banner.
- `?livepreview=line`: the strip shows seven stations with a dot on Mill
  A; the panel says Mill A, `a machine, not a robot`, the bar reads 62%;
  the table has four rows, the first `still going`; Needs attention leads
  with Mill A; Loader 1's drawer reads `Between the start and Mill A`.
- In Settings > Line, moving Deburr above Mill B, adding a machine `Sealer`
  after Inspection and saving sends `{ lines: [ { name, stations } ] }`
  with robot stations as `{ kind: 'robot', robotId }`; the preview's
  failed reply keeps every edit on screen.
- Removing the last robot from a line and saving shows the server's
  sentence, nothing else changes.
- No em dash. No text under 11.5px. 390px works on every changed screen,
  including dragging by the up and down buttons.
