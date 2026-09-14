// Botlien deployment runbook.
#let fg1 = rgb("#16204A")
#let fg2 = rgb("#5B6486")
#let fg3 = rgb("#8B93B0")
#let wash = rgb("#F4F5FC")
#let hair = rgb("#DDE0EE")
#let hair2 = rgb("#C3C8DE")
#let ink = rgb("#0A0A0A")
#let warnbg = rgb("#FFF8EA")
#let warnline = rgb("#E8D3A8")
#let warnfg = rgb("#8A5A00")

#let sans = ("Helvetica Neue", "Helvetica", "Arial")
#let mono = ("Menlo", "DejaVu Sans Mono")

#set page(
  paper: "us-letter",
  margin: (x: 16mm, top: 16mm, bottom: 18mm),
  footer: context {
    set text(7pt, fill: fg3, font: sans)
    grid(
      columns: (1fr, auto),
      align(left)[Botlien deployment runbook · commit 318e2fd],
      align(right)[#counter(page).display("1") / #counter(page).final().first()],
    )
  },
)

#set text(font: sans, size: 9.5pt, fill: fg1)
#set par(justify: false, leading: 0.62em, spacing: 0.85em)

// ---------- helpers ----------
#let ic(s) = box(
  fill: wash, stroke: 0.5pt + hair, radius: 1.5pt,
  inset: (x: 2.5pt, y: 1pt), outset: (y: 1.5pt),
  text(8pt, font: mono, fill: fg1, s),
)

#let code(s) = block(
  width: 100%, fill: wash,
  stroke: (left: 2pt + fg1, rest: 0.5pt + hair),
  radius: 2pt, inset: (x: 9pt, y: 7pt), above: 6pt, below: 6pt,
  breakable: false,
  text(8.2pt, font: mono, fill: fg1, raw(s)),
)

#let badge(kind) = {
  let isyou = kind == "you"
  box(
    fill: if isyou { ink } else { rgb("#E7EAF7") },
    radius: 2pt, inset: (x: 4.5pt, y: 1.8pt), baseline: 1.5pt,
    text(6.5pt, weight: 700, tracking: 0.6pt,
      fill: if isyou { white } else { rgb("#3D4771") },
      upper(kind)),
  )
}

#let note(body) = block(above: 4pt, below: 0pt, text(8.6pt, fill: fg2, body))

#let step(num, title, kind, body) = block(
  width: 100%, breakable: false, above: 9pt, below: 9pt,
  grid(
    columns: (20pt, 13pt, 1fr), column-gutter: 7pt, align: top,
    align(right + top, text(7.5pt, weight: 700, fill: fg3, num)),
    box(width: 9pt, height: 9pt, radius: 1.5pt, stroke: 0.7pt + hair2),
    {
      block(above: 0pt, below: 0pt)[
        #text(9.5pt, weight: 600, title) #h(3pt) #badge(kind)
      ]
      body
    },
  ),
)

#let sect(num, title) = {
  block(above: 18pt, below: 7pt, breakable: false)[
    #line(length: 100%, stroke: 0.5pt + hair)
    #v(7pt)
    #text(12.5pt, weight: 700, fill: fg3, num)
    #h(6pt)
    #text(12.5pt, weight: 700, fill: fg1, title)
  ]
}

#let callout(body) = block(
  width: 100%, fill: warnbg, stroke: 0.6pt + warnline, radius: 2pt,
  inset: (x: 10pt, y: 8pt), above: 10pt, below: 10pt,
  text(8.6pt, body),
)

#let boxed(label, body) = block(
  width: 100%, stroke: 0.9pt + ink, radius: 2pt,
  inset: (x: 10pt, y: 8pt), above: 10pt, below: 10pt,
)[
  #text(7.2pt, weight: 700, tracking: 0.7pt, upper(label))
  #v(3pt)
  #text(8.6pt, body)
]

#let hdr(s) = text(7pt, weight: 700, tracking: 0.7pt, fill: fg3, upper(s))

#let tbl(cols, ..cells) = block(above: 8pt, below: 8pt)[
  #table(
    columns: cols,
    stroke: (x, y) => (
      bottom: if y == 0 { 1pt + hair2 } else { 0.5pt + hair },
    ),
    inset: (x: 0pt, y: 5.5pt),
    column-gutter: 9pt,
    align: top,
    ..cells
  )
]

