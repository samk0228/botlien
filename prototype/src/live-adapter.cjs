/* Live data adapter. Inlined into the page by build.cjs (the LIVE_ADAPTER placeholder),
   and required directly by test/live-adapter.test.mjs.

   The served app puts one account's data contract (GET /api/v1/fleet, built
   by src/contract.mjs) in window.BOTLIEN_LIVE before the page script
   runs. liveTables() turns it into the exact tables the demo is written
   against (ROBOTS, CONFIRM, SETUP, DAILY, DOWNTIME, ...), index-aligned by
   robot the way every per-robot table in the page already is. The page then
   runs unchanged: same compute functions, same screens, the account's
   numbers. Without the contract, or with ?demo=1, the demo tables stand.

   Rules: nothing here invents a figure. A value the account has not given
   stays undefined so the page's own fallback applies and says so, exactly as
   it does for a demo robot whose owner has not typed a number yet. */
function liveTables(c) {
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function short(key) { var p = key.split('-'); return MONTHS[Number(p[1]) - 1] + ' ' + Number(p[2]); }
  function dayAfter(key) {
    var d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function one(n) { return Math.round(n * 10) / 10; }
  function localStamp(ms, tz) {
    // 'YYYY-MM-DDTHH:MM' in the account's zone, the shape NOW_STAMP and the
    // ticket times use.
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    var parts = {};
    f.formatToParts(ms).forEach(function (x) { parts[x.type] = x.value; });
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
  }
  // Server work names come from rates.mjs; the page's categories are
  // WORK_CATEGORIES. They agree except for one label.
  var WORK = { 'Tray or food delivery': 'Tray delivery' };
  function work(label) { return WORK[label] || label; }

  var tz = c.tz || 'America/Los_Angeles';
  var siteIndex = {};
  c.sites.forEach(function (s, i) { siteIndex[s.id] = i; });
  var robots = c.robots;
  var indexOf = {};
  robots.forEach(function (r, i) { indexOf[r.id] = i; });
  var open = c.periods[0];
  var openLabel = open ? short(open.start) + ' – ' + short(open.end) : '';

  function byRobot(rows, map) {
    var out = robots.map(function () { return []; });
    rows.forEach(function (x) {
      var i = indexOf[x.robotId];
      if (i !== undefined) out[i].push(map(x));
    });
    return out;
  }

  var T = {};
  T.SITES = c.sites.map(function (s) { return { name: s.name }; });
  T.SITE_ROBOT_COUNTS = c.sites.map(function (s) {
    return robots.filter(function (r) { return r.siteId === s.id; }).length;
  });
  // Only months with data. A customer who connected in August has one period,
  // not one real month and five empty ones: the page's averages and lines are
  // then over what exists, and a month with no telemetry never reads as 0.00x.
  var periods = c.periods.filter(function (p, i) {
    if (i === 0) return true;
    return c.sites.some(function (s) { return p.siteCoverage[s.id] != null; });
  });
  T.PERIODS = periods.map(function (p) {
    return {
      label: short(p.start) + ' – ' + short(p.end) + ', ' + p.end.slice(0, 4),
      status: p.status,
      closed: p.status === 'closed' ? 'Closed ' + short(dayAfter(p.end)) : '',
      siteCov: c.sites.map(function (s) { var v = p.siteCoverage[s.id]; return v == null ? null : Math.round(v * 100) / 100; }),
      siteUtil: c.sites.map(function (s) { var v = p.siteUtilization[s.id]; return v == null ? null : Math.round(v); })
    };
  });
  T.PERIOD_BOUNDS = periods.map(function (p) { return [p.start, p.end]; });

  T.ROBOTS = robots.map(function (r) {
    // brandOf() reads the first word, so the brand leads unless the model
    // already starts with it as a word ('Locus LocusBot', not 'LocusBot').
    var model = r.brand && r.model && r.model.indexOf(r.brand + ' ') !== 0 ? r.brand + ' ' + r.model : (r.model || r.brand || 'Unknown model');
    var row = { name: r.name, model: model, site: siteIndex[r.siteId] || 0 };
    if (r.dutyPct != null) {
      row.duty = 'duty ' + Math.round(r.dutyPct) + '%';
      row.dutyPct = Math.round(r.dutyPct) + '%';
    }
    if (r.activeHours != null && r.capacityHours != null) row.hours = Math.round(r.activeHours) + 'h of ' + Math.round(r.capacityHours) + 'h';
    var kept = c.keeping.filter(function (x) { return x.robotId === r.id; })[0];
    if (kept && kept.handHours != null && r.activeHours > 0) row.hand = Math.round((kept.handHours / r.activeHours) * 100) + '%';
    if (r.parts && r.parts.length) {
      row.parts = r.parts.map(function (p) {
        return {
          name: p.name,
          left: p.remainingPct == null ? null : Math.round(p.remainingPct),
          used: p.usedHours != null && p.lifeHours != null ? Math.round(p.usedHours) + 'h of ' + Math.round(p.lifeHours) + 'h' : ''
        };
      });
    }
    return row;
  });
  T.SETUP = robots.map(function (r, i) {
    return { name: r.name, model: T.ROBOTS[i].model, hours: r.scheduledHoursDay != null ? r.scheduledHoursDay.toFixed(1) + ' h' : '' };
  });
  T.CONFIRM = robots.map(function (r, i) {
    var units = r.units == null ? 0 : r.units;
    return {
      name: r.name,
      units: units,
      seen: units.toLocaleString('en-US') + ' ' + (r.unitLabel || 'tasks') + ' · ' + openLabel,
      work: work(r.work),
      site: T.ROBOTS[i].site
    };
  });
  T.DAILY = byRobot(c.daily, function (d) { return { date: d.date, units: d.units }; });
  T.ROBOT_DELTA = {};
  robots.forEach(function (r) {
    if (r.coverageDelta == null) return;
    var d = Math.round(r.coverageDelta * 100) / 100;
    T.ROBOT_DELTA[r.name] = (d < 0 ? '−' : '+') + Math.abs(d).toFixed(2);
  });
  T.KEEPING = robots.map(function (r) {
    var k = c.keeping.filter(function (x) { return x.robotId === r.id; })[0];
    return k ? { stalls: k.stalls, hand: k.handHours == null ? 0 : one(k.handHours), stalled: k.stalledHours } : { stalls: 0, hand: 0, stalled: 0 };
  });
  // A stall with no named place is grouped by where the robot stood, to the
  // nearest 2 m, so the Fix list can still rank spots before the owner has
  // named any. The label says it is a position, not a place name.
  function cause(d) {
    if (d.kind !== 'stuck') return d.cause;
    if (d.place) return 'stuck · ' + d.place;
    if (d.pose) return 'stuck · near ' + Math.round(d.pose.x / 2) * 2 + ', ' + Math.round(d.pose.y / 2) * 2 + ' m';
    return 'stuck';
  }
  T.DOWNTIME = byRobot(c.downtime, function (d) { return { date: d.date, start: d.start, minutes: d.minutes, cause: cause(d) }; });
  T.SAFETY = byRobot(c.safety, function (s) { return { date: s.date, time: s.time, kind: s.kind, note: s.note || '' }; });
  // Undefined where the owner has not entered the lease: contractFor() then
  // uses its stated default and the page marks the robot's contract as not set.
  T.CONTRACT = robots.map(function (r) {
    var k = c.contracts.filter(function (x) { return x.robotId === r.id; })[0];
    return k ? { start: k.startDate, term: k.termMonths, payback: k.paybackMonths, uptime: k.uptimePct } : undefined;
  });
  T.TICKETS = c.tickets.map(function (t) {
    return {
      id: t.ref || ('T-' + t.id),
      brand: t.brand,
      i: indexOf[t.robotId],
      title: t.title,
      opened: localStamp(t.openedAt, tz),
      responded: t.respondedAt ? localStamp(t.respondedAt, tz) : '',
      status: t.status
    };
  });
  T.NOW_STAMP = localStamp(c.asOf, tz);
  // The owner's own invoice and hours, seeded into the page's overlays so
  // Numbers shows them as the owner's, not as benchmarks.
  T.INVOICE = {};
  T.HOURS = {};
  robots.forEach(function (r, i) {
    if (r.configured && r.invoiceCentsMonth != null) T.INVOICE[i] = r.invoiceCentsMonth / 100;
    if (r.configured && r.scheduledHoursDay != null) T.HOURS[i] = r.scheduledHoursDay;
  });
  T.provenance = c.provenance;
  // Robot ids in row order: the page keys per-robot inputs by row, the
  // server by id, and this is the one place the two are joined.
  T.ROBOT_IDS = robots.map(function (r) { return r.id; });
  // What the owner saved, back in the page's own shape.
  var saved = c.inputs || { account: {}, robots: {} };
  T.SAVED = { account: saved.account || {}, robots: {} };
  Object.keys(saved.robots || {}).forEach(function (key) {
    var byIndex = {};
    Object.keys(saved.robots[key]).forEach(function (id) {
      var i = indexOf[id];
      if (i !== undefined) byIndex[i] = saved.robots[key][id];
    });
    T.SAVED.robots[key] = byIndex;
  });
  return T;
}

/* The owner's inputs the page saves, and nothing else. src/inputs.mjs keeps
   the same two lists, and a test fails if they ever differ. */
var PERSIST_ROBOT = ['robotInvoice', 'robotHours', 'confirmWork', 'excluded', 'contract'];
var PERSIST_ACCOUNT = ['workWage', 'workThroughput', 'customWork', 'hiddenWork', 'employees', 'nextEmployeeId',
  'stallMinutes', 'taxRate', 'taxDepMethod', 'taxInterestRate',
  'dashLayout', 'dashHidden', 'fixes', 'plans', 'briefSettings', 'claims',
  'ownerName', 'siteName', 'businessName', 'timezone', 'avatarColor', 'avatarIcon'];

/* The changes between two snapshots of the page state, in the shape
   POST /api/v1/inputs takes. Robot maps go out by robot id; a row the owner
   cleared goes out as null so the server drops it too. Returns null when
   nothing the owner owns has changed. */
function inputChanges(prev, next, robotIds) {
  var out = { account: {}, robots: {} };
  var any = false;
  PERSIST_ACCOUNT.forEach(function (k) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) { out.account[k] = next[k] === undefined ? null : next[k]; any = true; }
  });
  PERSIST_ROBOT.forEach(function (k) {
    var a = prev[k] || {}, b = next[k] || {}, byId = {}, changed = false;
    Object.keys(Object.assign({}, a, b)).forEach(function (i) {
      if (JSON.stringify(a[i]) === JSON.stringify(b[i])) return;
      var id = robotIds[Number(i)];
      if (id === undefined) return;
      byId[id] = b[i] === undefined ? null : b[i];
      changed = true;
    });
    if (changed) { out.robots[k] = byId; any = true; }
  });
  return any ? out : null;
}
if (typeof module !== 'undefined') module.exports = { liveTables: liveTables, inputChanges: inputChanges, PERSIST_ROBOT: PERSIST_ROBOT, PERSIST_ACCOUNT: PERSIST_ACCOUNT };
