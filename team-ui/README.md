> Branch note (2026-10-07): the live stop feed poll interval is now 1.5 seconds (was 3), per Sam's measurement for the 3 second rule. It is the LIVE.t setInterval in mvp/mvp_live.js and in the built pages.

# Botlien Team page, source for Sam

Build: `cd mvp && python build_mvp.py` writes `botlien_team_mvp.html` (the one file page) and `botlien_team_onboarding.html`.
Source files: mvp_skeleton.html, mvp_extra.css, mvp_main.js, mvp_canvas.js, mvp_onb.js, mvp_live.js, mvp_boot.js, plus ../v2_head.html and orig_dashboard.html (your dashboard, embedded unmodified in an iframe).
The built page is included so you can open it without building.

## Turning on the live stop feed
The page stays a scripted demo unless it is given an API base. Set `window.__BOTLIEN_API = "https://app.botlien.com/api/v1"` before the page script runs (or open it with `?api=https://app.botlien.com/api/v1`). It then polls `GET {api}/stops?since={cursor}` every 3 seconds with same origin cookies, so it must be served from app.botlien.com.
Mock server: `node mvp/mock_stops_server.js` (port 8781). It serves one stop that opens and closes 25 seconds later, and logs acks and fixes at `/_log`. Test with `?api=http://localhost:8781`.

## Fields the page reads (GET /stops response)
```json
{ "cursor": 12345,
  "stops": [{
    "id": "stop-1", "robot": "Loader 2", "state": "open", "source": "replay",
    "type": "fault", "startedAt": "2026-10-08T01:10:00Z", "endedAt": null,
    "minutes": 6, "errorCode": "C153", "description": "Protective stop",
    "repeatCount": 3, "leftWaiting": ["Deburr"],
    "robotTimeCost": 0.44, "partsLost": 14,
    "acks": [{ "by": "Dana", "kind": "on", "at": "2026-10-08T01:12:00Z" }],
    "fix": null }] }
```
- Required: id (stable, resend the stop whenever it changes), robot (name like Loader 1, Loader 2, Deburr, Inspection, or a zero based index), state (open or closed), source (replay or robot, so replayed data is never labeled live), startedAt.
- Optional: endedAt, minutes (the page computes it if missing), type (e-stop, protective, fault, offline), errorCode, description, repeatCount, leftWaiting (only robots blocked or starved by the stop), robotTimeCost (dollars of robot time), partsLost (leave null until the owner has entered a profit per part), acks, fix.
- Technician users: the server must strip robotTimeCost and any dollar field. The page also hides dollars, but that is not access control.

## Actions the page sends
- `POST {api}/stops/{id}/ack` with `{"kind":"on"|"look"|"snooze"}`
- `POST {api}/stops/{id}/fix` with `{"what":"Cleared what was blocking it"}`
Full detail: mvp/LIVE_STOPS_API_CONTRACT.md.

## Not included
No build_ours.py or PATCHES.md exist on our side. The Mara code is not in this package (the page's Mara answers are scripted from the feed's line data).
