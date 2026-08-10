// Public routing: the front door, the sign-in screens, and the session gate.
//
// Kept out of board.mjs so the ops board stays what it is, and so the rules
// about who may see what live in one readable file rather than scattered
// through a router. Everything here is either unauthenticated by design (the
// landing page, the sign-in form) or the act of becoming authenticated.
import {
  requestLink,
  redeemLink,
  signInVerifiedEmail,
  currentAccount,
  signOut,
  sessionCookie,
  clearCookie,
  parseCookies,
} from "./auth.mjs";
import { linkEmail } from "./mailer.mjs";
import {
  renderLandingHTML,
  renderSignInHTML,
  renderCheckEmailHTML,
  renderLinkFailedHTML,
  renderRateLimitedHTML,
} from "./site.mjs";
import {
  OAUTH_STATE_COOKIE,
  newState,
  buildAuthorizeUrl,
  oauthStateCookie,
  clearOauthStateCookie,
  validState,
  exchangeCode,
  fetchVerifiedEmail,
} from "./oauth.mjs";

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
  const { control, mailer, baseUrl, secureCookies, now, readBody, oauthProviders = {}, oauthFetch = fetch, onEvent = () => {} } = ctx;
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
    const oauthError = query.get("oauth_error");
    send(res, 200, renderSignInHTML({ variant, providers: Object.values(oauthProviders), error: oauthError }));
    return true;
  }

  // ---- starting an OAuth sign-in ----
  if (req.method === "GET" && path.startsWith("/auth/") && path.endsWith("/start")) {
    const providerId = path.slice("/auth/".length, -"/start".length);
    const provider = oauthProviders[providerId];
    if (!provider) {
      send(res, 404, renderSignInHTML({ error: "That sign-in option is not available." }));
      return true;
    }
    const state = newState(providerId);
    redirect(res, buildAuthorizeUrl(provider, { state, baseUrl }), {
      "Set-Cookie": oauthStateCookie(state, { secure: secureCookies }),
    });
    return true;
  }

  // ---- returning from a provider's consent screen ----
  if (req.method === "GET" && path.startsWith("/auth/") && path.endsWith("/callback")) {
    const providerId = path.slice("/auth/".length, -"/callback".length);
    const provider = oauthProviders[providerId];
    const clearState = { "Set-Cookie": clearOauthStateCookie({ secure: secureCookies }) };

    // The consent screen itself can come back negative (the owner clicked
    // Cancel), which is not an error worth logging, just a "try again".
    if (query.get("error")) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent(`Sign-in with ${provider?.label ?? providerId} was cancelled.`), clearState);
      return true;
    }
    if (!provider) {
      send(res, 404, renderSignInHTML({ error: "That sign-in option is not available." }));
      return true;
    }

    const cookieState = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE];
    const queryState = query.get("state");
    if (!validState({ providerId, cookieState, queryState })) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent("That sign-in link expired or was already used. Try again."), clearState);
      return true;
    }

    const code = query.get("code");
    if (!code) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent(`${provider.label} did not return an authorization code.`), clearState);
      return true;
    }

    // exchangeCode/fetchVerifiedEmail return {ok:false, error} rather than
    // throwing (see oauth.mjs); the error string is deliberately not shown to
    // the owner or logged anywhere here, same as a failed mailer.send above,
    // the designed screen is the interface, not a log line.
    const tokenOut = await exchangeCode(provider, { code, baseUrl, fetchImpl: oauthFetch });
    if (!tokenOut.ok) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent(`We could not complete sign-in with ${provider.label}. Try again, or use your email instead.`), clearState);
      return true;
    }

    const emailOut = await fetchVerifiedEmail(provider, { accessToken: tokenOut.accessToken, fetchImpl: oauthFetch });
    if (!emailOut.ok) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent(`${provider.label} did not return a verified email address. Try email sign-in instead.`), clearState);
      return true;
    }

    const out = signInVerifiedEmail(control, emailOut.email, now(), {
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 200),
    });
    if (!out.ok) {
      redirect(res, "/signin?oauth_error=" + encodeURIComponent("That does not look like a usable email address."), clearState);
      return true;
    }
    if (out.created) onEvent("account_created", { accountId: out.account.id, detail: { via: provider.id } });
    redirect(res, "/owner", {
      "Set-Cookie": [sessionCookie(out.sessionToken, { secure: secureCookies }), clearOauthStateCookie({ secure: secureCookies })],
    });
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
  if (path === "/signout" && (req.method === "POST" || req.method === "GET")) {
    signOut(control, req.headers.cookie);
    redirect(res, "/signin?signedout=1", {
      "Set-Cookie": clearCookie({ secure: secureCookies }),
    });
    return true;
  }

  return false;
}

/** Paths that require a session. Everything owner-facing; the ops board is
 * gated separately because it is ours, not a customer's. */
export function requiresSession(path) {
  return path === "/owner" || path.startsWith("/owner/") || path === "/api/owner";
}
