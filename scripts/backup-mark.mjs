// Records, inside production, that a backup was pulled down and verified.
// Run by scripts/backup-offsite.sh after every database passes its integrity
// check: `node /app/scripts/backup-mark.mjs <databases verified>`.
// The app's backups check (src/backup-check.mjs) emails ops when this goes
// stale, so a backup job that quietly stops is noticed within a day and a
// half, whatever broke it.
import { openControl } from "../src/control.mjs";
import { resolvePath } from "../src/infra.mjs";
import { KV_BACKUP_VERIFIED } from "../src/backup-check.mjs";

const count = Number(process.argv[2] ?? 0);
const control = openControl(resolvePath(process.env.BOTLIEN_CONTROL_DB ?? "data/control.db"));
control.setMeta(KV_BACKUP_VERIFIED, JSON.stringify({ at: Date.now(), databases: count }));
control.close();
console.log(`MARKED backup verified (${count} databases)`);
