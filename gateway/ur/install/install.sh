#!/bin/sh
# Botlien UR gateway installer, for Linux and macOS.
#
#   curl -fsSL __BOTLIEN__/gateway/install.sh | sh
#   curl -fsSL __BOTLIEN__/gateway/install.sh | sh -s -- --uninstall
#
# For a scripted install (an integrator setting up several PCs), skip the
# questions: BOTLIEN_API_KEY=blk_... BOTLIEN_ARMS="192.168.1.21,Loader 1,UR10e;192.168.1.22,Loader 2"
# BOTLIEN_GATEWAY_NO_SERVICE=1 installs the files without starting a service.
#
# Runs on a PC that is already on the same network as the arms. It asks for
# the account's gateway key and each arm's IP, downloads the gateway from
# Botlien, and sets it to start by itself and restart if it stops:
# a systemd service on Linux (run as root), a login agent on macOS.
#
# Read only. The gateway reads RTDE on port 30004 and refuses every port that
# can move an arm. It opens no port of its own; it only sends out to Botlien.
set -eu

BOTLIEN="__BOTLIEN__"
FILES="gateway.mjs arm.mjs rtde.mjs sender.mjs"
NAME="botlien-gateway"
TTY=/dev/tty

say() { printf '%s\n' "$*"; }
fail() { printf 'Botlien gateway: %s\n' "$*" >&2; exit 1; }
ask() { printf '%s' "$1" > "$TTY"; IFS= read -r REPLY < "$TTY" || REPLY=""; }

OS=$(uname -s)
if [ "$(id -u)" = "0" ] && [ "$OS" = "Linux" ]; then
  DIR=/opt/$NAME; MODE=systemd
elif [ "$OS" = "Darwin" ]; then
  DIR="$HOME/.$NAME"; MODE=launchd
else
  DIR="$HOME/.$NAME"; MODE=none
fi
[ -n "${BOTLIEN_GATEWAY_NO_SERVICE:-}" ] && MODE=none
UNIT=/etc/systemd/system/$NAME.service
PLIST="$HOME/Library/LaunchAgents/com.botlien.gateway.plist"

if [ "${1:-}" = "--uninstall" ]; then
  if [ "$MODE" = systemd ]; then systemctl disable --now "$NAME" 2>/dev/null || true; rm -f "$UNIT"; systemctl daemon-reload 2>/dev/null || true; fi
  if [ "$MODE" = launchd ]; then launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; fi
  rm -rf "$DIR"
  say "Botlien gateway removed from this computer."
  exit 0
fi

say "Botlien UR gateway: reads your Universal Robots arms and sends their status to Botlien."
say "Read only. It can never move or change an arm."
say ""

# ---- Node 18 or newer ----
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 22 LTS from https://nodejs.org and run this again."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || fail "Node.js $NODE_MAJOR is too old. Install Node 22 LTS from https://nodejs.org and run this again."
NODE=$(command -v node)

# ---- the account's key ----
KEY="${BOTLIEN_API_KEY:-}"
if [ -z "$KEY" ]; then
  printf 'Gateway key (from Botlien, starts with blk_): ' > "$TTY"
  stty -echo < "$TTY" 2>/dev/null || true
  IFS= read -r KEY < "$TTY" || KEY=""
  stty echo < "$TTY" 2>/dev/null || true
  printf '\n' > "$TTY"
fi
case "$KEY" in blk_*) ;; *) fail "That is not a gateway key. Make one in Botlien (Connect robots, or Settings > Data sources)." ;; esac