// ---------- masthead ----------
#block(below: 0pt)[
  #text(8.5pt, weight: 700, tracking: 1.4pt, fill: fg3, "BOTLIEN")
  #v(9pt)
  #text(25pt, weight: 700, fill: fg1, "Deployment Runbook")
  #v(4pt)
  #text(11pt, fill: fg2)[Shipping the login page and dashboard to #text(fill: fg1, weight: 700, "app.botlien.com")]
  #v(10pt)
  #text(8pt, fill: fg3)[
    #text(weight: 700, fill: fg1, "Date") August 10, 2026 #h(16pt)
    #text(weight: 700, fill: fg1, "Repo") samk0228/botlien #h(16pt)
    #text(weight: 700, fill: fg1, "Commit") 318e2fd #h(16pt)
    #text(weight: 700, fill: fg1, "Version") 0.1.0
  ]
  #v(9pt)
  #line(length: 100%, stroke: 1.6pt + ink)
]

#v(10pt)
#text(12.5pt, weight: 700, "What you are deploying")

#note[
  The app is already written, containerized and configured. Nothing in this
  runbook changes code. It creates the accounts and infrastructure the existing
  configuration expects.
]

#tbl(
  (auto, 1fr, 1.25fr),
  hdr("Piece"), hdr("What it is"), hdr("Status"),
  text(8.8pt)[*Application*], text(8.8pt)[Node 22 ESM, no framework, server-rendered], text(8.8pt)[Built. 213 tests passing.],
  text(8.8pt)[*Database*], text(8.8pt)[SQLite via #ic("node:sqlite"), one file per business], text(8.8pt)[Built. No external service needed.],
  text(8.8pt)[*Sign-in*], text(8.8pt)[Magic link, no passwords stored anywhere], text(8.8pt)[Built. Needs a mail credential.],
  text(8.8pt)[*Container*], text(8.8pt)[#ic("Dockerfile"), pinned #ic("node:22.22-slim")], text(8.8pt)[Written and committed.],
  text(8.8pt)[*Host config*], text(8.8pt)[#ic("fly.toml"), single machine, #ic("sjc"), volume at #ic("/data")], text(8.8pt)[Written and committed.],
)

#v(4pt)
#text(9.5pt, weight: 700, "Accounts to create before starting")

#tbl(
  (auto, auto, 1.5fr),
  hdr("Service"), hdr("URL"), hdr("Purpose and cost"),
  text(8.8pt)[*Fly.io*], text(8.8pt)[fly.io/app/sign-up], text(8.8pt)[Runs the container, holds the disk. Roughly \$5 to \$8 a month. Card required.],
  text(8.8pt)[*Resend*], text(8.8pt)[resend.com], text(8.8pt)[Delivers sign-in email. Free tier covers a pilot.],
  text(8.8pt)[*Cloudflare*], text(8.8pt)[already yours], text(8.8pt)[DNS for botlien.com. No new account, no cost.],
)

#boxed("Ordering note")[
  DNS propagation, certificate issuance and Resend domain verification all
  involve waiting. None of them depend on the UI being finished. Start this
  runbook while design work continues.
]

// ---------- 0 ----------
#sect("0", "Pre-flight")

#step("0.1", "Confirm a clean, tested, pushed tree", "cli")[
  #code("cd ~/Projects/botlien
npm test        # expect: 213 pass, 0 fail
git status      # expect: clean
git push")
]

// ---------- 1 ----------
#sect("1", "Accounts")

#step("1.1", "Create the Fly.io account", "you")[
  #note[Go to fly.io/app/sign-up and add a payment card. Fly requires one even on the lowest tier.]
]

#step("1.2", "Create the Resend account and an API key", "you")[
  #note[Go to resend.com and create an API key. It looks like #ic("re_...") and is shown exactly once. Save it before closing the tab.]
]

// ---------- 2 ----------
#sect("2", "Install and authenticate")

#step("2.1", "Install the Fly CLI", "cli")[
  #code("brew install flyctl")
]

#step("2.2", "Log in", "you")[
  #code("fly auth login")
  #note[This opens a browser window for authentication.]
]

// ---------- 3 ----------
#sect("3", "Create the app and its disk")

#step("3.1", "Create the Fly app", "cli")[
  #code("fly apps create botlien")
  #note[
    If the name is taken globally this fails. Pick another, such as
    #ic("botlien-app"), and change the #ic("app =") line in #ic("fly.toml") to
    match. The public address comes from your own domain either way, so the Fly
    app name is never customer-facing.
  ]
]

#step("3.2", "Create the persistent volume", "cli")[
  #code("fly volumes create botlien_data --region sjc --size 1")
  #note[
    Name and region must match #ic("fly.toml"). 1GB holds roughly a hundred
    accounts at observed sizes, and expands later without downtime.
  ]
]

