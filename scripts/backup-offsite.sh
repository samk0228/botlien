#!/bin/bash
# Pull a consistent copy of every production database down to this machine.
#
# Why this shape and not a scheduled machine on Fly: a Fly volume attaches to
# exactly one machine, and that machine is the app. A second machine cannot
# mount /data to back it up, so the backup has to be initiated from outside and
# the databases pulled down. That makes this laptop the offsite copy.
#
# The heavy lifting is scripts/backup.mjs running INSIDE the container, which
# uses VACUUM INTO. A plain copy of a live SQLite file can catch a write
# half-applied and produce a file that opens fine and is subtly wrong.
#
# Run by launchd daily (com.sam.botlien-backup). Safe to run by hand any time.

set -uo pipefail

# launchd hands over a minimal PATH, so flyctl and sqlite3 are named explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

APP="botlien"
DEST="$HOME/Backups/botlien"
KEEP_DAYS=14
REMOTE_TMP="/tmp/bk"
GENESIS="/Users/samuelkim/Sams_lifeos/Claude/Projects/genesis/bin/genesis-log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*"; }

# Fire-and-forget, never breaks the caller.
notify() {
  [ -x "$GENESIS" ] && "$GENESIS" botlien "$1" "${2:-info}" >/dev/null 2>&1
  return 0
}

fail() {
  log "FAIL  $1"
  notify "Botlien backup FAILED: $1" needs_user
  exit 1
}

mkdir -p "$DEST" || fail "cannot create $DEST"

# ---------- 1. snapshot inside the machine ----------
log "starting backup of $APP"
out=$(fly ssh console -a "$APP" -C "node /app/scripts/backup.mjs $REMOTE_TMP" 2>&1)

# backup.mjs exits non-zero on any failed database, and prints PASS only when
# every one of them succeeded. Both are checked: a partial backup that looks
# like a whole one is the failure mode worth being paranoid about.
if ! printf '%s' "$out" | grep -q '^PASS'; then
  log "$out"
  # The failure that ran for two weeks in September 2026: say what fixes it.
  if printf '%s' "$out" | grep -q 'no access token'; then
    fail "the Fly CLI on this Mac is not logged in. Run: fly auth login"
  fi
  fail "backup.mjs did not report PASS"
fi

remote_dir=$(printf '%s' "$out" | sed -n 's|.*-> \(/tmp/bk/[^ ]*\).*|\1|p' | tail -1)
[ -n "$remote_dir" ] || fail "could not parse the backup directory out of backup.mjs output"
log "container wrote $remote_dir"

# ---------- 2. pull it down ----------
stamp=$(basename "$remote_dir")
local_dir="$DEST/$stamp"
mkdir -p "$local_dir" || fail "cannot create $local_dir"

# Listed rather than hardcoded: the tenant files are named per account, so the
# set grows every time somebody signs up.
files=$(fly ssh console -a "$APP" -C "ls $remote_dir" 2>&1 | grep -v '^Connecting to' | tr -d '\r' | grep '\.db$')
[ -n "$files" ] || fail "no .db files found in $remote_dir"

count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if fly ssh sftp get "$remote_dir/$f" "$local_dir/$f" -a "$APP" >/dev/null 2>&1; then
    count=$((count + 1))
  else
    fail "could not download $f"
  fi
done <<< "$files"
log "downloaded $count database(s) to $local_dir"

# ---------- 3. verify what landed ----------
# A backup nobody has opened is a guess. Every file is checked here so a corrupt
# copy is caught tonight rather than on the day it is needed.
bad=0
for f in "$local_dir"/*.db; do
  [ -e "$f" ] || continue
  res=$(sqlite3 "$f" "PRAGMA integrity_check;" 2>&1)
  if [ "$res" != "ok" ]; then
    log "  CORRUPT  $(basename "$f")  $res"
    bad=$((bad + 1))
  else
    log "  ok       $(basename "$f")  $(du -h "$f" | cut -f1)"
  fi
done
[ "$bad" -eq 0 ] || fail "$bad database(s) failed integrity_check in $local_dir"

# ---------- 4. tell production ----------
# The app emails ops when this mark goes stale (src/backup-check.mjs), so a
# job that stops running is noticed even if nobody reads this log.
if ! fly ssh console -a "$APP" -C "node /app/scripts/backup-mark.mjs $count" 2>&1 | grep -q '^MARKED'; then
  log "  could not record the backup in production (the backup itself is good)"
  notify "Botlien backup ok but not recorded in production: check scripts/backup-mark.mjs is deployed" needs_user
fi

# ---------- 5. tidy up ----------
fly ssh console -a "$APP" -C "rm -rf $REMOTE_TMP" >/dev/null 2>&1

# Prune old local copies. Runs only after a verified-good backup exists, so a
# broken run can never delete the last known good one.
find "$DEST" -maxdepth 1 -type d -name 'botlien-*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null

kept=$(find "$DEST" -maxdepth 1 -type d -name 'botlien-*' | wc -l | tr -d ' ')
log "PASS  $count database(s) verified, $kept backup(s) retained locally"
notify "Botlien backup ok: $count databases verified, $kept retained"
