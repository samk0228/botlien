# Botlien, explained from scratch

A walkthrough of every screen in the demo, assuming you know nothing about
robots, the product, or why any of it matters.

Demo: https://claude.ai/code/artifact/963bddb6-d6b2-489b-8483-ddf7d766c59a

---

## 0. The one sentence version

A restaurant leases robots. Botlien tells the owner whether those robots did
more work than they cost.

That is the whole product. Everything on every screen is either that number,
the arithmetic behind it, or something you can do about it.

---

## 1. The problem this exists to solve

Say you run a restaurant. A salesperson leases you a tray-delivery robot for
$999 a month. A year later, someone asks you: was that worth it?

You genuinely cannot answer. Here is why:

- **The robot's own app** shows you trips, battery, error logs. Operational
  detail, no money in it.
- **Your accounting** shows $999 a month going out. A cost with nothing on the
  other side of it.
- **The vendor's ROI calculator** says the robot replaces 1.5 to 2 employees
  and saves you $45,000 to $70,000 a year. That is a sales document. Nobody
  believes it, correctly.

So the owner has a number going out and nothing to set against it. Botlien
builds the other side of that comparison, conservatively enough that it
survives an accountant looking at it.

---

## 2. The one idea everything else is built on

**Coverage** is the product's only real number:

```
                what the work was worth
Coverage  =  ───────────────────────────────
                what you paid to lease it
```

- **Above 1.0** means the robots did more work than they cost you.
- **Below 1.0** means they did less.
- In the demo the answer is **2.38x**, so the fleet did a bit more than twice
  the work it cost.

The hard part is the top of that fraction. A robot does not earn money
directly. It carries trays. So how much is carrying a tray worth?

### The replacement-cost trick

Botlien does not ask what the robot earned. It asks **what that same work
would cost you to buy from a person**. That is called *replacement cost*, and
it is the only honest way to price work that never touches a receipt.

The rate is derived, never asserted:

```
                loaded wage per hour            $22.00
rate per run = ───────────────────────  =  ────────────  =  $0.73 per run
               runs a person does / hr        30 runs
```

“Loaded wage” means the wage plus payroll taxes and benefits, so what the
person actually costs you, not what lands in their bank account.

Every rate in the product is built this way, from two numbers you control.
Change either one and the rate follows. You can check it on a calculator,
which is deliberate.

### What Botlien deliberately does NOT claim

This matters more than anything else in the product, and it is the reason to
trust the rest of it:

- It does **not** claim revenue. The robot did not sell anything.
- It does **not** claim profit.
- It does **not** claim you saved on labour. You probably did not fire anyone.
  The runner is still on the floor, walking less.

It claims exactly one thing: *this much work happened, and buying it elsewhere
would have cost this much.* Anything beyond that would be guessing about a
business Botlien cannot see.

---

## 3. The sign-in flow, screen by screen

### 3.1 Sign in

No password. You type your email and get a link.

Why: an owner opens this thing about once a month. A password used twelve
times a year is a password reset twelve times a year. The link expires in 15
minutes and works once.

There is also **“See a real statement first, no account”**, which drops you
straight into a fully populated demo. Nobody should have to sign up to find
out whether a product is worth their time.

### 3.2 Check your email

A holding screen. The important line is *“Nothing happens on this screen.
You're in your inbox now, not here.”* It tells you the screen is not broken
and not waiting on you.

The links underneath are demo shortcuts, standing in for clicking the email:
returning owner, first time, or an expired link.

### 3.3 “Harbor Grill already uses Botlien”

If someone signs up with an email whose domain already has an account, they
are offered the existing workspace instead of quietly creating a second one.

Why this exists: without it, a manager signing up separately splits one
restaurant group into two accounts with two sets of rates and two statements
that disagree. That is expensive to untangle later.

### 3.4 First run, steps 1 to 4

Four questions, once, then never again.

1. **What kind of business is this?** Sets what work you get priced against.
   Pick “restaurant” and it immediately shows you the promise and the
   arithmetic: `$0.73 per run = $22.00/hr ÷ 30 runs per hour`. No surprises
   later.
2. **Where do these robots work?** Names the site. Robots belong to a site,
   sites belong to you. This exists because timezone and opening hours differ
   by location and both feed the maths. Answering “more than one location”
   puts you on the multi-site tier.
3. **Who else needs to see this?** Three roles: Owner, Manager, Accountant.
   Only an owner can change a rate, because a rate is the only thing here that
   moves a number.
4. **Compare yourself to similar venues?** Opt in to an anonymous benchmark.
   It lists exactly what is shared (robot model, kind of work, runs, coverage)
   and what never is (your name, address, invoices, wage).

Then it hands you to **Import usage**, because nothing has been read yet.

### 3.5 Import usage

You drag in a CSV export from your robot vendor's dashboard. A CSV is just a
spreadsheet file.

Why a file and not a live connection: Bear and Pudu issue API credentials by
hand, one account at a time, and it can take weeks. The file works today. The
live connection is the upgrade, not the first step.

