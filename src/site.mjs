// The public surface: the front door and every sign-in screen.
//
// Palette and type scale match botlien.com (the marketing site), not the
// prototype: this is the first real page a signed-up owner lands on, and it
// should look like it belongs to the same company as the site they signed up
// from, not a different, illustrative one. Server-rendered like the rest of
// the product, with no client JavaScript: these pages are a form and a link,
// and an owner on a restaurant's wifi should not wait on a bundle to sign in.
const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
:root{
  --page-bg:#FFFFFF;
  --fg1:#0A0A0A; --fg2:#58585F; --fg3:#8B8B93;
  --ink:#0A0A0A; --ink-fg:#FFFFFF;
  --hair:#E4E4E8; --hair2:#D8D8DE; --hair3:#8B8B93;
  --ghost:#F7F7F8;
}
body{margin:0;background:var(--page-bg);color:var(--fg1);
  font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
  -webkit-font-smoothing:antialiased;min-height:100vh}
a{color:var(--fg1)}
a:hover{color:var(--fg2)}
.wrap{max-width:1040px;margin:0 auto;padding:0 28px}
/* Centred in the viewport and held to a form's width, but no card: the page
   is already blank white, so a border around the only thing on it would be
   drawing a box around a box. */
.auth-shell{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px}
.auth{width:100%;max-width:360px}
.mark{display:block;margin-bottom:28px;line-height:0}
.mark img{display:block;height:22px;width:auto}
h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;line-height:1.2;margin:0 0 8px}
.lede{font-size:13.5px;line-height:1.6;color:var(--fg2);margin:0 0 28px}
.field{margin-bottom:16px}
label{display:block;font-size:12.5px;font-weight:600;color:var(--fg1);margin-bottom:7px}
input[type=email],input[type=password]{width:100%;font-size:14.5px;color:var(--fg1);background:#fff;
  padding:11px 13px;border:1px solid var(--hair2);border-radius:6px;outline:none;font-family:inherit}
input[type=email]:focus,input[type=password]:focus{border-color:var(--fg1)}
input[type=email]::placeholder,input[type=password]::placeholder{color:var(--fg3)}
.btn{width:100%;margin-top:8px;padding:12px 20px;border-radius:6px;border:none;
  background:var(--ink);color:var(--ink-fg);cursor:pointer;font-size:14.5px;font-weight:600;
  font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:10px}
.btn:hover{background:#2A2A2A}
.alt{width:100%;margin-top:10px;padding:11px 20px;border-radius:6px;border:1px solid var(--hair2);
  background:#fff;color:var(--fg1);cursor:pointer;font-size:14px;font-weight:500;
  font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:10px}
.alt:hover{background:var(--ghost)}
.ghost{display:inline-block;padding:13px 20px;border-radius:4px;border:1px solid var(--hair2);
  background:transparent;color:var(--fg1);cursor:pointer;font-size:13.5px;font-weight:600;
  font-family:inherit;text-decoration:none}
.err{font-size:12.5px;font-weight:600;color:var(--fg1);margin-top:8px}
.note{margin-top:16px;padding:14px 16px;border:1px solid var(--hair3);border-radius:4px;
  font-size:13.5px;line-height:1.6;color:var(--fg2)}
.ok{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--hair);
  border-radius:4px;margin-bottom:28px;font-size:13.5px;color:var(--fg2)}
.fine{font-size:11.5px;color:var(--fg3);margin-top:20px;padding-top:18px;
  border-top:1px solid var(--hair);line-height:1.55}
.row{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
/* front door */
.hero{padding:110px 0 72px}
.hero h1{font-size:clamp(32px,6vw,52px);max-width:15ch;margin-bottom:20px}
.hero .lede{font-size:16.5px;max-width:52ch;margin-bottom:36px}
.cta{display:inline-block;padding:15px 26px;border-radius:4px;background:var(--ink);
  color:var(--ink-fg);text-decoration:none;font-size:14.5px;font-weight:700}
.cta:hover{opacity:.9;color:var(--ink-fg)}
.second{display:block;margin-top:26px;font-size:13.5px;color:var(--fg2)}
.proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;
  background:var(--hair);border-top:1px solid var(--hair);margin-top:24px}
.proof div{background:var(--page-bg);padding:26px 22px;font-size:13.5px;line-height:1.6;color:var(--fg2)}
.proof b{display:block;color:var(--fg1);font-weight:700;font-size:13px;margin-bottom:6px}
footer{margin-top:72px;padding:28px 0 48px;border-top:1px solid var(--hair);
  font-size:12.5px;color:var(--fg3)}
@media(max-width:600px){.hero{padding:72px 0 48px}.auth{padding:64px 22px 48px}}
`;

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style></head>
<body>${body}</body></html>`;
}

// The marketing site's own lockup (mark + "botlien" wordmark), loaded from
// botlien.com rather than duplicated into this app's static assets, so one
// logo file update covers both. Always the full lockup here, no icon-only
// variant: the site's nav shrinks to the bare mark to save horizontal room
// next to its links, and a centred login card has no such constraint.
const MARK = `<a href="https://botlien.com" class="mark">
  <img src="https://botlien.com/logo-lockup.png" alt="Botlien">
</a>`;

/** S0. No pricing, no logo wall, no testimonial, no outcome claim: we have no
 * customers yet, and the product's position is that it does not make the
 * claims vendors make. The three proof points below are all verifiable. */
