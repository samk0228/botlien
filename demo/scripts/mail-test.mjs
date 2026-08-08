// Does mail actually leave this machine? Run via `npm run mail-test -- you@example.com`.
//
// Sign-in is a magic link, so a mail misconfiguration presents as "the product
// is broken" with nothing in any log that says why. This answers the question
// directly and in isolation: no server, no database, no browser, no sign-in
// flow. If this passes and sign-in still does not arrive, the problem is not
// the mailer.
import { createMailer } from "../src/mailer.mjs";
import { loadSecrets } from "../src/infra.mjs";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("usage: npm run mail-test -- you@example.com");
  process.exit(2);
}

const secrets = loadSecrets();
const mailer = createMailer({ secrets, logPath: null });

const from = process.env.BOTLIEN_MAIL_FROM ?? secrets.resend?.from ?? "Botlien <info@botlien.com>";
console.log(`backend : ${mailer.kind}`);
console.log(`from    : ${from}`);
console.log(`to      : ${to}\n`);

if (mailer.kind === "console") {
  console.error(
    "FAIL  No API key, so nothing can be delivered to an inbox.\n" +
      "      Set resend.api_key in .claude/secrets.local.json, or RESEND_API_KEY.\n" +
      "      Sign-in still works meanwhile: the link prints to data/sent-mail.log\n" +
      "      and onto the check-your-email page itself.",
  );
  process.exit(1);
}

const res = await mailer.send({
  to,
  subject: "Botlien mail test",
  text: "If you are reading this in your inbox, Botlien can send sign-in links.\n",
});

if (!res.ok) {
  console.error(`FAIL  ${res.error}\n`);
  // The status is the useful part, so say what each one means rather than
  // making the reader map an HTTP code onto a setup step.
  if (res.error.includes("401")) {
    console.error(
      "      401: the key itself is wrong. Copy it again from Resend > API Keys.\n" +
        "      A key is shown once at creation and cannot be read back later.",
    );
  } else if (res.error.includes("403")) {
    console.error(
      `      403: Resend has not verified the domain in "${from}", so it will only\n` +
        "      deliver to the address that owns the Resend account. Finish domain\n" +
        "      verification, or test by sending to yourself.",
    );
  } else if (res.error.startsWith("network:")) {
    console.error("      Never reached Resend. Check the network, then api.resend.com status.");
  }
  process.exit(1);
}

console.log(`PASS  accepted by Resend, id ${res.id ?? "(none returned)"}`);
console.log(
  "\nAccepted is not the same as delivered. Check the inbox, then spam. A brand\n" +
    "new sending domain has no reputation, so the first few can land in spam even\n" +
    "with DKIM and SPF passing.",
);
