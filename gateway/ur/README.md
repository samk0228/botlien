# Botlien UR gateway

Reads Universal Robots arms on the shop network and sends their status to
Botlien. One small program, no dependencies, Node 18 or newer. It runs on any
box that can reach the arms: a mini PC, a Raspberry Pi 5, the cell's own
industrial PC.

## What it never does

It reads RTDE on port 30004 and sets up outputs only. It has no code that
sends RTDE inputs, and it refuses to connect to 29999 (dashboard server) or
30001-30003 (URScript). It cannot move an arm, load a program, or change a
setting. It opens no port of its own; every connection goes out.

## Windows

Node 18 or newer and the same command. (Before Oct 1 2026 the gateway
exited silently on Windows because its start check compared a `C:\` path
with a file URL; fixed.)

## Install it (one line)

On a PC that is already on the same network as the arms (no new hardware):

- Windows, PowerShell as Administrator: `irm https://app.botlien.com/gateway/install.ps1 | iex`
- Linux: `curl -fsSL https://app.botlien.com/gateway/install.sh | sudo sh`
- Mac: `curl -fsSL https://app.botlien.com/gateway/install.sh | sh`

It needs Node.js 18 or newer. It asks for the account's gateway key (made on
Botlien's Connect robots step or Settings > Data sources) and each arm's IP,
checks it can reach each arm on 30004, downloads these files from Botlien,
keeps the key readable only by the system, and sets the gateway to start by
itself and restart if it stops (systemd on Linux, a login agent on macOS, a
startup task on Windows). Remove it with `sh -s -- --uninstall` (or
`$env:BOTLIEN_UNINSTALL=1` before the Windows line).

Scripted installs skip the questions:
`BOTLIEN_API_KEY=blk_... BOTLIEN_ARMS="192.168.1.21,Loader 1,UR10e;192.168.1.22,Loader 2" sh install.sh`.

## Set it up by hand

1. In Botlien, Settings > Data sources > Make an API key. Copy it once.
2. Copy `config.example.json` to `gateway.json` and list the arms: a stable
   `id` (never change it, it is how Botlien knows the arm), the arm's IP as
   `host`, and its `name`, `model` (`UR10e`, `UR5e`...) and `category`
   (`machine_tending` or `welding`).
3. Run it:

   ```
   BOTLIEN_API_KEY=blk_... node gateway/ur/gateway.mjs gateway.json
   ```

The key is read from the environment only, so it is never saved in a file
someone might share.

## Counting cycles

RTDE has no cycle counter. If the robot program increments an output
integer register once per part (for example
`write_output_integer_register(25, cycle)` at the end of the loop), set
`"cycleRegister": 25` and Botlien counts exact cycles. The register may
start again at 0 when the program restarts: the gateway sends a count that
only climbs (every earlier run's last value plus the current one), and the
raw register rides along as `ur.cycle_register`. Without a register,
Botlien still measures working time, which is what the cost figures use.

Several simulated arms on one machine (URSim instances) each listen on
their own port: give each arm its `port` (`30104`, `30204`, ...). A real
arm listens on 30004 and needs no `port`.

## What it sends

An event whenever something that matters changes, and a heartbeat every 15
seconds:

| Botlien field | From the controller |
|---|---|
| `mission_state` `active` | program playing and the arm moving, or still for less than 2 s between two moves |
| `mission_state` `waiting` | program playing, arm still for longer than that (waiting on a machine) |
| `mission_state` `paused`, `idle`, `off` | runtime state and robot mode |
| `stuck` | protective stop or safeguard stop |
| `e_stop` | system or robot emergency stop |
| `errors` | the safety mode, for any stop, violation or fault |
| `cycle_count` | the configured output register |
| `connection_state` `offline` | the gateway lost the arm (not counted as downtime) |
| `ur.*` | robot, safety and runtime mode, speed slider and scaling, joint current mean and max, joint temperature max, since the last event |

A pause shorter than `holdSeconds` (2 by default) inside a move, a gripper
closing for instance, is counted as work. A longer one is waiting, and it is
dated from the moment the arm stopped, not from when the 2 seconds ran out,
so a 10 second move reads as 10 seconds of work. Set `"holdSeconds": 0` in
`gateway.json` to count work as strictly "the arm is moving".

If the internet drops, events are held in order (up to 200,000) and sent when
it returns.

## Run it as a service (Linux)

```
[Unit]
Description=Botlien UR gateway
After=network-online.target

[Service]
Environment=BOTLIEN_API_KEY=blk_...
ExecStart=/usr/bin/node /opt/botlien/gateway/ur/gateway.mjs /opt/botlien/gateway.json
Restart=always

[Install]
WantedBy=multi-user.target
```

## Testing without a robot

`fake-ursim.mjs` speaks the RTDE handshake and streams a simulated CNC
tending cell. It is not URSim: no kinematics, no safety system. The real
check is the gateway against URSim or a real arm.

```
node gateway/ur/fake-ursim.mjs --port 31004 --cycle 40 --move 10 --stop-every 3
```

and in `gateway.json`, `"host": "127.0.0.1", "port": 31004`.
