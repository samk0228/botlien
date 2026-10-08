import { test } from "node:test";
import assert from "node:assert/strict";
import { linkEmail, inviteEmail } from "../src/mailer.mjs";

test("sign-in and invite emails carry the link as a clickable button and link, with the plain text kept", () => {
  const url = "https://app.botlien.com/signin/abc_DEF-123";
  for (const m of [linkEmail({ url }), inviteEmail({ url, signinUrl: "https://app.botlien.com/signin", invitedBy: "sam@linelab.io", role: "technician" })]) {
    assert.ok(m.text.includes(url), "plain text still has the link");
    assert.equal((m.html.match(new RegExp(`href="${url}"`, "g")) || []).length, 2, "a button and a link");
    assert.doesNotMatch(m.html, /<img|<script|https?:\/\/(?!app\.botlien\.com)/, "no images, scripts or outside resources");
  }
  assert.match(linkEmail({ url: 'https://x.test/signin/"><b>' }).html, /&quot;&gt;&lt;b&gt;/, "the link is escaped");
});
