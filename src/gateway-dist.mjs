// Handing out the gateway (UR arms and MiRs) to a PC on a shop floor (gateway/ur/). The
// installer scripts get this server's address written in, so
//   curl -fsSL https://app.botlien.com/gateway/install.sh | sh
// installs a gateway that sends to the same Botlien it came from. The files
// are an allowlist: nothing else on disk can be fetched through here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./infra.mjs";

const DIR = join(ROOT, "gateway", "ur");
export const GATEWAY_FILES = ["gateway.mjs", "arm.mjs", "rtde.mjs", "sender.mjs", "mir.mjs"];
const SCRIPTS = { "install.sh": "text/x-shellscript; charset=utf-8", "install.ps1": "text/plain; charset=utf-8" };

/** The asset for a /gateway/... path, or null. */
export function gatewayAsset(path, baseUrl) {
  const script = /^\/gateway\/(install\.sh|install\.ps1)$/.exec(path);
  if (script) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    if (!/^https?:\/\/[A-Za-z0-9.:\-\[\]]+$/.test(base)) return null;
    return { type: SCRIPTS[script[1]], body: readFileSync(join(DIR, "install", script[1]), "utf8").split("__BOTLIEN__").join(base) };
  }
  const file = /^\/gateway\/files\/([a-z]+\.mjs)$/.exec(path);
  if (file && GATEWAY_FILES.includes(file[1])) return { type: "text/javascript; charset=utf-8", body: readFileSync(join(DIR, file[1]), "utf8") };
  return null;
}
