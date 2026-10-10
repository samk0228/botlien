# First design partner: on-site pilot checklist

For the first factory that says yes. Covers Universal Robots arms and MiR
mobile robots. The goal of the visit is one sentence: **every robot on the
floor shows its real state in Botlien, and the team gets a stop alert on their
phone, before we leave.**

Total on site: 1 to 2 hours. Most of the work is the call before.

---

## 1. The call before the visit (30 min, a week ahead)

Ask these on the phone or by email. A "no" or "don't know" on any of them is
fine, it just means we bring the answer with us.

### The robots

- [ ] How many robots, which brand and model (UR10e, UR5e, MiR250...).
- [ ] **UR arms:** e-Series, or the older CB3? On CB3 the software must be 3.3
      or newer (the teach pendant shows it under About). RTDE, the read-only data
      feed we use, does not exist before that.
- [ ] **MiR:** does a MiR Fleet server run them, or does each robot work on
      its own? If Fleet, we connect once to the Fleet server instead of to every
      robot.
- [ ] What does each robot do, and in what order on the line? ("Loader 1 feeds
      the mill, Deburr takes from the mill, then Inspection.") This is what lets
      Botlien say what a stop **left waiting**.
- [ ] Shifts: what hours do the robots run, and which days.

### The network (ask for their IT person if there is one)

- [ ] Each robot's IP address. On a UR teach pendant: Settings > System >
      Network. On a MiR: the web interface, System > Settings.
- [ ] **A computer that stays on, on the same network as the robots.** Any
      Windows, Linux or Mac PC they already have works (a cell PC, an office PC
      on the plant network, a spare laptop). It needs:
  - [ ] Node.js 18 or newer installed, or permission for us to install it
  - [ ] sleep turned off. If it sleeps, readings stop, and after 10 minutes
        Botlien shows every robot as offline
  - [ ] on the plant network, not guest wifi
  - [ ] outbound internet (HTTPS, port 443) to app.botlien.com
- [ ] Can that computer reach the robots? UR arms on port 30004, MiRs on port
      80. If IT runs a firewall between the office and the floor, they may need
      to open these, **outbound from the PC to the robots only**.
- [ ] **UR e-Series only:** on the pendant, Settings > Security > Services,
      RTDE must be enabled. It is on by default, but some integrators turn
      everything off.
- [ ] **MiR only:** a MiR login for us to read with. Ask them to make one in the
      MiR web interface (System > Users) in the lowest group that can read
      status. We never need an admin login.

### People and money

- [ ] Who is the owner (sees dollar figures), and who are the technicians (see
      times and causes only, never dollars)? Names, emails and phones.
- [ ] Who answers a stop on each shift? That person gets the alert first.
- [ ] Optional: profit per part, so Botlien can show parts lost, not just robot
      time. If they won't share it, skip it. Everything else still works.

### What we say about safety (they will ask)

Read this to them, or send it:

> Botlien is read only. The program on your PC listens to the robots' own
> status feed. It cannot move a robot, start or stop a program, load a job or
> change a setting. On UR arms it refuses the ports that can command an arm. On
> MiRs it only ever asks questions and never sends a command. It opens no port
> on your network; it only sends status out to Botlien. You can remove it with
> one line at any time.

### Before we hang up

- [ ] Date and time for the visit, at a time the robots are running.
- [ ] Who meets us on site, and who from IT is reachable that day.
- [ ] Make their Botlien account (owner email) so the invite is in their inbox
      before we arrive.

---

## 2. What to bring

- [ ] A laptop with Node.js 22 installed, as a fallback if their PC can't be
      used. It can run the gateway for the first days of the pilot.
- [ ] A USB stick with the Node.js installers for Windows and Mac, in case their
      PC has no Node and slow internet.
- [ ] An ethernet cable and a small switch, in case the only free network port
      is in the cell.
- [ ] A phone signed in as a technician on their account, to show the alert.
- [ ] This checklist, printed.

---

## 3. On site (1 to 2 hours)

| Step | What | Time |
|---|---|---|
| 1 | Walk the floor with whoever runs it. Write down each robot's name, IP and what it does, in line order. | 15 min |
| 2 | On the PC: sign in to Botlien, go to **Connect robots**, make the gateway key. | 5 min |
| 3 | Install the gateway with one line (below). It asks for the key, each arm's IP and each MiR's IP (or the Fleet server's), and checks it can reach each one. | 10 min |
| 4 | Watch the robots appear in Botlien. Each shows up within a minute of its first reading. | 5 min |
| 5 | **Check every robot against the floor.** Stand at each one: is it working, waiting or stopped, and does Botlien say the same? Fix the name if it's wrong. | 15 min |
| 6 | Set the line order (what feeds what), so stops say what they left waiting. | 10 min |
| 7 | Invite the team with their roles. Owner sees dollars, technicians don't. | 10 min |
| 8 | **Stop test.** Wait for a real stop, or if the operator chooses, have them pause a robot at a safe moment. The alert should reach the technician's phone within a few seconds. Press I am on it, then close it and log what fixed it. | 15 min |
| 9 | **Reboot test.** Restart the PC. The gateway starts by itself. Robots come back online in Botlien within a couple of minutes. | 10 min |
| 10 | Turn sleep off on the PC (if not done), and put a label on it: "Botlien, please leave on." | 5 min |

The install line, on their PC:

- **Windows**, PowerShell as Administrator:
  `irm https://app.botlien.com/gateway/install.ps1 | iex`
- **Linux:** `curl -fsSL https://app.botlien.com/gateway/install.sh | sudo sh`
- **Mac:** `curl -fsSL https://app.botlien.com/gateway/install.sh | sh`

We never cause a stop ourselves. Step 8 uses a stop that happens on its own,
or one the operator makes on purpose at a moment they pick.

### If something doesn't work

| What you see | Most likely | Do this |
|---|---|---|
| "Could not reach (IP) on port 30004" | Wrong IP, the PC is on another network, or a firewall | Check the IP on the pendant. Ping it from the PC. Ask IT about the firewall. |
| UR arm reachable but never shows up | RTDE turned off (e-Series) | Pendant: Settings > Security > Services, enable RTDE. |
| MiR: "refused the login (401)" | Wrong MiR user or password | Re-enter it. Check the user exists in the MiR web interface. |
| Robots show, then go offline after 10 minutes | The PC went to sleep or lost the network | Turn sleep off. Use a wired connection if wifi drops. |
| "Botlien refused the API key (401)" | Key was deleted or mistyped | Make a new key on Connect robots and run the install line again. |
| Nothing at all reaches Botlien | No outbound internet from the plant network | Ask IT to allow HTTPS to app.botlien.com. |

To remove it completely:

- **Linux/Mac:** `curl -fsSL https://app.botlien.com/gateway/install.sh | sh -s -- --uninstall`
- **Windows:** `$env:BOTLIEN_UNINSTALL=1; irm https://app.botlien.com/gateway/install.ps1 | iex`

---

## 4. After the visit

- [ ] **Same day:** message the owner a link to their dashboard and a one-line
      summary ("6 robots connected, first alert went to Maria at 2:14").
- [ ] **Day 1:** check every robot reported all shift. Any robot that went
      offline overnight means the PC slept or the network dropped.
- [ ] **Day 3:** check the stop alerts with the technician. Did each one match
      a real stop? Anything missed, or anything that wasn't really a stop?
- [ ] **Week 1:** 20-minute call with the owner. Show the week's stops, what
      they cost in robot time, and what they left waiting. Ask: what would
      make this worth paying for?
- [ ] **Day 14:** each robot now has two weeks of its own baseline, so
      comparisons against itself (slowing down, stopping more than usual) can
      start. Before that, Botlien doesn't make those calls, because they'd be
      mostly false alarms.

### What counts as a successful pilot

- Every robot reports through every shift, with no gaps we can't explain.
- Stop alerts reach a phone within seconds, and the team acknowledges them in
  Botlien.
- The owner can say what stops cost them last week, and which robot or machine
  held the line.
- The owner agrees to the design partner price ($50 per robot per month for the
  first ten partners, against the $75 working price).

---

## Known limits to say out loud

- **MiR:** the connector has only been tested against a simulator, not a real
  MiR or MiR Fleet yet. The first MiR pilot is also its first real test, so
  plan extra time on step 5.
- **Windows:** the installer has not yet been run on a real Windows PC. If it
  fails, run the gateway from our laptop for the first days and fix it after.
- **Part counts on UR arms** need one line added to the robot program (an
  output register that counts parts). That is a program change, so it is the
  customer's or their integrator's call. Without it, Botlien still measures
  working time, which is what the cost figures use.
- The robot's own error codes come through as they are. Botlien does not yet
  explain every UR or MiR code in plain words.