# ---- the arms ----
ARMS=""
N=0
# Given up front ("ip,name,model;ip,name,model"), or asked one by one.
PRESET="${BOTLIEN_ARMS:-}"
say ""
[ -z "$PRESET" ] && say "Now the arms. For each one, its IP address on your network (on the teach pendant: Settings > System > Network)."
while :; do
  if [ -n "$PRESET" ]; then
    ENTRY=${PRESET%%;*}
    [ "$ENTRY" = "$PRESET" ] && PRESET="" || PRESET=${PRESET#*;}
    [ -z "$ENTRY" ] && { [ -z "$PRESET" ] && break; continue; }
    IP=$(printf '%s' "$ENTRY" | cut -d, -f1 | tr -d ' ')
    ANAME=$(printf '%s' "$ENTRY" | cut -s -d, -f2); ANAME=${ANAME:-Arm $((N + 1))}
    MODEL=$(printf '%s' "$ENTRY" | cut -s -d, -f3); MODEL=${MODEL:-UR10e}
    printf '%s' "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || fail "$IP is not an IP address like 192.168.1.21."
  else
  ask "Arm $((N + 1)) IP address (leave blank when done): "
  IP=$(printf '%s' "$REPLY" | tr -d ' ')
  [ -z "$IP" ] && break
  printf '%s' "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || { say "  That is not an IP address like 192.168.1.21. Try again."; continue; }
  ask "  Name for $IP (like Loader 1): "
  ANAME=${REPLY:-Arm $((N + 1))}
  ask "  Model [UR10e]: "
  MODEL=${REPLY:-UR10e}
  fi
  if node -e 'const s=require("net").connect({host:process.argv[1],port:30004,timeout:3000});s.on("connect",()=>process.exit(0));s.on("timeout",()=>process.exit(1));s.on("error",()=>process.exit(1))' "$IP"; then
    say "  Reached $IP on port 30004."
  else
    say "  Could not reach $IP on port 30004 yet. Check the arm is on and on this network. It will keep trying once installed."
  fi
  N=$((N + 1))
  ARMS="$ARMS$IP	$ANAME	$MODEL
"
  [ -n "${BOTLIEN_ARMS:-}" ] && [ -z "$PRESET" ] && break
done
[ "$N" -gt 0 ] || fail "No arms given. Run this again with at least one arm's IP address."

# ---- download and configure ----
mkdir -p "$DIR"
for f in $FILES; do
  curl -fsSL "$BOTLIEN/gateway/files/$f" -o "$DIR/$f" || fail "Could not download $f from $BOTLIEN."
done
printf '%s' "$ARMS" | BOTLIEN="$BOTLIEN" node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  const arms = lines.map((l, i) => { const [host, name, model] = l.split("\t"); return { id: "arm-" + host.replace(/\./g, "-"), host, name, model, category: "machine_tending" }; });
  process.stdout.write(JSON.stringify({ botlien: process.env.BOTLIEN, heartbeatSeconds: 15, frequency: 10, arms }, null, 2));
' > "$DIR/gateway.json"
umask 077
printf 'BOTLIEN_API_KEY=%s\n' "$KEY" > "$DIR/key.env"
chmod 600 "$DIR/key.env"
cat > "$DIR/run.sh" <<EOF
#!/bin/sh
set -a; . "$DIR/key.env"; set +a
exec "$NODE" "$DIR/gateway.mjs" "$DIR/gateway.json"
EOF
chmod 700 "$DIR/run.sh"

# ---- start it, and keep it running ----
if [ "$MODE" = systemd ]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=Botlien UR gateway (read only)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$DIR/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$NAME"
  say ""
  say "Installed and running. It starts by itself after a reboot."
  say "Status: systemctl status $NAME    Log: journalctl -u $NAME -f"
elif [ "$MODE" = launchd ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.botlien.gateway</string>
  <key>ProgramArguments</key><array><string>$DIR/run.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/gateway.log</string>
  <key>StandardErrorPath</key><string>$DIR/gateway.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  say ""
  say "Installed and running. It starts by itself when this Mac's user logs in."
  say "Log: tail -f $DIR/gateway.log"
elif [ -n "${BOTLIEN_GATEWAY_NO_SERVICE:-}" ]; then
  say ""
  say "Installed in $DIR without a service (BOTLIEN_GATEWAY_NO_SERVICE). Start it with:"
  say "  $DIR/run.sh"
else
  say ""
  say "Installed in $DIR. This system has no service manager this script knows, so start it with:"
  say "  $DIR/run.sh"
  say "(On Linux, run this installer as root to set it up as a service.)"
fi
say "Your robots show up in Botlien within a minute of their first readings."
