// The dashboard, served. The page is the published Demo, built from
// prototype/src by build.cjs into prototype/botlien-prototype.html, with one
// account's data contract written into it before its script runs. The page's
// LIVE block (see prototype/src/live-adapter.js) turns that contract into the
// tables every screen reads, so the demo and the product are one codebase.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./infra.mjs";

export const APP_HTML_PATH = join(ROOT, "prototype", "botlien-prototype.html");
// The manufacturing dashboard (prototype/src/botlien-mfg.part.html). Parts of
// it still run on a sample, so it is served only where a caller asks for it
// by name; see /app?page=mfg in board.mjs.
export const APP_MFG_HTML_PATH = join(ROOT, "prototype", "botlien-mfg.html");
// The team layout (prototype/src/botlien-team.part.html): Mara, the robot
// watchers, the Stop Watcher and the logbook, with the dashboard beside them.
// It reads everything from the API after it loads, so nothing is written
// into it but who is looking.
export const APP_TEAM_HTML_PATH = join(ROOT, "prototype", "botlien-team.html");

const cached = new Map();
function pageHTML(path = APP_HTML_PATH) {
  // Read once per process: the file only changes with a deploy.
  if (!cached.has(path)) cached.set(path, readFileSync(path, "utf8"));
  return cached.get(path);
}
export function mfgPageHTML() {
  return pageHTML(APP_MFG_HTML_PATH);
}

/** The team page, told who is looking and what they may do there. */
export function renderTeamHTML({ account, replay = false, dashboard = true, onboarding = "done", html = pageHTML(APP_TEAM_HTML_PATH) }) {
  const viewer = account.viewer ?? { email: account.email, role: "owner" };
  const inject = `<script>window.BOTLIEN_ACCOUNT=${scriptJSON({ email: viewer.email, role: viewer.role, owner: account.email })};window.BOTLIEN_TEAM=${scriptJSON({ replay, dashboard, onboarding })};</script>\n`;
  const at = html.indexOf("<script");
  if (at < 0) throw new Error("team page has no script to inject before");
  return html.slice(0, at) + inject + html.slice(at);
}

/** Whether the built page runs first run itself (business, connect or
 *  upload, confirm) against /api/v1/setup. Until the design pass that adds
 *  it lands, /app keeps sending a new account to the plain server pages, so
 *  shipping either half first never strands a new customer. */
export function pageRunsFirstRun(html = pageHTML()) {
  return html.includes("const LIVE_FIRST_RUN = true");
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
    `window.BOTLIEN_ACCOUNT=${scriptJSON(account ? { email: account.viewer?.email ?? account.email, role: account.viewer?.role ?? "owner", owner: account.email } : null)};</script>\n`;
  // Before the page's own script, which is the first <script> after <body>.
  const body = html.indexOf("<body");
  const at = html.indexOf("<script", body);
  if (body < 0 || at < 0) throw new Error("app page has no <body> script to inject before");
  return html.slice(0, at) + inject + html.slice(at);
}
