// Public routing: the front door, the sign-in screens, and the session gate.
//
// Kept out of board.mjs so the ops board stays what it is, and so the rules
// about who may see what live in one readable file rather than scattered
// through a router. Everything here is either unauthenticated by design (the
// landing page, the sign-in form) or the act of becoming authenticated.
import {
  requestLink,
  redeemLink,
  currentAccount,
  signOut,
  sessionCookie,
  clearCookie,
} from "./auth.mjs";
import { linkEmail } from "./mailer.mjs";
import {
  renderLandingHTML,
  renderSignInHTML,
  renderCheckEmailHTML,
  renderLinkFailedHTML,
  renderRateLimitedHTML,
} from "./site.mjs";

const HTML = { "Content-Type": "text/html; charset=utf-8" };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...HTML, ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

async function formBody(req, readBody) {
  try {
    return new URLSearchParams(await readBody(req));
  } catch {
    return null;
  }
}

/**
 * Handle a public route. Returns true if the response was written.
 *
 * `ctx` carries: control, mailer, baseUrl, secureCookies, now(), readBody,
 * and an optional onEvent(name, payload) so instrumentation stays out of here.
 */
export async function handlePublicRoute(req, res, path, ctx) {
  const { control, mailer, baseUrl, secureCookies, now, readBody, onEvent = () => {} } = ctx;
  const query = new URL(req.url ?? "/", "http://placeholder").searchParams;

  // ---- S0, the front door ----
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    // An owner who already has a session should not be sold to again.
    if (currentAccount(control, req.headers.cookie, now())) {
      redirect(res, "/owner");
      return true;
    }
    onEvent("landed", {});
    send(res, 200, renderLandingHTML());
    return true;
  }

  // ---- the sign-in form ----
  if (req.method === "GET" && path === "/signin") {
    const variant = query.has("signedout") ? "signedout" : query.has("new") ? "new" : "signin";
    send(res, 200, renderSignInHTML({ variant }));
    return true;
  }

  // ---- asking for a link ----
  if (req.method === "POST" && path === "/signin") {
    const form = await formBody(req, readBody);
    if (form === null) {
      send(res, 413, renderSignInHTML({ error: "That was too large to read. Try again." }));
      return true;
    }
    const email = (form.get("email") ?? "").trim();
    const out = requestLink(control, email, now());

    if (!out.ok && out.reason === "invalid_email") {
      send(res, 400, renderSignInHTML({ email, error: "That does not look like an email address." }));
      return true;
    }
    if (!out.ok && out.reason === "rate_limited") {
      // 429 so a script sees the refusal; the page explains it in words.
      send(res, 429, renderRateLimitedHTML(email));
      return true;
    }

    const url = `${baseUrl}/signin/${out.token}`;
    const sent = await mailer.send({ to: out.email, ...linkEmail({ url }) });
    if (!sent.ok) {
      send(res, 502, renderSignInHTML({ variant: "failed", email }));
      return true;
    }

    // Without a mail provider the link is shown on the page instead. This is
    // what makes sign-in work on a laptop with no Resend account, and it is
    // gated on the mailer having actually not delivered, never on a flag
    // somebody could forget to turn off in production.
    send(
      res,
      200,
      renderCheckEmailHTML({
        email: out.email,
        devLink: sent.delivered ? null : url,
        resent: form.has("resent"),
      }),
    );
    return true;
  }

  // ---- redeeming a link ----
  if (req.method === "GET" && path.startsWith("/signin/")) {
    const token = decodeURIComponent(path.slice("/signin/".length));
    const out = redeemLink(control, token, now(), {
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 200),
    });
    if (!out.ok) {
      send(res, 400, renderLinkFailedHTML(out.reason));
      return true;
    }
    if (out.created) onEvent("account_created", { accountId: out.account.id });
    redirect(res, "/owner", {
      "Set-Cookie": sessionCookie(out.sessionToken, { secure: secureCookies }),
    });
    return true;
  }

  // ---- signing out ----
  // POST only. A GET sign-out is a logout-CSRF: a top-level navigation to
  // /signout carries the SameSite=Lax cookie, so a crafted link would sign an
  // owner out. The rail's sign-out control already POSTs, so nothing legitimate
  // reaches this on a GET.
  if (path === "/signout" && req.method === "POST") {
    signOut(control, req.headers.cookie);
    redirect(res, "/signin?signedout=1", {
      "Set-Cookie": clearCookie({ secure: secureCookies }),
    });
    return true;
  }

  return false;
}

/** Paths that require a session. Everything owner-facing, plus the ops board
 * and its JSON: those read the operator's own connector-fed fleet, and while
 * that store is empty until vendor credentials exist, a "ours, not a
 * customer's" view has no business answering an anonymous request. Gating it
 * here means the moment a connector lands, robot keys, positions and flags are
 * already behind a login rather than one deploy away from being exposed. */
export function requiresSession(path) {
  return (
    path === "/owner" ||
    path.startsWith("/owner/") ||
    path === "/api/owner" ||
    path === "/ops" ||
    path === "/api/state"
  );
}
