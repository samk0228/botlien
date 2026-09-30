# Slack stop alerts, version 1

What ships: when a robot stops, one message in the customer's Slack channel
that says what happened, how long it has been down, what that is costing in
robot time, and who has it. The message is edited in place as the stop goes
on and turns green when the robot is back. Nobody claims it in ten minutes,
the lead is told in the thread; ten more, the manager. Antonio's coworker
brief, section 5, and its rules 7.1 to 7.5.

## What a stop is

A robot's latest sample says one of: protective stop (`stuck`), emergency
stop (`e_stop`), a fault whose severity is not a warning, or the link lost
(`connection_state: offline`). The UR gateway sends all four. A warning is
not a stop. The worst thing showing names the incident.

A stop that returns within ten minutes of the last one ending is the same
incident with one more repeat ("3rd stop in a row"), so a robot that trips
every few minutes is one alert that says so, not a stream.

## What the message says

```
🔴 Cell 2 UR10e hit a protective stop at 2:14 pm
Protective stop (UR-SAFETY-3)
Down 12 min so far
About 14 cycles not made (its usual pace is 70 an hour)
$0.87 in robot time (estimated, from list prices)
Not claimed yet. @lead gets it in 4 min
[ I've got it ]  [ Escalate to the lead ]
```

- Cause first, then time down, then output, then dollars. Leading with the
  cause and the output was agreed on 9/30: a single stop costs cents in
  robot time, which is honest and not the headline. The year's idle cost is
  the big number and it lives on the dashboard.
- The dollar line is the arm's own hourly cost (v1.1 cost model) times the
  minutes down, and says whether that rests on the owner's numbers or on
  list-price defaults (rule 7.2). Accounts without a cost block (service
  robots) get no dollar line rather than a made-up one.
- Cycles not made use the robot's measured pace over the last two weeks,
  and only once it has its two-week baseline (rule 7.3). Before that the
  line is left out.
- "Back after 26 min" replaces the headline when the robot returns, and the
  buttons go away. A claimed stop keeps its claimer's name.

## Escalation

| Minutes unclaimed | What happens |
| --- | --- |
| 0 | The alert is posted with both buttons |
| 10 | Thread reply, shown in the channel: `@lead nobody has claimed this in 10 minutes.` |
| 20 | Same for `@manager` |

"I've got it" stops the clock and names the presser. "Escalate" skips the
wait. With no lead or manager set, the thread reply says so instead of
mentioning nobody.

## Setting it up

One Slack app, made once, installed in each customer's workspace by their
admin (Antonio, for #botlien-alerts-test):

1. api.slack.com/apps, Create New App, From scratch. Name it Botlien.
2. OAuth & Permissions: add bot scopes `chat:write` and `chat:write.public`.
   Install to the workspace. Copy the Bot User OAuth Token (`xoxb-...`).
3. Interactivity & Shortcuts: switch it on, Request URL
   `https://app.botlien.com/api/slack/interactions`.
4. Basic Information: copy the Signing Secret. On the server it goes in
   `BOTLIEN_SLACK_SIGNING_SECRET` (a Fly secret); with `BOTLIEN_SLACK_SEND=1`
   alerts really post. Off, the job logs what it would have posted.
5. In Botlien, `POST /api/v1/slack` with `{ botToken, channel, lead,
   manager }`. `lead` and `manager` are Slack member IDs (profile, three
   dots, Copy member ID). The token is checked with `auth.test`, then sealed
   with the server's encryption key; it never shows again. `GET` returns the
   settings without the token plus the last 30 days of stops; `DELETE`
   forgets the token.

The settings screen for step 5 is a Claude Design prompt still to write
(prompt 6: Slack + who hears what). Until then, curl with the session cookie.

## Trying it without Slack

`node scripts/dev-fake-slack.mjs` listens on 127.0.0.1:3298 and prints every
message the job would post or edit. Start the server with
`BOTLIEN_SLACK_BASE=http://127.0.0.1:3298 BOTLIEN_SLACK_SEND=1
BOTLIEN_SLACK_SIGNING_SECRET=dev`, connect Slack with any `xoxb-` string,
push a stop with the UR fake (`gateway/ur/fake-ursim.mjs`) or
`POST /api/v1/events`, and watch. `node scripts/dev-fake-slack.mjs --press
claim <account>:<incident>` sends a signed button press back to the server.

## Not in this version

Text messages (10DLC registration is in motion), the daily summary in Slack
(the morning brief email covers it), joint drift and temperature warnings
(need the baseline and the gateway's joint fields, which are archived raw),
and quiet hours. Silence from the gateway itself (no samples at all) is not
yet a stop: the gateway sends an explicit offline event when it loses an
arm, and the sync-down email covers a vendor feed.