**“Not sure where the file is?”** gives you the actual click path inside Bear
Universe and Pudu Cloud. This is the single most likely place for someone to
give up, so it gets real instructions.

If the file cannot be read, the screen shows the column names it accepts and
two rows of what it actually found, so you can see the mismatch yourself.

If part of the period was already imported, it says so: *those days will be
replaced, not added*, so nothing is double-counted.

---

## 4. The statement, section by section

This is the main screen. Top to bottom.

### 4.1 The headline

```
   $13,333.80  work serviced
   ──────────────────────────  =  2.38x
    $5,596.00  lease invoiced
```

Six robots did $13,333.80 of work in 30 days. You paid $5,596.00 to lease
them. That is 2.38 times over.

Directly under the number sits the qualifier: *replacement cost of the work,
over the lease. Not revenue, not profit, not labour you stopped paying for.*
It is next to the number rather than in a footnote because that is where
someone will misread it.

The two bars underneath draw the same two figures on one shared scale, so the
gap is visible without doing arithmetic.

### 4.2 The period pill and the open/closed banner

`Aug 4 to Sep 3, 2026` with a status line.

- **Open period**: telemetry is still arriving, figures still move.
- **Closed period**: frozen. A later rate change will not retroactively
  restate it.

This matters because if you send a statement to your accountant and it
silently changes next month, the product is worthless. Closed periods keep the
rate they were computed with.

### 4.3 The four tiles

- **Work serviced, $13,333.80.** The top of the fraction.
- **Cost per run, $0.33.** What each tray delivery costs you in lease terms
  ($3,996 of delivery invoices ÷ 12,060 runs). Compare to the $0.73 a person
  would cost. That gap is the whole business case, in one line.
- **Utilization, 36%.** The robots were actively working 684 hours out of the
  1,920 hours you said they are available. Low utilization is not a fault, it
  is an opportunity: the machine is paid for either way.
- **Lease invoiced, $5,596.00.** The bottom of the fraction.

### 4.4 What to fix first

The only section that changes your number instead of describing it.

Four findings, each priced, ordered by what they are worth. Example:

> **Servi 2 (patio) earns its invoice least, $2,100.24**
> It returned 0.66x against a fleet median of 2.76x on the same kind of work,
> while costing $999.00 over this period.
> **Do this:** Move it to a busier zone or section before renewal.
> `$999.00 invoice x 2.76x fleet median = $2,757.24 of work expected, against $657.00 performed`

Three conventions worth understanding:

1. **“up to”** means it is a ceiling, not a forecast. Recovering *all* of an
   idle hour is the best case.
2. **“counted, not earned”** appears on the stuck-robot finding, and it is the
   most honest thing in the product. Those hours are *already inside* your
   2.38x, but the robot was jammed against a chair leg, not cleaning. Fixing
   it makes the number smaller and more true.
3. Every figure uses **that same robot's own observed rate**, applied to hours
   it did not work. Never a vendor's throughput claim. If a robot has never
   hit a rate, Botlien will not claim it would.

### 4.5 The one input you cannot measure

A slider, and the most important thing on the page.

Everything above depends on one judgement: *how many tray runs does a person
do in an hour?* Botlien starts at 30. That is a guess, and you cannot measure
it without standing in your own dining room with a stopwatch.

So instead of hiding it, drag it. Every figure on the page moves live.

- At 30 runs/hr, coverage is **2.38x**
- At 45, it is **1.87x**
- At 60, it is **1.56x**

And the punchline, computed rather than claimed: coverage only falls to 1.00x
at **258 runs an hour**, one tray every 14 seconds for an entire shift, which
no human does.

This is the answer to “your numbers are made up.” The assumption changes the
*size* of the answer. It does not change the answer.

### 4.6 Against your own last five periods / Against venues like yours

Left: a small line chart of the last six months, currently +0.27x on July.
Right: you are in the 78th percentile against 214 similar venues, median 1.84x.

The first tells you whether things are improving. The second tells you whether
your lease was a good deal in the first place. Your own number alone cannot
answer either.

### 4.7 Why it moved

Coverage went from 2.11x to 2.38x. This section says exactly why, and the
parts add up to the whole move with nothing left over.

Work performed breaks into three things multiplied together: the rate, the
hours the robot was switched on and reachable, and how much it got through per
hour it was up. So a change in coverage can only come from those, plus the
invoice.

- hours online: **+0.19x** (they were available more)
- work per hour online: **+0.08x** (they worked harder while up)
- replacement rate: **0.00x** (your rate did not change)
- lease invoiced: **0.00x** (invoices held)

Total: **+0.27x**. Exactly the move, no residual, nothing hand-waved.

Underneath, the same story per robot: Servi 3 added $742.10, Servi 2 lost
$188.40, and so on.

If you have ever seen a variance bridge in finance, this is the same idea
applied to robots instead of budgets.

### 4.8 By kind of work

Tray runs and cleaning hours are different units, so they are never mixed:

