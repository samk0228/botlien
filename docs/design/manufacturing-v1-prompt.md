# Botlien Demo: manufacturing accounts lead with what a robot arm costs

Extend the Botlien Demo, the clickable prototype in this project. One
self-contained HTML app: vanilla JS, one `S` state object, `render()`
rebuilds the page, `ACTIONS` keyed by `data-act`. Build inside it.

Run this after prompts 3 and 4. The live hook they added (`liveData()`,
`isLiveAccount()`, `LIVE_PREVIEW`, `previewLive()`) is already in the page.
Use it. Do not add it again.

**The demo does not change.** With `?demo=1`, every screen, mock and number
stays exactly as it is today. Everything below appears only in a live
manufacturing account, and in the new preview in section 1.

## Why

Botlien's first customers are factories running Universal Robots arms for
CNC machine tending and welding. For them the dashboard's current framing is
wrong. It says "A person vs your robots" and "work a person would otherwise
have been paid to do". A CNC tender replaces no one's hourly wage that we can
honestly price, and an arm is usually owned, not leased.

Antonio's Overnight Line Benchmark v1.1 settles the model. Every dollar comes
from the robot itself: what it costs to own and run per scheduled hour, and
how much of that time turns into work. The money is in idle time. A single
stop costs about $0.25 in robot time, so dollars never lead an alert. A robot
that works 8% of its schedule costs $55 per hour of real work and sits idle
for $16,096 a year.

The server already does this math. This pass gives it a face.

---

## 0. Rules

- **Only real numbers in a live account.** Never a demo figure. Where the
  server has not said, write "not reported" or say nothing.
- **Every dollar says where it came from.** The per-hour cost always has its
  one-line derivation within one click. A figure built on our defaults
  carries an `estimated` pill until the owner enters their own price and
  hours.
- **Idle cost is a ceiling, not a promise.** Wherever a yearly idle figure
  appears, the sentence near it says some waiting is built into the line.
- **Tokens and components only.** Same colours, `pill(text, icon, tone)`,
  figures in `--fg1`, the accent in its five places, no text under 11.5px,
  no em dashes anywhere, 390px works.
- **Every button states what happens,** using `BUTTON_STATES`. No button
  that does nothing.
- Plain words, one idea per sentence, short.

---

## 1. How the page knows, and the preview

A live account is a manufacturing account when either is true:

```js
function isRobotCostAccount(){
  const d = liveData();
  if (!d || !isLiveAccount()) return false;
  if (d.FIRST_RUN && d.FIRST_RUN.business === 'manufacturing') return true;
  return (d.COST || []).some(Boolean);
}
```

Every change below is behind `isRobotCostAccount()`. Any other live account
and the demo keep today's screens.

Add `?livepreview=mfg`. It opens `previewLive()` as a sample manufacturing
account: one site, `CNC cell 1`, with the benchmark's CNC line. Use these
figures exactly. They are the benchmark's own.

| Robot | Arm | Cost per hour | Ownership | Maintenance | Energy | Deployed | Working | Per hour of real work | Idle per year |
|---|---|---|---|---|---|---|---|---|---|
| Loader 1 | UR10e | $4.37 | $3.72 | $0.62 | $0.03 | $123,990 | 23% | $19.02 | $13,471 |
| Loader 2 | UR10e | $4.37 | $3.72 | $0.62 | $0.03 | $123,990 | 8% | $54.67 | $16,096 |
| Deburr | UR5e | $3.38 | $2.88 | $0.48 | $0.02 | $95,908 | 38% | $8.90 | $8,385 |
| Inspection | UR3e | $2.90 | $2.48 | $0.41 | $0.01 | $82,528 | 21% | $13.82 | $9,174 |

Line: $15.03 an hour, 22% working, $69.52 per hour of real work, $47,126
idle a year. All four are `CNC machine tending`, all `estimated: true`, all
install `1.5` (complex cell), 4,000 hours a year.

---

## 2. The data the server sends

`liveData().COST[i]` is one entry per robot row, same order as `ROBOTS`.
It is `null` for any robot whose work is priced per unit (a scrubber, a
picker). For an arm:

```js
COST[i] = {
  arm: 'ur10e', armLabel: 'UR10e',
  armPriceCents: 4959600,        // list price, or the owner's
  installMultiple: 1.5,          // integration on top, as a multiple of the arm
  deployedCents: 12399000,       // arm x (1 + install)
  hoursPerYear: 4000,
  perHourCents: 437,             // C: own and run, per scheduled hour
  ownershipCents: 372, maintenanceCents: 62, energyCents: 3,
  workingPct: 8.0,               // share of scheduled time it was working, or null
  perWorkingHourCents: 5467,     // C / working share, or null if it never worked
  idleCostYearCents: 1609600,    // C x hours a year x share not working, or null
  derivation: '$4.37 per working hour = what a UR10e costs to own and run per scheduled hour ($3.72 ownership + $0.62 maintenance + $0.03 energy)',
  estimated: true                // false once the owner gave price AND hours
}
```

For these robots the server already prices a working hour at C. So the
statement's existing coverage is the line's working share. Coverage 0.22x
means 22% of the arms' cost turned into work. Read it that way. Do not
compute a second number.

---

## 3. Dashboard tiles and the main panel

The tile strip becomes:

| Tile | Value | Under it |
|---|---|---|
| `Robot cost` | sum of `perHourCents` over included arms, as `$15.03/hr` | `to own and run` |
| `Working` | coverage as a percent, `22%` | `of scheduled time` |
| `Idle cost` | sum of `idleCostYearCents`, as `$47,126` | `a year, at most` |
| `Payback` | unchanged | unchanged |

