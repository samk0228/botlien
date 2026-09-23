// The dashboard, served. The page is the published Demo, built from
// prototype/src by build.cjs into prototype/botlien-prototype.html, with one
// account's data contract written into it before its script runs. The page's
// LIVE block (see prototype/src/live-adapter.js) turns that contract into the
// tables every screen reads, so the demo and the product are one codebase.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./infra.mjs";

export const APP_HTML_PATH = join(ROOT, "prototype", "botlien-prototype.html");

let cached = null;
function pageHTML() {
  // Read once per process: the file only changes with a deploy.
  if (cached === null) cached = readFileSync(APP_HTML_PATH, "utf8");
  return cached;
}

/** JSON that is safe inside a <script> element: no "</script>", no "<!--",
 *  and no line separators that end a JS string. */
export function scriptJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The page with the account's data in it. `contract` null serves the page
 *  as the demo, which is also what ?demo=1 does. */
export function renderAppHTML({ contract = null, account = null, html = pageHTML() } = {}) {
  if (!contract) return html;
  const inject =
    `<script>window.BOTLIEN_LIVE=${scriptJSON(contract)};` +
    `window.BOTLIEN_ACCOUNT=${scriptJSON(account ? { email: account.email } : null)};</script>\n`;
  // Before the page's own script, which is the first <script> after <body>.
  const body = html.indexOf("<body");
  const at = html.indexOf("<script", body);
  if (body < 0 || at < 0) throw new Error("app page has no <body> script to inject before");
  return html.slice(0, at) + inject + html.slice(at);
}