export function renderLandingHTML() {
  return page(
    "Botlien · Find out whether your robots are covering their lease",
    `<div class="wrap">
  <div class="hero">
    ${MARK}
    <h1>Find out whether your robots are covering their lease.</h1>
    <p class="lede">Drop in the usage export you already have. Botlien values the work your
      robots actually performed against what you pay to lease them, and shows the arithmetic
      behind every figure.</p>
    <a class="cta" href="/signin">Start free</a>
    <a class="second" href="/signin?demo=1">Running robots across five or more sites? Book a walkthrough.</a>
  </div>
  <div class="proof">
    <div><b>Works with the export you already have</b>A Bear Universe or Pudu Cloud CSV is enough to get a statement.</div>
    <div><b>Every figure shows its arithmetic</b>No score, no index, no black box. The division is on the page.</div>
    <div><b>No vendor credentials needed to start</b>API access is the upgrade, not the first step.</div>
  </div>
  <footer>Botlien · collateral risk monitoring for financed and leased service robots</footer>
</div>`,
  );
}

/**
 * The sign-in screen. `variant` picks the framing:
 *   "signin"  returning owner
 *   "new"     first visit, arrived from Start free
 *   "failed"  the mailer rejected the send
 *   "signedout" just signed out
 */
export function renderSignInHTML({ variant = "signin", email = "", error = null } = {}) {
  const heading = variant === "new" ? "Start with your usage export" : "Sign in";
  const lede =
    variant === "new"
      ? "Enter your email and we&#39;ll send you a link to get started. No card. Nothing is charged until you choose a paid plan."
      : "Welcome back. Sign in to your statement.";

  const banner = variant === "signedout" ? `<div class="ok">Signed out.</div>` : "";
  const errLine = error ? `<div class="err">${esc(error)}</div>` : "";
  const failNote =
    variant === "failed"
      ? `<div class="note">We couldn&#39;t send that email. Try again, or write to
         <a href="mailto:info@botlien.com" style="font-weight:600">info@botlien.com</a>.</div>`
      : "";

  return page(
    "Botlien · Sign in",
    `<div class="auth-shell"><div class="auth">
  ${banner}${MARK}
  <h1>${heading}</h1>
  <p class="lede">${lede}</p>
  <form method="post" action="/signin">
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email"
        placeholder="you@company.com" value="${esc(email)}" required autofocus>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password"
        placeholder="••••••••••">
    </div>
    ${errLine}
    <button class="btn" type="submit">Sign in</button>
    <!-- Also the "forgot my password" path, which is why there is no separate
         reset link: submitting with the password cleared is what gate.mjs
         reads as "email me a link instead", and a link signs you in without
         one. formnovalidate so the browser does not demand the field this is
         deliberately skipping. -->
    <button class="alt" type="submit" formnovalidate
      onclick="document.getElementById('password').value=''">Email me a sign-in link instead</button>
  </form>
  ${failNote}
  <p class="fine">By signing in you agree we may store the usage data you upload in order to
    produce your statement. You can delete your account and its data at any time.</p>
</div></div>`,
  );
}

/** Shown after a link is sent. Never reveals whether the address has an
 * account: the same screen appears either way, so this page cannot be used to
 * enumerate customers. */
export function renderCheckEmailHTML({ email = "", devLink = null, resent = false } = {}) {
  const dev = devLink
    ? `<div class="note"><b>Development mode.</b> No mail provider is configured, so the link is
       here instead: <a href="${esc(devLink)}">sign in</a>.</div>`
    : "";
  return page(
    "Botlien · Check your email",
    `<div class="auth-shell"><div class="auth">
  ${resent ? `<div class="ok">Sent again.</div>` : ""}
  ${MARK}
  <h1>Check your email</h1>
  <p class="lede">We sent a link to
    <b style="font-weight:600;color:var(--fg1)">${esc(email)}</b>.
    It works once and expires in 15 minutes.</p>
  ${dev}
  <div class="row">
    <form method="post" action="/signin">
      <input type="hidden" name="email" value="${esc(email)}">
      <button class="ghost" type="submit">Resend</button>
    </form>
    <a class="ghost" href="/signin" style="border-color:transparent;color:var(--fg2)">Use a different email</a>
  </div>
</div></div>`,
  );
}

/** Every way a link can fail to sign someone in. Each reason gets its own
 * sentence, because "that didn't work" tells an owner nothing about whether to
 * click the older email in their inbox or ask for a new one. */
const LINK_FAILURES = {
  expired: [
    "That link has expired",
    "Sign-in links last 15 minutes. Ask for a fresh one and it will work.",
  ],
  used: [
    "That link was already used",
    "Each link signs you in once. Ask for a new one below.",
  ],
  unknown: [
    "That link is not valid",
    "It may have been cut short by your email client. Ask for a new one below.",
  ],
};

export function renderLinkFailedHTML(reason = "unknown") {
  const [heading, lede] = LINK_FAILURES[reason] ?? LINK_FAILURES.unknown;
  return page(
    "Botlien · Sign in",
    `<div class="auth-shell"><div class="auth">
  ${MARK}
  <h1>${esc(heading)}</h1>
  <p class="lede">${esc(lede)}</p>
  <a class="cta" href="/signin" style="display:inline-block">Email me a new link</a>
</div></div>`,
  );
}

export function renderRateLimitedHTML(email = "") {
  return page(
    "Botlien · Sign in",
    `<div class="auth-shell"><div class="auth">
  ${MARK}
  <h1>Too many links</h1>
  <p class="lede">We have already sent several sign-in links to
    <b style="font-weight:600;color:var(--fg1)">${esc(email)}</b> in the last hour.
    Check your inbox and spam folder, then try again later, or write to
    <a href="mailto:info@botlien.com" style="font-weight:600">info@botlien.com</a>.</p>
</div></div>`,
  );
}