| Work | Volume | Rate | Work serviced | Coverage |
|---|---|---|---|---|
| Tray delivery, 4 robots | 12,060 runs started | $0.73 | $8,803.80 | 2.20x |
| Floor cleaning, 2 robots | 181.2 active hours | $25.00 | $4,530.00 | 2.83x |

Note **“runs started”**, not runs completed. The robots report when a job
begins, not whether it finished. Botlien says so rather than quietly implying
otherwise.

---

## 5. The other screens

### 5.1 Robot by robot

One row per robot, each carrying the equation that produced its number:

```
3,780 runs started x $0.73 = $2,759.40 / invoice $999.00 = 2.76x
```

A duty-time bar shows hours worked against hours declared. Servi 2 is tagged
**under its lease** at 0.66x, and the filter at the top isolates it.

Underneath each robot is a **Condition** block, which is new.

### 5.2 Condition (consumable life)

Scrubbers wear out parts: squeegees, filters, brushes. Gausium robots report
how much life is left in each one. Bear and Pudu report nothing of the kind,
so those rows say `consumable life · not reported by Bear` instead of showing
an empty meter. A missing input is stated as missing, never drawn as a zero.

Scrubber 75 has a side brush at **3% over** its rated life and a filter at 1%.
That matters for two different reasons:

- **For you:** a squeegee past its life still logs active hours. The work gets
  counted at full rate while the floor actually gets worse.
- **For a lender:** deferred maintenance is what a repossessed machine is
  worth. It shows up here months before it shows up in a missed payment.

### 5.3 Rates

Where every rate comes from, with both inputs visible and the division shown.
It also carries **rate history**: what the rate was before, when it changed,
and who changed it. Tray delivery was $0.68 until Jul 1, when it went to $0.73.

This is why the variance panel can honestly report a zero rate effect. Rates
are dated, so the system knows the rate did not change, rather than being
unable to tell.

### 5.4 Setup

Five inputs per robot, all prefilled. What it does, monthly invoice,
replacement rate, loaded wage, operating hours per day. You can accept it all
as-is. No wizard.

### 5.5 How figures read

A reference page showing what the product does when data is imperfect: a
benchmark default, a robot under its lease, one barely used, one over 100%
capacity, an unpriced robot, a missing invoice.

The rule throughout: a missing input is reported as missing. Never a $0.00,
which would read as “this work was worth nothing.”

### 5.6 All 3 sites

The multi-location view. Pier 4 at 2.38x, Marina at 1.92x, Airport at 2.81x,
group total 2.41x.

The group figure is the sum of all work over the sum of all invoices, not an
average of the three ratios. Averaging ratios gives the wrong answer when the
sites are different sizes.

### 5.7 Notifications

Six rules, each stating what triggers it, who gets it and how often. Including
why there is deliberately no alert for a good month: a tool you open monthly
earns nothing by pinging you weekly.

### 5.8 Settings

Site details, account, **People** with the three roles, data sources, plan,
export, delete account.

---

## 6. Glossary

| Term | Plain meaning |
|---|---|
| Coverage | Work value ÷ lease cost. Above 1.0 is good. |
| Work serviced | What the work would cost to buy from a person. Not revenue. |
| Replacement rate | Loaded wage ÷ what a person gets through in an hour. |
| Loaded wage | Wage plus taxes and benefits. The real cost of the person. |
| Runs started | The robot reported beginning a job. Not proof it finished. |
| Duty time | Hours actively working. |
| Utilization | Duty time ÷ hours you declared it is available. |
| Open / closed period | Still moving, versus frozen and safe to send out. |
| Benchmark rate | Botlien's published default, used until you set your own. |
| Variance | The breakdown of why coverage moved, summing exactly. |
| Consumable life | How much is left in a wearing part, read from the robot. |
| Telemetry | Data the robot reports about itself. |
| CSV | A spreadsheet file. What you export from the vendor dashboard. |

---

## 7. What is real and what is a demo

Worth being clear, since the screens do not distinguish.

**Real and working in the codebase:**
the maths, the rate derivation, the tips engine, the variance decomposition,
the CSV importer, the Bear and Gausium connectors, the flag rules. 161 tests
pass.

**Designed in the demo, not built yet:**
accounts, sign-in, roles and multi-tenancy, multi-site, the benchmark,
scheduled email and the accountant link.

**The fleet in the demo** is Harbor Grill, a made-up six-robot restaurant. The
numbers are internally consistent and every figure ties out, but it is not a
real customer.

---

## 8. If you remember only four things

1. **Coverage is work value over lease cost.** Above 1.0 means the robots pay
   for themselves. The demo says 2.38x.
2. **Work value is replacement cost**, what the same work costs from a person.
   It is not revenue, profit, or labour saved, and the product says so
   everywhere.
3. **Every number shows its arithmetic**, so an owner who does not trust the
   product can check it by hand. That is the whole reason to believe it over
   the vendor's ROI calculator.
4. **The one soft assumption is exposed, not hidden.** Drag the slider. The
   answer survives every believable value, and that is a stronger argument
   than any number on the page.
