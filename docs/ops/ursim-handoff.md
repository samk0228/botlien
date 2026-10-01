# Running the Botlien UR gateway against URSim (for Antonio's agent)

Written 9/30/26, updated the same evening: **the new server is deployed**,
so the gateway can push straight to https://app.botlien.com. The gateway
code is on `main` of github.com/samk0228/botlien. The local-server path
below still works if you would rather keep everything on one laptop.

## Shortest path (deployed server)

1. `git clone https://github.com/samk0228/botlien.git` (main). Only
   `gateway/ur/` is needed; it has no dependencies, Node 18+.
2. Sign in at https://app.botlien.com/signin with Antonio's email. The
   sign-in link arrives by email. Pick `Manufacturing` as the business
   type. Skip the upload; the gateway is the data source.
3. Make an API key: Settings > Data sources > Make an API key, or from the
   browser console on any app page:

   ```js
   fetch('/api/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ label: 'URSim' }), credentials: 'same-origin' })
     .then(r => r.json()).then(console.log)
   ```

   Copy the `key` (`blk_...`). It is shown once.
4. Copy `gateway/ur/config.example.json` to `gateway.json`, keep
   `"botlien": "https://app.botlien.com"`, list the URSim arm as in
   section 3 below, and run
   `BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json --record run.jsonl`.
   `--record` writes every event sent to `run.jsonl`. Send that file back:
   `node scripts/benchmark-replay.mjs run.jsonl` replays it through Botlien
   and prints working, waiting, stopped, cycles and cost per arm, and with
   `--expect` checks them against what Line Lab reported for the same run
   (`benchmark/cnc-shop-v1.1.json` shows the shape).
5. Section 4 below says what to look for. The dashboard is the account you
   signed in with.

## Local server instead (everything on one laptop)

## What you need

- Node 22.5 or newer for the server (`node --version`). The gateway itself
  runs on Node 18+.
- URSim running, reachable on its IP, RTDE enabled (it is by default) on
  port 30004.
- The repo is public; no access needed to clone.

## 1. Start a local Botlien server

```
git clone https://github.com/samk0228/botlien.git
cd botlien
npm install
BOTLIEN_NO_GENESIS=1 BOTLIEN_PORT=3240 npm start
```

The console says `no RESEND_API_KEY — sign-in links print to the console`.
That is expected on a laptop.

## 2. Make an account and an API key

1. Open http://127.0.0.1:3240/signin, enter any email, submit. The page
   itself shows the sign-in link (no email is sent). Click it.
2. Pick `Manufacturing` as the business type when asked. Skip the upload
   for now; the gateway is the data source.
3. Make a key with the session cookie from the browser, or simpler, from
   the browser console on any app page:

   ```js
   fetch('/api/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ label: 'URSim' }), credentials: 'same-origin' })
     .then(r => r.json()).then(console.log)
   ```

   Copy the `key` (`blk_...`). It is shown once.

## 3. Point the gateway at URSim

Copy `gateway/ur/config.example.json` to `gateway.json`:

```json
{
  "botlien": "http://127.0.0.1:3240",
  "heartbeatSeconds": 15,
  "frequency": 10,
  "arms": [
    { "id": "linelab-loader1", "host": "<URSim IP>", "name": "Loader 1",
      "model": "UR10e", "category": "machine_tending" }
  ]
}
```

- `id` is how Botlien knows the arm. Pick it once and never change it.
- `host` is URSim's IP. If URSim runs in Docker or a VM, it is the
  container or VM address, not 127.0.0.1, unless 30004 is forwarded.
- Add `"cycleRegister": N` only if the Line Lab program writes a cycle
  count to output integer register N (`write_output_integer_register(N,
  cycle)` at the end of the loop). Without it Botlien measures working time
  and does not count cycles.
- One entry per arm for a multi-arm line.

Run it:

```
BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json
```

## 4. What to look for

- The gateway logs each arm as `connected` and then one line per event it
  sends. The server console logs accepted events.
- Load and play a Line Lab program in URSim. Within 15 seconds the arm
  shows on the dashboard (Fleet tab) and in the Right now line of its
  drawer. `active` while the arm moves, `waiting` while the program plays
  but the arm is still for 2 seconds or more (the loader waiting on the
  mill).
- Press a protective stop in URSim: `stuck` within 15 seconds, and a
  downtime row. Release it: the row closes at the next sample.
- Stop the program: `idle`. Power the arm off: `off`.
- Kill URSim: `connection_state: offline` within a few seconds. That is
  not counted as downtime.

## 5. Send back

- The `run.jsonl` recording from one full Line Lab run, and Line Lab's own
  figures for that run (working share, stops, cycles, cost per arm), so the
  two can be compared line by line.
- The gateway's console output for the same run.
- Whether the program writes a cycle counter, and which register.
- Anything the gateway got wrong against what the benchmark measured
  (working vs waiting is the one to watch).

## Known limits in this version

- The gateway reads only. It refuses ports 29999 and 30001 to 30003.
- `ur.*` fields (joint current, temperature, speed scaling) are archived
  raw and not shown yet.
- Downtime rows are built hourly; a stop may take a minute to show in the
  table, but the Right now line is live.
