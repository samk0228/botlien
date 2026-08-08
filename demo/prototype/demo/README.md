# Walkthrough video

Renders `../botlien-prototype.html` to `../../media/botlien-walkthrough.mp4`.
One command, no manual screen recording:

```
node prototype/demo/record.cjs
```

3:04, 1920x1080, 30fps, about 16MB. A poster frame lands next to it.

## Why it is scripted

The prototype is still changing. A hand-recorded screen capture has to be
re-shot and re-narrated every time a number moves. This drives the real page
with Playwright, so a prototype edit plus one command gives a new video with
no cursor fumbles, no dock, no notification banners and no scroll jitter.

Requires `ffmpeg` on PATH (`brew install ffmpeg`) and a Playwright chromium.
Both paths are overridable:

```
PLAYWRIGHT_DIR=/path/to/node_modules/playwright CHROME_EXE=/path/to/chromium node record.cjs
```

## What it records

Title card, then the real click path: sign in, the emailed link, first run
steps 1 to 4, the usage import, then the statement top to bottom (headline,
four tiles, what to fix first, the sensitivity drag, trend, cohort, why it
moved, by kind of work), then robot by robot, condition, rates, all 3 sites,
the export menu, and an end card.

Captions are DOM elements drawn over the page, so they are captured natively
and there is no subtitle burn-in step. The cursor is synthetic and animated,
which is why clicks land clean.

## Editing it

The beat list is the body of the async IIFE at the bottom, in order. Each beat
is roughly `cap(title, sub)`, an action, a `hold(ms)`, then `capOff()`.

- Change wording: edit the `cap(...)` strings.
- Change pacing: edit the `hold(...)` values, in milliseconds.
- Add a screen: `nav('<view>', 'Caption', 'Sub')` for anything in the app rail.
- Buttons are found by their `data-act`, never by pixel position, so a layout
  change will not break the run. A missing target logs `!! MISS` and keeps
  going rather than dying halfway.

The sensitivity drag ends back at the app default of 30 runs per hour on
purpose, so the closing shot shows the same 2.38x the viewer was given up top.

## Note on the figures

Captions deliberately describe the mechanics rather than quoting dollar
amounts, so the script does not go stale when the demo fleet changes. The only
figures on screen are whatever the prototype itself renders.