#step("3.3", "Set the mail secret", "cli")[
  #code("fly secrets set RESEND_API_KEY=re_xxxxxxxxxxxx")
  #note[
    Fly stores this encrypted and injects it at boot, so the key never enters
    the repository. #ic("BOTLIEN_BASE_URL") and #ic("BOTLIEN_SECURE_COOKIES")
    are already in #ic("fly.toml") and need no action.
  ]
]

// ---------- 4 ----------
#sect("4", "First deploy")

#step("4.1", "Deploy", "cli")[
  #code("fly deploy")
  #note[
    Fly uploads the build context, builds the Dockerfile on their machines, and
    boots one machine. Docker is not required locally.
  ]
]

#step("4.2", "Watch it boot", "cli")[
  #code("fly logs")
]

#step("4.3", "Confirm the machine answers", "cli")[
  #code("curl -i https://botlien.fly.dev/health")
  #note[
    Expect HTTP 200. This route is answered before the session check
    specifically so it returns 200 without a cookie.
  ]
]

#callout[
  #text(weight: 700, fill: warnfg, "Do not test sign-in yet.")
  #ic("BOTLIEN_BASE_URL") is set to #ic("https://app.botlien.com"), which does
  not resolve until the next phase. Any magic link sent now points at a dead
  address. Finish the domain first.
]

// ---------- 5 ----------
#sect("5", "Point app.botlien.com at it")

#step("5.1", "Get the machine's public addresses", "cli")[
  #code("fly ips list")
]

#step("5.2", "Add two DNS records in Cloudflare", "you")[
  #tbl(
    (auto, auto, 1fr, auto),
    hdr("Type"), hdr("Name"), hdr("Value"), hdr("Proxy status"),
    text(8.8pt)[A], text(8.8pt)[#ic("app")], text(8.8pt)[the IPv4 from 5.1], text(8.8pt)[*DNS only (grey cloud)*],
    text(8.8pt)[AAAA], text(8.8pt)[#ic("app")], text(8.8pt)[the IPv6 from 5.1], text(8.8pt)[*DNS only (grey cloud)*],
  )
  #note[
    Grey cloud matters. Orange-cloud proxying intercepts the certificate
    challenge and issuance hangs. Proxying can be enabled later once the
    certificate exists.
  ]
]

#step("5.3", "Issue the TLS certificate", "cli")[
  #code("fly certs add app.botlien.com
fly certs show app.botlien.com")
  #note[
    Repeat #ic("show") until it reports the certificate issued, usually under
    two minutes. Renewal is automatic from then on.
  ]
]

#step("5.4", "Verify over the real domain", "cli")[
  #code("curl -i https://app.botlien.com/health")
]

// ---------- 6 ----------
#sect("6", "Make email actually deliver")

#note[
  Sign-in is a magic link, so mail delivery is not a feature of the product, it
  is the front door.
]

#step("6.1", "Add botlien.com as a domain in Resend", "you")[
  #note[
    Accept the #ic("send.botlien.com") subdomain Resend offers. That leaves the
    existing Hostinger MX records alone, so inbound mail to
    #ic("info@botlien.com") keeps working.
  ]
]

#step("6.2", "Paste the DKIM and SPF records into Cloudflare", "you")[
  #note[
    These are TXT and CNAME records on the #ic("send") subdomain. They do not
    touch your MX records.
  ]
]

#step("6.3", "Wait for Resend to show the domain Verified", "you")[
  #note[
    Until it does, Resend delivers only to the address that owns the account.
    This is precisely why a demo to someone else fails while your own test
    passes.
  ]
]

#step("6.4", "Match the from-address to the verified domain", "cli")[
  #code("fly secrets set BOTLIEN_MAIL_FROM=\"Botlien <info@botlien.com>\"")
]

// ---------- 7 ----------
#sect("7", "Smoke test the real thing")

#step("7.1", "Walk the entire owner path", "you")[
  #note[
    Go to #ic("https://app.botlien.com/signin") with a real address and confirm
    each of these:
  ]
  #block(above: 5pt, below: 0pt, inset: (left: 2pt))[
    #set text(8.6pt, fill: fg2)
    #list(
      spacing: 4pt,
      [the link arrives, and points at #ic("app.botlien.com"), not #ic("127.0.0.1")],
      [clicking it signs you in and the session persists across a page reload],
      [clicking the same link a second time is rejected as already consumed],
      [#ic("/owner") redirects into the flow rather than rendering zeros],
      [a CSV from #ic("prototype/sample-data/") imports and produces a coverage number],
    )
  ]
]