`A person vs your robots` and `Utilization` are gone for these accounts.
`Working` replaces both.

The `Robot cost` panel (the default tile) says, in two sentences:

`Your 4 arms cost $15.03 an hour to own and run. They worked 22% of their
scheduled time, so each hour of real work cost $69.52.`

Under it, one quiet line: `Idle cost is the most you could win back, not a
promise. Some waiting is built into the line.` Then the `estimated` pill
and `Use your own numbers` (goes to section 5) while any arm is estimated.

`Coverage over time` becomes `Working over time`, the same series shown as
percentages. The 6-month average line reads `6-month average 22%`.

---

## 4. Robots that work the least

On Fleet, for these accounts, the columns after the name are `Arm`, `Cost
per hour`, `Working`, `Per hour of real work`, `Idle a year`. Sort by
`Idle a year`, highest first. That order is the benchmark's "robots that
work the least" table, and it answers the owner's first question: which arms
are paid for but mostly waiting.

Above the table, one line: `The arm at the top is the one to speed up or
re-plan first.` If the same robot has been lowest-working in every closed
period shown, add a pill `lowest every period` on its row.

The robot drawer gains a `Cost` block:

- `Deployed $123,990` with `UR10e $49,596 + install 1.5x` under it
- `Ownership $3.72` · `Maintenance $0.62` · `Energy $0.03` · `Total $4.37/hr`
- The `derivation` string, in `--fg3`, 12.5px
- `Working 8%` · `$54.67 per hour of real work` · `$16,096 idle a year`
- `estimated` pill plus `Use your own numbers` while `estimated` is true

---

## 5. The owner's own cost numbers (Setup, per arm)

In Setup, a robot with a `COST` entry swaps the invoice row for four inputs:

- **Arm:** a select of `UR3e, UR5e, UR10e, UR16e, UR20, UR30`, starting on
  `armLabel`.
- **What you paid for the arm:** dollars, starting empty with the list price
  as placeholder (`$49,596 list`).
- **Install:** a segmented choice `Simple cell 1.0x`, `Complex cell 1.5x`,
  `Welding cell 2.0x`, and `Other` which opens a number field (0 to 5).
- **Hours scheduled a year:** number, placeholder `4,000 (two shifts)`.

Add `robotCost: {}` to `S`. Store them in `S.robotCost[i] = { arm, armPrice, install, hoursYear }`,
leaving out anything left empty. The page already saves `robotCost` to the
server with every other input. Do not add a save call.

Recompute on the page as the owner types, so the numbers move at once. Use
exactly this, with these constants:

```js
const UR = { UR3e:[3301100,150], UR5e:[3836300,250], UR10e:[4959600,350],
             UR16e:[5775400,350], UR20:[6299000,500], UR30:[6141500,500] }; // cents, watts
function armCost({ arm, armPrice, install, hoursYear }){
  const [list, watts] = UR[arm];
  const price = armPrice > 0 ? armPrice * 100 : list, hrs = hoursYear || 4000;
  const deployed = price * (1 + install);
  const life = Math.min(7 * hrs, 35000);
  const own = (deployed - price * 0.40) / life;
  const maint = price * 0.05 / hrs;
  const energy = watts / 1000 * 9.77;
  return { deployed, own, maint, energy, perHour: own + maint + energy };
}
```

A row's rate becomes `perHour` and its monthly cost becomes `perHour x
hoursYear / 12`, unless the owner typed an invoice. The server does the same
on the next load, so the two always agree.

`estimated` clears on the page once both price and hours are filled, as on
the server. Under the inputs, one line in `--fg3`: `List prices from
Devonics. Life 7 years or 35,000 hours, maintenance 5% a year, resale 40%,
power from UR's manuals, electricity 9.77 cents per kWh.`

---

## 6. Words that change for these accounts

Search the page and swap, only when `isRobotCostAccount()`:

- `A person vs your robots` → gone (section 3)
- `Every $1 of lease bought $X of work a person would otherwise have been
  paid to do.` → the two sentences in section 3
- `leased`, `lease cost`, `of lease` → `robot cost`
- `$X of work against $Y leased` → `$X of working time against $Y of robot
  cost`
- Any wage, employee or "hours of a person" comparison (Costs page, the
  wage inputs, the employees list) → hidden
- `Coverage` as a word on screen → `Working`

The morning brief and alerts never lead with dollars for these accounts.
A stop reads in minutes and what was idle: `Loader 2 stopped 4 min, Deburr
waited 3 min.` The yearly idle figure belongs on the dashboard, not in an
alert.

---

## 7. Not in this pass

- Value per part (what a machined part is worth) as an optional layer.
- The line map (which station feeds which, non-robot machines).
- Output per hour and the "a machine, not a robot, held the line" message.

Leave room for them. Do not mock them.

---

## 8. Check before you call it done

- `?demo=1`: nothing changed. No request goes to a server.
- `?livepreview=1`: today's live screens, unchanged.
- `?livepreview=mfg`: tiles read `$15.03/hr`, `22%`, `$47,126`; Fleet sorts
  Loader 2 first at `$16,096`; Loader 2's drawer shows `$123,990`, the three
  parts and the derivation; every arm shows `estimated`.
- In Setup, typing `$45,000`, `Simple cell 1.0x` and `6,000` on Loader 1
  drops its cost below `$4.37/hr` at once, and its `estimated` pill clears.
- No page in a manufacturing account says `person`, `wage`, `lease` or
  `Coverage`.
- No em dash. No text under 11.5px. 390px works on every changed screen.
