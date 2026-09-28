// The backups check. Production cannot back itself up (its volume attaches to
// one machine), so scripts/backup-offsite.sh pulls the databases down from
// Sam's Mac mini every night and, once they verify, marks the time here
// (scripts/backup-mark.mjs). This check reads that mark once a day and emails
// ops when it is more than STALE_HOURS old, or when the app has been up
// NO_MARK_GRACE_HOURS with no mark at all. It exists because the nightly job
// failed quietly for two weeks in September 2026 when the Fly CLI on the mini
// lost its login; its failures went to the local Genesis dashboard only.
export const KV_BACKUP_VERIFIED = "backup.last_verified";
export const KV_BACKUP_WARNED = "backup.last_warned_day";
const STALE_HOURS = 36;
const NO_MARK_GRACE_HOURS = 48;
const CHECK_AFTER_UTC_HOUR = 16; // 9 AM Pacific, after the 3:30 AM job

/** What the check finds right now: null when backups are fine. */
export function backupProblem(control, { nowMs, bootMs }) {
  let mark = null;
  try {
    mark = JSON.parse(control.getMeta(KV_BACKUP_VERIFIED) ?? "null");
  } catch {
    mark = null;
  }
  if (!mark?.at) {
    const upHours = (nowMs - bootMs) / 3_600_000;
    return upHours >= NO_MARK_GRACE_HOURS ? { reason: "No verified backup is on record since this server started.", lastAt: null } : null;
  }
  const hours = (nowMs - mark.at) / 3_600_000;
  if (hours <= STALE_HOURS) return null;
  return { reason: `The last verified backup was ${Math.floor(hours / 24)} days ${Math.round(hours % 24)} hours ago.`, lastAt: mark.at };
}

export function createBackupCheck({ control, mailer, opsEmails = [], bootMs = Date.now(), log = () => {} }) {
  return {
    async tick(nowMs) {
      const today = new Date(nowMs).toISOString().slice(0, 10);
      if (new Date(nowMs).getUTCHours() < CHECK_AFTER_UTC_HOUR) return null;
      if (control.getMeta(KV_BACKUP_WARNED) === today) return null;
      const problem = backupProblem(control, { nowMs, bootMs });
      if (!problem) return null;
      control.setMeta(KV_BACKUP_WARNED, today);
      log(`backups: ${problem.reason}`, "needs_user");
      const text = [
        problem.reason,
        "",
        "Production backups are pulled to the Mac mini each night by scripts/backup-offsite.sh (launchd com.sam.botlien-backup).",
        "Its log is ~/Backups/botlien/backup.log. The usual cause is the Fly CLI on the mini losing its login: run `fly auth login` there, then `bash scripts/backup-offsite.sh` to take one now.",
        "",
        "This email repeats once a day until a backup verifies.",
      ].join("\n");
      for (const to of opsEmails) {
        const r = await mailer.send({ to, subject: "Botlien backups need attention", text });
        if (!r.ok) log(`backups warning to ${to} failed: ${r.error}`, "warning");
      }
      return problem;
    },
  };
}
