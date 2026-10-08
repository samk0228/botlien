# The agents' data API, version 1

Botlien is becoming an AI team for the floor: Mara as the lead, one watcher
per robot, a Stop Watcher and a Logbook Keeper (Antonio's brief, 10/7/26).
The agents sit on top of the dashboard and must never say a number the
dashboard would not. This is the layer they read.

## Rules it keeps

- **Read only.** Every route is GET. Anything else is a 405. There is no
  write or control endpoint here and Botlien has none anywhere: the UR
  gateway refuses the ports that move an arm.
- **One calculation layer.** Every answer is built from `fleetContract`,
  `incidents.mjs` and `line.mjs`, the code the dashboard and the Slack
  alert already use. A stop's cost here is the same arithmetic as the
  Slack message; a robot's hourly cost is the dashboard's cost block.
- **Nothing invented.** A figure is `{ value, unit, basis, math }`.
  `basis` is `measured` (counted from the robots' samples), `owner` (rests
  on a number the owner entered) or `estimated` (rests on list prices and
  defaults). `math` is the working, in words an agent can repeat.
- **Dollars in one shape.** Every dollar figure is a field named `*Cents`
  inside a `cost` object, so the role rules (next PR) can take all of them
  out for a technician in one place, on the server.

## The four questions

All need a signed-in session today. Times are milliseconds or ISO dates.

| Route | Answers |
| --- | --- |
| `GET /api/v1/agent/line` | What each robot is doing now (working, waiting, stopped, paused, idle, off, offline), seconds since its last sample, whether that is live (30 s), its open stop, the line map, jams going on, and each line's tally for the period. |
| `GET /api/v1/agent/stops` | Stops in a window (`since`, `until`, default the last 7 days; `robot`; `limit` up to 500). Each has start, end, robot, kind, the robot's own code and description, minutes, repeats, who claimed it, its cost with the math, and line context: the robots it left waiting and any machine jam on the same line in the 10 minutes before. |
| `GET /api/v1/agent/stops?after=<cursor>` | The stop feed for the Stop Watcher: every stop opened, updated or closed since the cursor, oldest change first. Keep the `cursor` from the answer and pass it next time. |
| `GET /api/v1/agent/costs` | Per robot, this period: working share, working hours, cost per hour to own and run, cost per hour of real work, idle cost a year. Fleet totals. |
| `GET /api/v1/agent/robots/:id/history` | Working, online and down minutes, cycles, errors and stops by `bucket=hour` (default) or `day`, at most 92 days, plus `stopsThisMonth` for "third time this month". |

Mara's first three questions map like this:

- "Why did Loader 2 stop three times this week": `stops?robot=<id>`. Codes,
  descriptions, minutes and repeats for each.
- "Was it the robot or the mill": the same answer's `context`. A stop is
  the robot reporting its own stop. A machine jam just before it is named
  next to it. That is a pattern, not a diagnosis; the overnight benchmark
  named a jam's cause right 25 times in 31. Needs a saved line map.
- "What did the stops cost": `totals.cost` on the same answer. It is robot
  time, so it reads in cents and dollars. Lost parts need a part value
  from the owner, and that should be profit per part, not price.

## What changed underneath

Stop records used to be made only for accounts with Slack connected,
because the Slack job was the only thing that made them. The job now
records every account's stops and only posts where a channel is set.

Stops are read from each robot's latest sample every 30 seconds. So a
stop shorter than that between two ticks can be missed, and history that
arrives in bulk (a file import, a replay at full speed) does not become
stop records. The line job reads the full timeline and does catch both;
those land in line events. Making stop records from the timeline too is a
follow-up if the agents need history from imports.

## Answers to the brief's questions

**What sends robot data from a shop, and who sets it up?** For Universal
Robots, the gateway in `gateway/ur/`: one Node program with no
dependencies on any box that can reach the arms (a mini PC, a Raspberry
Pi 5, the cell's own PC). It reads RTDE only, opens no port, and pushes
out to `POST /api/v1/events` with the account's API key. Today we set it
up with the customer: list the arms' IPs, paste a key, run it. The
onboarding screen's "enter this code in your robots' cloud settings" is not
how UR works and should become "we install a small box, or your integrator
does."

**Which brands and feeds today?** Universal Robots through the gateway,
proven against URSim, not yet a real arm. Gausium through its cloud API
(connector built, needs a customer's keys). Bear Robotics through its
cloud API (connector built, waiting on credentials). Any other system can
push the same event shape to `/api/v1/events`, and CSV or JSONL exports
can be imported.

**How often does a reading arrive, and how is lost contact found?** The
gateway reads each arm at 10 Hz on site and sends a sample when the state
changes (held 2 seconds so a flicker is not a change) and a heartbeat every
15 seconds. Lost contact two ways: the gateway sends an explicit offline
sample when it loses an arm, and Botlien opens an offline stop when a
pushed robot that was working sends nothing for 10 minutes (the gateway
box died or lost its uplink).

**Incident codes and causes as data?** Yes, this PR. Kind, code,
description, start, end, repeats and line context are fields, not text.

**What happens to Ask Botlien?** Keep its engine and give it Mara's face.
Its answers already come from the contract. Mara's model should call these
routes as tools rather than read the page.

## Storage

Measured on our schema: about 100 bytes per stored sample. A busy arm
sends roughly 5,760 heartbeats a day plus 2 to 4 state changes per cycle,
so about 8,000 samples a day. Four arms is about 1 million a month and
about 100 MB a month raw, not 3.5 million and 350 MB. Hourly rollups are
already kept separately and are tiny.

Postgres can wait. Each customer is one SQLite file today, which makes
"export my data" a file copy and "delete my data" a file delete, and it
runs unchanged in the container we deploy. The limit is one machine
(fly.toml says why). That is fine for the first hundred shops. Moving to
Postgres is worth doing when we need two machines or a shared analytics
query, not before. Raw samples older than 90 days can be pruned once the
rollups cover them; nothing prunes them yet.

## Not in this version

- Role rules on the server (a technician never receives a `*Cents` field).
  Next PR.
- A read-scoped API key so Mara's backend can call these without a browser
  session. Next after roles, since the key has to carry a role.
- Text messages (10DLC) and phone calls.
