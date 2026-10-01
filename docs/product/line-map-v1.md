# The line map, version 1

What ships: the customer's line as stations in order (robots, the machines
between them that are not robots, buffers), saved from the dashboard and
checked by the server; and what that order lets Botlien say. When the
robot on each side of a machine is waiting and no robot on the line has
stopped, the machine between them is what is holding the line. That is the
benchmark's biggest finding (non-robot machines caused 13% to 47% of lost
output while every robot looked normal) and its build priority one.

## The map

```json
{ "lines": [ { "name": "CNC cell 1", "stations": [
  { "kind": "robot", "robotId": 3, "twin": "loaders" },
  { "kind": "machine", "name": "Mill A" },
  { "kind": "robot", "robotId": 4 },
  { "kind": "buffer", "name": "conveyor", "holds": 10 },
  { "kind": "robot", "robotId": 5 },
  { "kind": "machine", "name": "Laser marker" } ] } ] }
```

- Saved as the account input `lineMap` through `POST /api/v1/inputs`, like
  everything else the page keeps. The server checks it on save: every
  robot is on the account and on one line only, every machine and buffer
  has a name, every line has a robot. `null` puts the draft back.
- Until the owner saves one, the contract carries a draft: one line per
  site, its robots in the order they were seen, no machines, marked
  `drafted: true`. The page asks the owner to confirm it rather than
  treating it as known (onboarding spec, step 4).
- `twin` labels robots doing the same job; nothing reads it yet. It is
  the hook for the wear comparison (benchmark priority 6).

## What the line job finds (every two minutes)

For each line with a confirmed map, the last fifteen minutes (or back to
the earliest still-open episode) of every robot's samples, read as a
timeline at the gateway's 15-second heartbeat.

| Event | Rule | Idle counted |
| --- | --- | --- |
| Jam | the nearest robot before and after a machine both `waiting`, no robot on the line `stopped`, for at least 90 s | every robot on the line waiting during it |
| Stop impact | a robot `stopped` | every other robot on the line waiting during it |

- A stop outranks a jam for as long as it lasts. The benchmark's only
  wrong-cause calls were jams that began within seconds of a stop; robot
  data alone cannot separate them, so Botlien names the stop.
- A machine with a robot on one side only (the first or last station) is
  judged on that robot and the message says it is read from one side.
- Idle is priced at each robot's own hourly cost (the v1.1 cost model),
  so a jam's cost is robot time, tagged estimated until the owner enters
  their own prices. Robots without a cost block add minutes, not money.
- Rows live in `line_events` (migration 6), open while the episode goes on.

## Slack

A jam is posted to the account's channel under the same flag as stop
alerts (`BOTLIEN_SLACK_SEND=1`), one message brought up to date every five
minutes and once more when it ends:

```
Mill A is likely holding CNC cell 1: Loader 1 and Deburr have been waiting
on it since 2:02 pm, 4 min so far, and no robot has stopped. 8 robot-minutes
idle, $0.52 in robot time (estimated).

Mill A held CNC cell 1 for 6 min, from 2:02 pm: Loader 1 and Deburr waited.
12 robot-minutes idle, $0.78 in robot time (estimated).
```

Stop impacts are not posted on their own; the stop already is. No buttons
on a jam yet.

## What the contract carries

- `lineMap`: the saved or drafted map with robot names and models filled.
- `lineEvents`: the open period's jams and stop impacts, each with the
  robots idle and for how long, minutes, cost and whether it is priced.
- `lineSummary`: per line, robot-minutes and cents idle because of machines
  against because of robot stops, the share by machines (the benchmark's
  "robot idle time caused by non-robot machines"), and what limited the
  line most.
- The page adapter exposes them as `LINE_MAP`, `LINE_EVENTS` and
  `LINE_SUMMARY`. The editor and the "what limits the line" panel are a
  Claude Design prompt still to write.

## Not in this version

The output-rate watch (a jam with no waiting pattern, caught from cycles
dropping), buffers delaying the wait, twins and wear, and a line that
spans sites.