#step("7.2", "Confirm the per-business database was created", "cli")[
  #code("fly ssh console -C \"ls -la /data /data/tenants\"")
  #note[
    Expect #ic("control.db") plus #ic("tenants/1.db"). That is the tenant
    isolation model, visible on disk: one separate database file per business.
  ]
]

// ---------- 8 ----------
#sect("8", "Connect the front door")

#step("8.1", "Repoint the marketing site's call to action", "you")[
  #note[
    Change "Start free" on botlien.com to #ic("https://app.botlien.com/signin").
    That static site deploys separately from this repository, so make the change
    wherever it lives.
  ]
]

// ---------- 9 ----------
#sect("9", "Backups, before any real customer")

#step("9.1", "Confirm volume snapshots and retention", "cli")[
  #code("fly volumes list
fly volumes snapshots list <volume-id>")
]

#step("9.2", "Schedule the backup script to offsite storage", "cli")[
  #note[
    #ic("scripts/backup.mjs") to Tigris, B2 or S3. Litestream fits
    #ic("control.db") cleanly but wants its databases in static configuration,
    which is awkward for tenant files created dynamically as people sign up.
    Snapshots plus the scheduled backup script are the simpler correct answer
    for those.
  ]
]

#step("9.3", "Rehearse a restore once", "cli")[
  #note[
    An untested backup is not a backup. Do this while production is empty and
    the rehearsal is free.
  ]
]

// ---------- 10 ----------
#sect("10", "Known constraints")

#tbl(
  (auto, 1fr),
  hdr("Constraint"), hdr("What it means"),
  text(8.8pt)[*One machine, always*], text(8.8pt)[Two machines cannot share a Fly volume, and two processes writing the same SQLite files corrupt them. Never raise #ic("max_machines_running") and never enable autoscaling. The failure is silent data corruption, not an error.],
  text(8.8pt)[*Deploys drop traffic*], text(8.8pt)[Roughly 30 seconds per deploy, a direct consequence of the single-machine rule. Irrelevant today, worth scheduling off-hours once you have users.],
  text(8.8pt)[*No schema migrations*], text(8.8pt)[Both stores build tables with #ic("CREATE TABLE IF NOT EXISTS"), which does nothing to a table that already exists. Adding a column works on a fresh database and silently no-ops on a customer's. UI changes are free; schema changes need a written migration once real data exists.],
  text(8.8pt)[*Local data does not travel*], text(8.8pt)[#ic(".dockerignore") excludes #ic("data/"), correctly. Production starts empty.],
  text(8.8pt)[*No payments*], text(8.8pt)[There is no Stripe integration. Every account is free until one is added.],
  text(8.8pt)[*Container runs as root*], text(8.8pt)[A deliberate pilot-stage tradeoff, documented in the Dockerfile. Phase 2 hardening item.],
)

// ---------- 11 ----------
#sect("11", "Command reference")

#tbl(
  (auto, 1fr),
  hdr("Command"), hdr("Purpose"),
  ic("fly deploy"), text(8.8pt)[Ship current code. Repeatable, run as often as you like.],
  ic("fly logs"), text(8.8pt)[Live application logs.],
  ic("fly status"), text(8.8pt)[Machine state and health check results.],
  ic("fly ssh console"), text(8.8pt)[Shell inside the running container.],
  ic("fly secrets list"), text(8.8pt)[Names of set secrets. Values are never shown.],
  ic("fly secrets set K=V"), text(8.8pt)[Set a secret. Triggers a restart.],
  ic("fly certs show <domain>"), text(8.8pt)[Certificate issuance state.],
  ic("fly volumes list"), text(8.8pt)[Volume id, size and region.],
  ic("fly apps restart botlien"), text(8.8pt)[Restart without redeploying.],
)

#v(4pt)
#text(9.5pt, weight: 700, "Reference links")

#block(above: 6pt, inset: (left: 2pt))[
  #set text(8.6pt, fill: fg2)
  #list(
    spacing: 4pt,
    [Fly.io: *fly.io* · docs *fly.io/docs* · volumes *fly.io/docs/volumes* · pricing *fly.io/docs/about/pricing*],
    [Resend: *resend.com* · docs *resend.com/docs*],
    [Repository: *github.com/samk0228/botlien* (private) · local clone #ic("~/Projects/botlien")],
  )
]
