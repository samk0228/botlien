# Live stops: what our own dashboard and chat expect from the backend

Goal: stops appear live in the Botlien product itself (the Stop Watcher chat, the rail, the cells and the logbook), with no Slack needed. Slack, text and email become delivery adapters on the same stop records later.

The client is already built and tested against a fake server (`mock_stops_server.js` in this folder). It turns on only when the page is given an API base: `window.__BOTLIEN_API = "https://app.botlien.com/api"` or `?api=https://host/path` in the URL. With no API base it stays the scripted demo.

IMPORTANT: it only works on a page served from the same site as the API (for example botlien.com), because requests use same origin cookies for sign in. The claude.ai demo pages cannot call botlien.com, so the live version must be hosted on botlien.com.

## 1. Read stops

`GET {api}/stops?since={cursor}`  (polled every 3 seconds)

Response:

```json
{
  "cursor": 12345,
  "stops": [
    {
      "id": "stop-1",
      "robot": "Loader 2",
      "state": "open",
      "source": "replay",
      "type": "fault",
      "startedAt": "2026-10-08T01:10:00Z",
      "endedAt": null,
      "minutes": 6,
      "errorCode": "C153",
      "description": "Protective stop",
      "repeatCount": 3,
      "leftWaiting": ["Deburr"],
      "robotTimeCost": 0.44,
      "partsLost": 14,
      "acks": [{ "by": "Dana", "kind": "on", "at": "2026-10-08T01:12:00Z" }],
      "fix": null
    }
  ]
}
```

Field rules:
- `id` is stable. Return a stop again whenever it changes (opened, acknowledged, closed, fix added). The client dedupes by `id`.
- `robot` is the robot name as the customer sees it (Loader 1, Loader 2, Deburr, Inspection) or a zero based index.
- `state` is `open` or `closed`.
- `source` is `replay` (a recorded simulation) or `robot` (a real connection). The client labels alerts "Replay, live feed" or "Live". Never label replayed data as live.
- `type` is one of `e-stop`, `protective`, `fault`, `offline`.
- `minutes` is optional. If missing the client computes it from `startedAt` and `endedAt`.
- `robotTimeCost` is dollars of robot time (hourly cost times minutes down, plus the robots it left waiting). Optional, the client falls back to the arm's hourly cost times minutes.
- `partsLost` is optional and should stay null until the owner has entered a part value. That value should be PROFIT per part, not price.
- `acks` is the list of acknowledgements. `kind` is `on`, `look` or `snooze`.
- `fix` is the "what fixed it" text, or null.

Technician rule: the server must strip `robotTimeCost` (and any dollar field) from the response for technician users. The client also hides dollars on screen, but that is not access control.

## 2. Acknowledge

`POST {api}/stops/{id}/ack` with `{ "kind": "on" | "look" | "snooze" }`
Record who acknowledged and when (from the signed in user). The next GET includes it in `acks`, which shows other people "Dana said they are on it" in everyone's chat.

## 3. What fixed it

`POST {api}/stops/{id}/fix` with `{ "what": "Cleared what was blocking it" }`
The three tap options are: Cleared what was blocking it, Reset the machine it waits on, Something else. Later this can accept free text.

## 4. What the client does with it

- New open stop: posts the alert in the Stop Watcher chat (robot, minutes, error, repeat count, robot time cost, parts not made, what it left waiting) with I am on it, Look into it, Snooze buttons. The Stop Watcher dot and the robot's cell turn red.
- Someone else acknowledges: a one line message.
- Stop closes: posts "running again" with the minutes, then asks what fixed it, and writes a Logbook entry.
- Technician view: dollars hidden. Owner view: dollars shown.

## 5. The measurement we want from this

Minutes from `startedAt` to the first entry in `acks`, and the share of stops that end with a `fix`. These two numbers are the proof for customers and investors. Please keep timestamps accurate.

## 6. Mara's three questions (separate endpoints)

Same data, filtered. Suggested: `GET {api}/stops?robot=Loader 2&from=2026-10-01&to=2026-10-08`, the line map cause on each stop (robot or mill, with a confidence), and a cost summary for a date range. The benchmark named the cause right 25 of 31 times, so Mara must say how sure she is.
