function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
  const phone = String(body.phone || "").trim().slice(0, 60);

  if (!name || !company || !email || !phone || !isValidEmail(email)) {
    return Response.json({ error: "Missing or invalid fields." }, { status: 400 });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return Response.json({ error: "Not configured." }, { status: 500 });
  }

  const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/Contact%20Information%20Via%20Website`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_SECRET_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      "Name": name,
      "Company Name": company,
      "Company Email": email,
      "Number": phone
    })
  });

  if (!supabaseRes.ok) {
    return Response.json({ error: "Could not save submission." }, { status: 502 });
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }

    if (url.pathname === "/software" || url.pathname.startsWith("/software/")) {
      return handleSoftwarePreview(request);
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
