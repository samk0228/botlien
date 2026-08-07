// Config, secrets, and Genesis wiring. Matches the vault-wide conventions:
// config.json is tracked and secret-free; .claude/secrets.local.json is
// gitignored; genesisLog never throws and never blocks the caller.
import { execFile as nodeExecFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GENESIS_BIN = "/Users/samuelkim/Sams_lifeos/Claude/Projects/genesis/bin/genesis-log";

export function loadConfig(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
}

export function loadSecrets(root = ROOT) {
  const p = join(root, ".claude", "secrets.local.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

export function genesisLog(message, kind, execFile = nodeExecFile) {
  if (process.env.BOTLIEN_NO_GENESIS) return;
  try {
    const args = ["botlien", String(message).slice(0, 500)];
    if (kind) args.push(kind);
    execFile(GENESIS_BIN, args, () => {});
  } catch {
    /* never throw */
  }
}
