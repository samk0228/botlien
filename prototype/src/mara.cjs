/* Mara, scripted. Reads a question, says which of the agents' API calls it
   needs (plan), then words an answer from what those calls returned (answer).
   No model is connected: every sentence is a template, and every number in
   it comes from the API, which is the dashboard's own calculation layer. A
   question it cannot place gets the list of questions it can answer, never a
   guess. Read only: asking it to move a robot is refused.

   Pure functions, no DOM, so test/mara.test.mjs can run them in node; the
   build drops this file into the team page at __MARA__. */
var Mara = (function () {
  var DAY = 86400000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) {
    return '$' + (cents < 10000 ? (cents / 100).toFixed(2) : Math.round(cents / 100).toLocaleString('en-US'));
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function ordinal(n) {
    var s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return n + s;
  }
  function when(ms, tz) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms);
  }
  function clock(ms, tz) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms).toLowerCase();
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  var STATE = { working: 'working', waiting: 'waiting', stopped: 'stopped', paused: 'paused', idle: 'idle', off: 'switched off', offline: 'offline', unknown: 'not reporting yet' };

  var SUGGESTED = ['What is happening right now?', 'Which robot works the least?', 'Why did Loader 2 stop this week?', 'Was it the robot or the mill?', 'What did the stops cost?'];

  /** The robot a question names, by its name on the account. The longest
   *  name that appears wins, so "Loader 2" beats "Loader". */
  function findRobot(q, robots) {
    var t = ' ' + norm(q) + ' ';
    var best = null;
    (robots || []).forEach(function (r) {
      var n = norm(r.name);
      if (!n) return;
      var squashed = n.replace(/ /g, '');
      if (t.indexOf(' ' + n + ' ') >= 0 || t.replace(/ /g, '').indexOf(squashed) >= 0) {
        if (!best || n.length > norm(best.name).length) best = r;
      }
    });
    return best;
  }

  /** The window a question asks about. */
  function windowFor(q, nowMs) {
    var t = norm(q);
    if (/\btoday\b/.test(t)) return { sinceMs: nowMs - DAY, label: 'in the last 24 hours' };
    if (/\byesterday\b/.test(t)) return { sinceMs: nowMs - 2 * DAY, untilMs: nowMs - DAY, label: 'yesterday' };
    if (/\bthis month\b|\b30 days\b|\bmonth\b/.test(t)) return { sinceMs: nowMs - 30 * DAY, label: 'in the last 30 days' };
    return { sinceMs: nowMs - 7 * DAY, label: 'in the last 7 days' };
  }

  function stopsPath(robot, w) {
    return '/api/v1/agent/stops?since=' + w.sinceMs + (w.untilMs ? '&until=' + w.untilMs : '') + (robot ? '&robot=' + robot.id : '');
  }

  /** What the question is and which calls answer it. */
  function plan(question, ctx) {
    var t = norm(question);
    var robot = findRobot(question, ctx.robots);
    var w = windowFor(question, ctx.nowMs);
    if (/\b(stop|pause|shut|restart|start|slow|speed|move|reset|halt|turn off|turn on|power)\b.*\b(robot|arm|loader|deburr|inspection|cell|line|mill|it)\b/.test(t) && !/\bwhy\b|\bhow many\b|\bdid\b|\bwhen\b|\bwas\b|\bcost\b/.test(t)) {
      return { intent: 'control', calls: [] };
    }
    if (/\brobot or\b|\bor the (mill|machine)\b|\bcause\b|\bblame\b|\bfault of\b|\bheld\b|\bholding\b|\bjam/.test(t)) {
      return { intent: 'cause', robot: robot, window: w, calls: [stopsPath(robot, w), '/api/v1/agent/line'] };
    }
    if (/\bcost|\bcosting\b|\bdollar|\bmoney\b|\bspend|\bexpens|\bhow much\b|\$/.test(t)) {
      return { intent: 'cost', robot: robot, window: w, calls: [stopsPath(robot, w), '/api/v1/agent/costs'] };
    }
    if (robot && /\b(third|second|fourth|fifth|how many times|how often|times this month)\b/.test(t)) {
      return { intent: 'count', robot: robot, calls: ['/api/v1/agent/robots/' + robot.id + '/history?bucket=day&since=' + (ctx.nowMs - 31 * DAY)] };
    }
    if (/\bleast\b|\blowest\b|\bmost idle\b|\bidle\b|\bbusiest\b|\bworks the most\b|\bworking share\b|\butili[sz]/.test(t)) {
      return { intent: 'least', calls: ['/api/v1/agent/costs'] };
    }
    if (/\bstop|\bstopped\b|\bdown\b|\bfault|\berror|\bincident|\bwhy\b|\bbroke|\balarm/.test(t)) {
      return { intent: 'stops', robot: robot, window: w, calls: [stopsPath(robot, w)] };
    }
    if (/\bnow\b|\bstatus\b|\bhappening\b|\bhow is\b|\bhow are\b|\bdoing\b|\bgoing on\b|\bupdate\b|\brunning\b/.test(t) || (robot && t.split(' ').length <= 3)) {
      return { intent: 'status', robot: robot, calls: ['/api/v1/agent/line'].concat(robot ? [stopsPath(robot, windowFor('', ctx.nowMs))] : []) };
    }
    return { intent: 'help', calls: [] };
  }

  function codeSummary(stops) {
    var by = {};
    stops.forEach(function (s) {
      var k = s.code ? s.label + ' ' + s.code : s.label;
      by[k] = (by[k] || 0) + 1;
    });
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (k) { return esc(k) + (by[k] > 1 ? ' x' + by[k] : ''); }).join(', ');
  }

  function stopList(stops, tz, max) {
    var rows = stops.slice(0, max).map(function (s) {
      return '<li>' + esc(when(s.startedAt, tz)) + ': ' + esc(s.robot.name) + ', ' + esc(s.label) + (s.code ? ' <code>' + esc(s.code) + '</code>' : '') + ', ' + s.minutes.value + ' min' + (s.open ? ' so far' : '') + (s.repeats > 1 ? ', ' + s.repeats + ' in a row' : '') + '</li>';
    });
    var more = stops.length > max ? '<li class="m-sub">and ' + plural(stops.length - max, 'more') + ' on the Incidents tab</li>' : '';
    return rows.length ? '<ul class="m-list">' + rows.join('') + more + '</ul>' : '';
  }

  /** Words for what came back. Returns { html, chips, view }: view is the
   *  dashboard tab worth opening next to the answer. */
  function answer(p, data, ctx) {
    var tz = ctx.tz || 'America/Los_Angeles';
    var who = p.robot ? esc(p.robot.name) : 'The line';
    var get = function (path) { return data[path]; };
    var dollarsHidden = ctx.role === 'technician';

    if (p.intent === 'control') {
      return { html: 'I cannot do that. Botlien is <b>read only</b>: it watches the robots and tells people what it sees, but it never starts, stops or changes a robot. Use the robot’s own controls, or ask your maintenance lead.', chips: ['What is happening right now?'] };
    }

    if (p.intent === 'help') {
      return { html: 'I answer from your robots’ own data, and I can only read it. Try one of these.', chips: SUGGESTED };
    }

    if (p.intent === 'status') {
      var line = get('/api/v1/agent/line');
      var robots = p.robot ? line.robots.filter(function (r) { return r.id === p.robot.id; }) : line.robots;
      if (!robots.length) return { html: 'No robots are reporting on this account yet.', chips: [] };
      var parts = robots.map(function (r) {
        var heard = r.lagSeconds === null ? '' : r.live ? '' : ' (last heard ' + (r.lagSeconds < 120 ? r.lagSeconds + ' s' : Math.round(r.lagSeconds / 60) + ' min') + ' ago)';
        return '<b>' + esc(r.name) + '</b> ' + esc(STATE[r.state] || r.state) + heard;
      });
      var html = (p.robot ? '' : 'Right now: ') + parts.join(', ') + '.';
      if (p.robot) {
        var st = get(p.calls[1]);
        html += ' It stopped ' + plural(st.totals.count, 'time') + ' in the last 7 days' + (st.totals.count ? ', ' + st.totals.minutes.value + ' min in all.' : '.');
      }
      var going = (line.goingOn || []).filter(function (e) { return e.kind === 'jam'; });
      if (!p.robot && going.length) html += ' ' + going.map(function (e) { return esc(e.station) + ' is holding ' + esc(e.line) + ', ' + e.minutes + ' min so far'; }).join('. ') + '.';
      return { html: html, chips: p.robot ? ['Why did ' + p.robot.name + ' stop this week?', 'How many times has ' + p.robot.name + ' stopped this month?'] : ['Which robot works the least?', 'What did the stops cost?'], view: p.robot ? 'robots' : 'dashv2' };
    }

    if (p.intent === 'stops') {
      var s = get(p.calls[0]);
      if (!s.stops.length) return { html: who + (p.robot ? ' has not stopped ' : ' has had no stops ') + esc(p.window.label) + '.', chips: ['What is happening right now?'], view: 'incidents' };
      var lead = p.robot
        ? who + ' stopped ' + plural(s.totals.count, 'time') + ' ' + esc(p.window.label) + ', ' + s.totals.minutes.value + ' min in all.'
        : plural(s.totals.count, 'stop') + ' ' + esc(p.window.label) + ', ' + s.totals.minutes.value + ' min in all.';
      return {
        html: lead + ' What the robot' + (p.robot ? '' : 's') + ' reported: ' + codeSummary(s.stops) + '.' + stopList(s.stops, tz, 5),
        chips: ['Was it the robot or the mill?', 'What did the stops cost?'].map(function (c) { return p.robot ? c.replace('the stops', p.robot.name + '’s stops') : c; }),
        view: 'incidents',
      };
    }

    if (p.intent === 'cause') {
      var cs = get(p.calls[0]);
      var ln = get('/api/v1/agent/line');
      if (!cs.stops.length) return { html: who + ' has had no stops ' + esc(p.window.label) + ', so there is nothing to place.', chips: ['What is happening right now?'] };
      if (!ln.lineMapSaved) return { html: 'I cannot tell the robot from the machine yet: this account’s line map is not saved. Once it says which machine sits between which robots, I can see when a mill holds the line. Of what I can see: ' + plural(cs.stops.length, 'stop') + ', each reported by the robot itself (' + codeSummary(cs.stops) + ').', chips: ['Why did the robots stop this week?'] };
      var after = cs.stops.filter(function (x) { return x.context.machineJamsBefore.length; });
      var machines = {};
      after.forEach(function (x) { x.context.machineJamsBefore.forEach(function (j) { machines[j.station] = (machines[j.station] || 0) + 1; }); });
      var names = Object.keys(machines).map(esc).join(' and ');
      var own = cs.stops.length - after.length;
      var h = 'Of ' + (p.robot ? who + '’s ' : 'the ') + plural(cs.stops.length, 'stop') + ' ' + esc(p.window.label) + ', '
        + (after.length ? after.length + ' came right after ' + names + ' held the line' : 'none came right after a machine held the line')
        + (own ? '. The other ' + own + ' the robot reported on its own' : '') + '.'
        + ' This is a pattern from the logged history, not a diagnosis. A person decides.';
      return { html: h, chips: ['What did the stops cost?'], view: 'incidents' };
    }

    if (p.intent === 'cost') {
      if (dollarsHidden) return { html: 'Dollar figures are not shown for your role. I can tell you the minutes: ask why a robot stopped.', chips: ['Why did the robots stop this week?'] };
      var c = get(p.calls[0]);
      var k = get('/api/v1/agent/costs');
      var tot = c.totals.cost && c.totals.cost.stopsCents;
      var fleet = k.fleet && k.fleet.cost;
      if (!tot && !fleet) return { html: 'There is no cost model for these robots yet, so I have no dollar figure to give.', chips: [] };
      var parts2 = [];
      if (tot) parts2.push((p.robot ? who + '’s ' : 'The ') + plural(c.totals.count, 'stop') + ' ' + esc(p.window.label) + ' came to <b>' + money(tot.value) + '</b> in robot time (' + (tot.basis === 'estimated' ? 'estimated from list prices' : 'from your numbers') + '). That is what the arms cost to own and run while they stood, not lost parts.');
      else if (c.totals.count === 0) parts2.push((p.robot ? who : 'The line') + ' had no stops ' + esc(p.window.label) + '.');
      if (fleet && !p.robot) parts2.push('The ' + plural(k.robots.filter(function (r) { return r.cost; }).length, 'arm') + ' cost ' + money(fleet.perHourCents.value) + ' an hour to own and run, working or waiting.');
      if (p.robot) {
        var rc = k.robots.filter(function (r) { return r.id === p.robot.id; })[0];
        if (rc && rc.cost) parts2.push(who + ' costs ' + money(rc.cost.perHourCents.value) + ' an hour: ' + esc(rc.cost.perHourCents.math) + '.');
      }
      return { html: parts2.join(' '), chips: ['Which robot works the least?'], view: 'dashv2' };
    }

    if (p.intent === 'count') {
      var hist = get(p.calls[0]);
      var n = hist.stopsThisMonth.count;
      var since = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric' }).format(hist.stopsThisMonth.since);
      return { html: n === 0 ? who + ' has not stopped since ' + esc(since) + '.' : 'That makes ' + plural(n, 'stop') + ' for ' + who + ' since ' + esc(since) + (n > 1 ? ', so the latest was the ' + ordinal(n) + '.' : '.'), chips: ['Why did ' + p.robot.name + ' stop this week?'], view: 'incidents' };
    }

    if (p.intent === 'least') {
      var ks = get('/api/v1/agent/costs');
      var rs = ks.robots.filter(function (r) { return r.workingShare; }).sort(function (a, b) { return a.workingShare.value - b.workingShare.value; });
      if (!rs.length) return { html: 'No robot has enough working time recorded this period to compare.', chips: [] };
      var low = rs[0];
      var rest = rs.slice(1).map(function (r) { return esc(r.name) + ' ' + r.workingShare.value + '%'; }).join(', ');
      return { html: '<b>' + esc(low.name) + '</b> works the least: ' + low.workingShare.value + '% of its scheduled time this period' + (rest ? '. Then ' + rest : '') + '. Some waiting is built into a line, so low is not always wrong.', chips: ['Why did ' + low.name + ' stop this week?', 'Was it the robot or the mill?'], view: 'robots' };
    }

    return { html: 'I could not place that question.', chips: SUGGESTED };
  }

  /** A new or changed stop from the Stop Watcher's feed, in one line. */
  function stopNotice(s, tz) {
    var lead = s.open ? esc(s.robot.name) + ' ' + (s.kind === 'offline' ? 'went offline' : 'hit a ' + esc(s.label)) + ' at ' + esc(clock(s.startedAt, tz)) : esc(s.robot.name) + ' is back after ' + s.minutes.value + ' min';
    return lead + (s.code ? ' (<code>' + esc(s.code) + '</code>)' : '') + (s.claimedBy ? '. ' + esc(s.claimedBy) + ' has it.' : '.');
  }

  return { plan: plan, answer: answer, stopNotice: stopNotice, findRobot: findRobot, windowFor: windowFor, SUGGESTED: SUGGESTED, esc: esc };
})();
if (typeof module !== 'undefined') module.exports = Mara;
