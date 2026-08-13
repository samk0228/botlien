function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** HTML-escape, because every value below is attacker-controlled and lands in
 * the HTML half of an email we send ourselves. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Header injection guard. A newline in a value that reaches a header (the
 * subject, or reply_to) could add headers of its own, so they are flattened
 * to spaces before use. */
function oneLine(s) {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim();
}

const LEAD_TO = "contact@botlien.com";
const LEAD_FROM = "Botlien Site <info@botlien.com>";

/** An inquiry from the "Let's talk" form. Emailed rather than stored: there
 * is no funnel tooling to feed yet, and an inquiry that lands in an inbox
 * gets answered, where a row in a table has to be remembered. Reply-To is the
 * prospect, so answering is a plain reply. */
async function handleLead(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = String(body.name || "").trim().slice(0, 200);
  const company = String(body.company || "").trim().slice(0, 200);
  const email = String(body.email || "").trim().slice(0, 200);
  // Optional: a number is a nice-to-have, and demanding one costs more
  // inquiries than it is worth at the top of the funnel.
  const phone = String(body.phone || "").trim().slice(0, 60);
  const message = String(body.message || "").trim().slice(0, 5000);

  if (!name || !company || !email || !isValidEmail(email)) {
    return Response.json({ error: "Missing or invalid fields." }, { status: 400 });
  }

  if (!env.RESEND_API_KEY) {
    return Response.json({ error: "Not configured." }, { status: 500 });
  }

  const subject = oneLine(`New inquiry — ${name}, ${company}`).slice(0, 200);
  const rows = [
    ["Name", name],
    ["Company", company],
    ["Email", email],
    ["Phone", phone || "not given"],
  ];

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nMessage:\n${message || "(none)"}\n`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A">` +
    `<h2 style="font-size:17px;margin:0 0 14px">New inquiry from botlien.com</h2>` +
    `<table style="border-collapse:collapse;margin-bottom:18px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#58585F">${esc(k)}</td>` +
          `<td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`,
      )
      .join("") +
    `</table>` +
    `<div style="color:#58585F;margin-bottom:6px">Message</div>` +
    `<div style="white-space:pre-wrap;padding:12px 14px;background:#F7F7F8;border-radius:6px">` +
    `${esc(message) || "<i style='color:#8B8B93'>(none)</i>"}</div></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: LEAD_FROM,
      to: [LEAD_TO],
      reply_to: oneLine(email),
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    return Response.json({ error: "Could not send submission." }, { status: 502 });
  }

  return Response.json({ ok: true });
}

// Isolated preview of the polished-UI prototype, a separate static Fly app
// with no server logic or account data of its own. Proxied here (rather
// than a DNS-level redirect) so it reads as botlien.com/software instead of
// bouncing the visitor to a .fly.dev URL.
async function handleSoftwarePreview(request) {
  const url = new URL(request.url);
  const upstream = new URL(url.pathname.replace(/^\/software/, "") || "/", "https://botlien-ui-preview.fly.dev");
  upstream.search = url.search;
  const response = await fetch(upstream.toString(), { headers: request.headers });
  const headers = new Headers(response.headers);
  headers.delete("content-security-policy");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Public, no-account demo: same isolated Fly app as /software above, same
// mock data. Boots straight into a populated Dashboard with Settings
// blocked (see S.demoMode in the prototype). That flag is normally read
// from '?demo=1' in the page's own URL, but this is a server-side proxy:
// appending demo=1 to the upstream fetch only affects what THIS WORKER
// requests from Fly, it never touches the visitor's own address bar, so
// the prototype's client-side `location.search` check would always see a
// plain, empty '/demo' and never find it. Injecting a global flag into the
// HTML itself is what actually crosses that gap, this is the one thing
// that makes the route work, everything else about it is decorative.
async function handleDemoPreview(request) {
  const url = new URL(request.url);
  const upstream = new URL(url.pathname.replace(/^\/demo/, "") || "/", "https://botlien-ui-preview.fly.dev");
  upstream.search = url.search;
  const response = await fetch(upstream.toString(), { headers: request.headers });
  const headers = new Headers(response.headers);
  headers.delete("content-security-policy");
  const contentType = headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const html = await response.text();
  const injected = html.includes("<head>")
    ? html.replace("<head>", "<head><script>window.__botlienDemo=true;</script>")
    : "<script>window.__botlienDemo=true;</script>" + html;
  headers.delete("content-length");
  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }

    if (url.pathname === "/software" || url.pathname.startsWith("/software/")) {
      return handleSoftwarePreview(request);
    }

    if (url.pathname === "/demo" || url.pathname.startsWith("/demo/")) {
      return handleDemoPreview(request);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
