// Sending the sign-in link.
//
// Two backends. With an API key it posts to Resend; without one it writes the
// link to a file and logs it. The fallback is not a stub to be replaced later:
// it is how the whole sign-in flow gets developed and tested without an
// account, a domain, or DNS records, and it is what makes `npm start` on a
// laptop a working product rather than a dead form.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Plain text only. A magic-link email has one job and every image, tracking
 * pixel and multipart boundary in it is another reason to land in spam. */
export function linkEmail({ url, expiresMinutes = 15 }) {
  return {
    subject: "Your Botlien sign-in link",
    text: [
      "Here is your sign-in link:",
      "",
      url,
      "",
      `It works once and expires in ${expiresMinutes} minutes.`,
      "",
      "If you did not ask for this, you can ignore this email. Nobody can sign",
      "in without the link above.",
    ].join("\n"),
  };
}

/** Writes the link where a developer will actually see it. Returns the same
 * shape as the live sender so no caller has to branch on which one is active. */
export function createConsoleMailer({ logPath = null, log = console.log } = {}) {
  return {
    kind: "console",
    async send({ to, subject, text }) {
      const line = `\n--- ${new Date().toISOString()} to ${to}\n${subject}\n${text}\n`;
      if (logPath) {
        try {
          mkdirSync(dirname(logPath), { recursive: true });
          appendFileSync(logPath, line);
        } catch {
          /* logging the link must never fail sign-in */
        }
      }
      log(line);
      return { ok: true, id: null, delivered: false };
    },
  };
}

/** Resend. Any non-2xx is returned as {ok:false} with the body text rather than
 * thrown, because the caller has a designed screen for a failed send and an
 * unhandled rejection here would show a 500 instead. */
export function createResendMailer({ apiKey, from, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("resend mailer requires an api key");
  if (!from) throw new Error("resend mailer requires a from address");
  return {
    kind: "resend",
    async send({ to, subject, text }) {
      let res;
      try {
        res = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
      } catch (err) {
        return { ok: false, error: `network: ${err?.message ?? String(err)}` };
      }
      if (!res.ok) {
        let body = "";
        try {
          body = (await res.text()).slice(0, 300);
        } catch {
          /* body is a nicety, the status is the signal */
        }
        return { ok: false, error: `resend ${res.status}: ${body}` };
      }
      let id = null;
      try {
        id = (await res.json())?.id ?? null;
      } catch {
        /* a 2xx without a parseable body still means it was accepted */
      }
      return { ok: true, id, delivered: true };
    },
  };
}

/** Picks a backend from secrets and environment. Falls back to console rather
 * than throwing on missing credentials: a laptop with no Resend key should run
 * the product, not refuse to boot. */
export function createMailer({ secrets = {}, env = process.env, logPath = null } = {}) {
  const apiKey = env.RESEND_API_KEY ?? secrets.resend?.api_key ?? null;
  const from = env.BOTLIEN_MAIL_FROM ?? secrets.resend?.from ?? "Botlien <info@botlien.com>";
  if (!apiKey) return createConsoleMailer({ logPath });
  return createResendMailer({ apiKey, from });
}
