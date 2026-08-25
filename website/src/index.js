import {
  handleStats,
  handleStatsLogin,
  handleStatsApi,
  handleEventIngest,
  recordEvent,
  BEACON,
} from "./stats.js";

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

const LEAD_TO = "info@botlien.com";
const LEAD_FROM = "Botlien Site <info@botlien.com>";

/** An inquiry from the "Let's talk" form. Emailed rather than stored: there
 * is no funnel tooling to feed yet, and an inquiry that lands in an inbox
 * gets answered, where a row in a table has to be remembered. Reply-To is the
 * prospect, so answering is a plain reply. */
async function handleLead(request, env, ctx) {
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

  // Only now, with the message actually accepted, does this count as a lead.
  recordEvent(env, ctx, request, "lead_submit", {
    session: body.session,
    label: company,
    path: "/",
  });

  return Response.json({ ok: true });
}

function applySecurityHeaders(headers) {
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env, ctx);
    }

    // Analytics. /stats is the internal dashboard, /api/event is the public
    // beacon endpoint the pages post to.
    if (url.pathname === "/api/event" && request.method === "POST") {
      return handleEventIngest(request, env);
    }
    if (url.pathname === "/stats/login" && request.method === "POST") {
      return handleStatsLogin(request, env);
    }
    if (url.pathname === "/stats/api") {
      return handleStatsApi(request, env);
    }
    if (url.pathname === "/stats" || url.pathname === "/stats/") {
      return handleStats(request, env);
    }

    // The prototype is no longer served to the open internet. It is shown on a
    // live call, or reached through a signed-in account. Old links land on the
    // sign-in page rather than dead-ending on a 404.
    if (
      url.pathname === "/software" || url.pathname.startsWith("/software/") ||
      url.pathname === "/demo" || url.pathname.startsWith("/demo/")
    ) {
      return Response.redirect("https://app.botlien.com/signin", 302);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    // Beacon goes on the marketing pages too, so a visit can be tied to the
    // demo open that follows it. Only HTML: never rewrite an image or a font.
    const isHtml = (headers.get("content-type") || "").includes("text/html");
    if (isHtml) {
      const page = await response.text();
      headers.delete("content-length");
      const withBeacon = page.includes("</body>")
        ? page.replace("</body>", BEACON + "</body>")
        : page + BEACON;
      applySecurityHeaders(headers);
      return new Response(withBeacon, { status: response.status, statusText: response.statusText, headers });
    }
    applySecurityHeaders(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
