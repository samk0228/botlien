/* Botlien walkthrough capture.
   Drives the real prototype, draws a synthetic cursor and caption bar over it,
   and records the whole thing to webm. Deterministic: rerun after any prototype
   change and the video regenerates. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* Paths are overridable so this keeps working when playwright or chromium move.
   PLAYWRIGHT_DIR must point at a node_modules/playwright; CHROME_EXE at a
   chromium build. Both default to what is on this machine today. */
const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  '/Users/samuelkim/.npm/_npx/9833c18b2d85bc59/node_modules/playwright';
const EXE =
  process.env.CHROME_EXE ||
  '/Users/samuelkim/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const { chromium } = require(PW_DIR);

const OUT = path.join(__dirname, '.out'); // scratch, gitignored
const VID = path.join(OUT, 'video');
const PROTO = path.join(__dirname, '..', 'botlien-prototype.html');
const FINAL = path.join(__dirname, '..', '..', 'media', 'botlien-walkthrough.mp4');
const W = 1920,
  H = 1080;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(FINAL), { recursive: true });

// the published page is injected into a <body>, so the file has no <html> of its own
const wrapped = path.join(OUT, 'preview.html');
fs.writeFileSync(
  wrapped,
  '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    fs.readFileSync(PROTO, 'utf8') +
    '</body></html>'
);
fs.rmSync(VID, { recursive: true, force: true });

/* ---------- everything below runs inside the page ---------- */
function installOverlay() {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:Inter,system-ui,-apple-system,sans-serif';
  document.body.appendChild(wrap);

  const cur = document.createElement('div');
  cur.style.cssText =
    'position:absolute;left:0;top:0;width:30px;height:30px;transform:translate(960px,620px);will-change:transform;filter:drop-shadow(0 3px 7px rgba(9,14,28,.4));opacity:0;transition:opacity .4s';
  cur.innerHTML =
    '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4.5 1.8 L4.5 19.4 L9.1 15.2 L11.9 21.8 L15.1 20.4 L12.3 13.9 L18.6 13.5 Z" fill="#fff" stroke="#0b1020" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  wrap.appendChild(cur);

  const cap = document.createElement('div');
  cap.style.cssText =
    'position:absolute;left:50%;bottom:56px;width:min(1120px,84vw);box-sizing:border-box;opacity:0;' +
    'transform:translateX(-50%) translateY(16px);transition:opacity .45s cubic-bezier(.4,0,.2,1),transform .45s cubic-bezier(.4,0,.2,1);' +
    'background:rgba(11,16,32,.95);color:#fff;padding:22px 32px;border-radius:12px;box-shadow:0 20px 60px rgba(9,14,28,.45)';
  wrap.appendChild(cap);

  const card = document.createElement('div');
  card.style.cssText =
    'position:absolute;inset:0;background:#0b1020;color:#fff;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:20px;opacity:0;transition:opacity .6s ease';
  wrap.appendChild(card);

  const st = { x: 960, y: 620 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (e) => !e.closest('aside') && e.getBoundingClientRect().width > 0;
  const pick = (act, txt) => {
    const els = [...document.querySelectorAll('[data-act="' + act + '"]')].filter(vis);
    return txt ? els.find((e) => (e.innerText || '').includes(txt)) || null : els[0] || null;
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };

  window.__D = {
    wait,
    logo: () => (document.querySelector('aside img') || {}).src || '',
    showCursor(v) {
      cur.style.opacity = v ? '1' : '0';
      return wait(420);
    },
    async moveTo(x, y, ms) {
      ms = ms || 700;
      const sx = st.x,
        sy = st.y,
        t0 = performance.now();
      for (;;) {
        await raf();
        const p = Math.min(1, (performance.now() - t0) / ms),
          e = ease(p);
        st.x = sx + (x - sx) * e;
        st.y = sy + (y - sy) * e;
        cur.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
        if (p >= 1) break;
      }
    },
    ripple() {
      const r = document.createElement('div');
      r.style.cssText =
        'position:absolute;left:' + st.x + 'px;top:' + st.y + 'px;width:16px;height:16px;margin:-8px 0 0 -8px;' +
        'border-radius:50%;border:2px solid rgba(11,16,32,.8);background:rgba(11,16,32,.12);transform:scale(.4);' +
        'opacity:1;transition:transform .55s ease-out,opacity .55s ease-out';
      wrap.appendChild(r);
      requestAnimationFrame(() => {
        r.style.transform = 'scale(3.8)';
        r.style.opacity = '0';
      });
      setTimeout(() => r.remove(), 700);
      const base = 'translate(' + st.x + 'px,' + st.y + 'px)';
      cur.style.transition = 'transform .1s ease';
      cur.style.transform = base + ' scale(.8)';
      setTimeout(() => {
        cur.style.transform = base;
        setTimeout(() => (cur.style.transition = ''), 120);
      }, 100);
    },
    cap(t, s) {
      cap.innerHTML =
        '<div style="font-size:27px;font-weight:650;letter-spacing:-.016em;line-height:1.3">' + t + '</div>' +
        (s ? '<div style="font-size:17.5px;font-weight:400;color:rgba(255,255,255,.64);margin-top:10px;line-height:1.5">' + s + '</div>' : '');
      cap.style.opacity = '1';
      cap.style.transform = 'translateX(-50%) translateY(0)';
    },
    capOff() {
      cap.style.opacity = '0';
      cap.style.transform = 'translateX(-50%) translateY(16px)';
      return wait(500);
    },
    cardOn(html) {
      card.innerHTML = html;
      card.style.opacity = '1';
      return wait(720);
    },
    cardOff() {
      card.style.opacity = '0';
      return wait(720);
    },
    find: (act, txt) => {
      const el = pick(act, txt);
      return el ? center(el) : null;
    },
    hit: (act, txt) => {
      const el = pick(act, txt);
      if (!el) return false;
      el.click();
      return true;
    },
    selPos: (s) => {
      const el = document.querySelector(s);
      return el ? center(el) : null;
    },
    async scrollTo(y, ms) {
      ms = ms || 950;
      const sy = window.scrollY,
        t0 = performance.now();
      for (;;) {
        await raf();
        const p = Math.min(1, (performance.now() - t0) / ms);
        window.scrollTo(0, sy + (y - sy) * ease(p));
        if (p >= 1) break;
      }
    },
    scrollToText(t, ms, off) {
      const all = [...document.querySelectorAll('div,span,h1,h2,h3,p')];
      const leaves = all.filter((e) => e.children.length === 0);
      const el =
        leaves.find((e) => (e.textContent || '').trim() === t) ||
        leaves.find((e) => (e.textContent || '').trim().startsWith(t)) ||
        all.find((e) => (e.textContent || '').trim().startsWith(t));
      if (!el) return 'MISS:' + t;
      const y = window.scrollY + el.getBoundingClientRect().top - (off == null ? 170 : off);
      return this.scrollTo(Math.max(0, y), ms).then(() => 'ok');
    },
    async dragSlider(to, ms) {
      const el = document.getElementById('sensRange');
      if (!el) return 'MISS:sensRange';
      const from = +el.value,
        r = el.getBoundingClientRect(),
        t0 = performance.now();
      for (;;) {
        await raf();
        const p = Math.min(1, (performance.now() - t0) / (ms || 2200)),
          e = ease(p);
        const v = Math.round(from + (to - from) * e);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const frac = (v - +el.min) / (+el.max - +el.min);
        st.x = r.left + 8 + frac * (r.width - 16);
        st.y = r.top + r.height / 2;
        cur.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
        if (p >= 1) break;
      }
      return 'ok';
    },
  };
}

/* ---------- driver ---------- */
(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: VID, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  await page.goto('file://' + wrapped);
  await page.waitForTimeout(900);
  await page.evaluate(installOverlay);

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const cap = (t, s) => ev(([t, s]) => window.__D.cap(t, s), [t, s]);
  const capOff = () => ev(() => window.__D.capOff());
  const hold = (ms) => page.waitForTimeout(ms);
  const scrollText = async (t, ms, off) => {
    const r = await ev(([t, ms, off]) => window.__D.scrollToText(t, ms, off), [t, ms, off]);
    if (String(r).startsWith('MISS')) console.log('  !! scroll ' + r);
  };

  // poll until the target actually exists, so timing never depends on a guessed sleep
  async function waitAct(act, txt, ms) {
    const t0 = Date.now();
    for (;;) {
      const p = await ev(([a, t]) => window.__D.find(a, t), [act, txt]);
      if (p) return p;
      if (Date.now() - t0 > (ms == null ? 6000 : ms)) return null;
      await hold(160);
    }
  }

  async function click(act, txt, settle) {
    const p = await waitAct(act, txt);
    if (!p) {
      console.log('  !! MISS act=' + act + (txt ? ' txt=' + txt : ''));
      return false;
    }
    await ev(([x, y]) => window.__D.moveTo(x, y, 620), [p.x, p.y]);
    await hold(200);
    await ev(() => window.__D.ripple());
    await hold(140);
    await ev(([a, t]) => window.__D.hit(a, t), [act, txt]);
    await hold(settle == null ? 950 : settle);
    return true;
  }

  const T0 = Date.now();
  const mark = (n) => console.log('  [' + ((Date.now() - T0) / 1000).toFixed(1) + 's] ' + n);

  // ---- 0. title card
  const logo = await ev(() => window.__D.logo());
  await ev(
    (l) =>
      window.__D.cardOn(
        '<img src="' + l + '" style="width:56px;height:70px;object-fit:contain;filter:invert(1) brightness(2)">' +
          '<div style="font-size:70px;font-weight:700;letter-spacing:-.035em;margin-top:6px">Botlien</div>' +
          '<div style="font-size:24px;color:rgba(255,255,255,.66);font-weight:400;max-width:760px;text-align:center;line-height:1.5">' +
          'Coverage statements for financed robots</div>' +
          '<div style="font-size:15px;color:rgba(255,255,255,.36);font-weight:600;letter-spacing:.14em;margin-top:20px">A WALKTHROUGH</div>'
      ),
    logo
  );
  await hold(3200);
  await ev(() => window.__D.cardOff());
  mark('title');

  // ---- 1. sign in
  await ev(() => window.__D.showCursor(true));
  await cap(
    'You financed the robots. Can you tell whether they earned it?',
    'Botlien answers that once a month, and shows the arithmetic so you can check it by hand.'
  );
  await hold(5200);
  await capOff();

  await cap('There is no password.', 'Owners open Botlien monthly. A password used twelve times a year is a reset twelve times a year, so there is not one.');
  await hold(1000);
  const box = await ev(() => window.__D.selPos('#authEmail'));
  if (box) {
    await ev(([x, y]) => window.__D.moveTo(x, y, 620), [box.x, box.y]);
    await ev(() => window.__D.ripple());
    await page.click('#authEmail');
    // the app re-renders #root on every keystroke and restores focus by id, so the
    // input node is replaced mid-word. Type at the keyboard, not at a stale handle.
    await page.keyboard.type('sam@harborgrill.com', { delay: 65 });
  }
  await hold(1400);
  await capOff();
  await click('submitEmail', null, 1300);
  mark('sign in submitted');

  // ---- 2. check your email
  await cap('The link lands in your inbox.', 'One click and you are in. Nothing to remember, nothing to reset.');
  await hold(3800);
  await capOff();
  await click('openLinkNew', null, 900);
  await cap('Opening it signs you in.');
  await hold(2600);
  await capOff();
  mark('signed in');

  // ---- 3. first run, 4 steps
  await cap('First run, step 1 of 4.', 'What kind of work the robots do. This is what sets the replacement rates every figure is built on.');
  await hold(3600);
  await click('onboardPick', 'Restaurant', 700);
  await hold(900);
  await capOff();
  await click('onboardContinue', null, 1100);

  await cap('Step 2. How many locations.', 'One site or a group. A group gets a roll-up across all of them.');
  await hold(3400);
  await click('siteCount', '2 to 5', 700);
  await hold(700);
  await capOff();
  await click('firstRun3', null, 1100);

  await cap('Step 3. Who else needs to see it.', 'Your lender, your accountant, your general manager. Each with their own role.');
  await hold(4200);
  await capOff();
  if (!(await click('skipInvites', null, 1100))) await click('firstRun4', null, 1100);

  await cap('Step 4. Compare yourself to venues like yours, or do not.', 'Off unless you turn it on. Robot model and kind of work go in, nothing that identifies you.');
  await hold(4000);
  await click('toggleBenchmark', null, 900);
  await hold(1000);
  await capOff();
  await click('finishFirstRun', null, 1400);
  mark('first run done');

  // ---- 4. import
  await cap('Now the only real work.', 'Export a usage file from your robot vendor and drop it in. Botlien tells you where to find it for each one.');
  await hold(4600);
  await capOff();
  await click('uploadGood', null, 1800);
  await cap('It parses the file and tells you exactly what it matched.', 'Rows read, robots recognized, and any overlap with a period you already imported.');
  await hold(5000);
  await capOff();
  mark('imported');

  // ---- 5. the statement
  await ev(() => window.__D.scrollTo(0, 500));
  const toDash = await ev(() => {
    const el = [...document.querySelectorAll('aside [data-act="go"]')].find(
      (e) => e.getAttribute('data-view') === 'dash'
    );
    if (el) {
      el.click();
      return 'ok';
    }
    return 'MISS';
  });
  console.log('  dash nav: ' + toDash);
  await hold(1400);

  await cap('This is the whole product.', 'Work serviced, over lease invoiced. The division is printed on the page, not hidden behind a score.');
  await hold(5400);
  await capOff();
  await hold(600);

  await scrollText('What to fix first', 1100, 620);
  await cap('Four tiles.', 'What the work was worth, what each run cost, how hard they actually ran, and what you paid to lease them.');
  await hold(4800);
  await capOff();

  await scrollText('What to fix first', 900, 170);
  await cap('Then the part you can act on before lunch.', 'Findings ordered by what they are worth, each one carrying the arithmetic that priced it.');
  await hold(5200);
  await capOff();

  await scrollText('The one input you cannot measure', 900, 190);
  await cap('There is one number nobody can measure.', 'How fast a person would do the same work. So Botlien hands you the dial instead of hiding it.');
  await hold(4600);
  await ev(() => window.__D.dragSlider(58, 2400));
  await hold(1500);
  await ev(() => window.__D.dragSlider(20, 2400));
  await hold(1600);
  await capOff();
  await cap('Every figure re-prices live as you drag.', 'The ratio holds up across the whole range, which is the argument. It is a robustness check, not a disclosure.');
  await hold(5000);
  // back to the app's default (S.throughput = 30) so the closing shot shows the
  // same headline figure the viewer was given up top, not a dragged one
  await ev(() => window.__D.dragSlider(30, 1600));
  await hold(900);
  await capOff();
  mark('sensitivity');

  await scrollText('Against your own last five periods', 900, 190);
  await cap('Against your own last five periods.');
  await hold(3800);
  await capOff();

  await scrollText('Against venues like yours', 900, 190);
  await cap('And against venues like yours.', 'Only if you opted in back in step 4.');
  await hold(3800);
  await capOff();

  await scrollText('Why it moved', 900, 190);
  await cap('Every move is attributed.', 'You are never left guessing why the number changed since last month.');
  await hold(4400);
  await capOff();

  await scrollText('By kind of work', 900, 190);
  await cap('Broken out by the kind of work.', 'Tray runs and cleaning hours price differently, so they are never averaged together.');
  await hold(4400);
  await capOff();
  mark('statement done');

  // ---- 6. the rest of the nav
  const nav = async (view, title, sub, ms) => {
    await ev(() => window.__D.scrollTo(0, 450));
    const p = await ev((v) => {
      const el = [...document.querySelectorAll('aside [data-act="go"]')].find(
        (e) => e.getAttribute('data-view') === v
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, view);
    if (!p) {
      console.log('  !! MISS nav ' + view);
      return;
    }
    await ev(([x, y]) => window.__D.moveTo(x, y, 600), [p.x, p.y]);
    await hold(180);
    await ev(() => window.__D.ripple());
    await ev((v) => {
      [...document.querySelectorAll('aside [data-act="go"]')]
        .find((e) => e.getAttribute('data-view') === v)
        ?.click();
    }, view);
    await hold(1100);
    await cap(title, sub);
    await hold(ms || 4200);
    await capOff();
  };

  await nav('robots', 'Robot by robot.', 'So you know which specific unit to renegotiate or send back.', 4600);
  await nav('condition', 'Condition.', 'Consumable life remaining, so a part gets replaced before it fails and takes a shift with it.', 4800);
  await nav('rates', 'The replacement rates behind every figure.', 'Effective dated and kept with their history, so a closed period never changes underneath you.', 5000);
  await nav('sites', 'And all three sites, rolled up.', 'One number for the group, with each site still standing on its own.', 4600);

  // ---- 7. export + close
  await ev(() => {
    [...document.querySelectorAll('aside [data-act="go"]')]
      .find((e) => e.getAttribute('data-view') === 'dash')
      ?.click();
  });
  await hold(1200);
  await cap('Then export it.', 'A PDF for your lender, a CSV for your accountant, or a share link that never needs an account.');
  await hold(2200);
  await click('toggleExport', null, 900);
  await hold(2600);
  await capOff();
  await ev(() => window.__D.showCursor(false));
  mark('export');

  await ev(
    (l) =>
      window.__D.cardOn(
        '<img src="' + l + '" style="width:48px;height:60px;object-fit:contain;filter:invert(1) brightness(2)">' +
          '<div style="font-size:44px;font-weight:650;letter-spacing:-.03em;max-width:1000px;text-align:center;line-height:1.28;margin-top:14px">' +
          'Are these robots covering what you pay for them?</div>' +
          '<div style="font-size:21px;color:rgba(255,255,255,.6);font-weight:400;margin-top:10px">Botlien</div>'
      ),
    logo
  );
  await hold(4000);
  mark('end card');

  const vp = await page.video().path();
  await ctx.close();
  await browser.close();
  console.log('  raw webm: ' + vp);

  // playwright writes variable-rate webm; normalise to a 30fps h264 mp4 that
  // Keynote, Slack and iMessage will all accept
  execFileSync(
    'ffmpeg',
    ['-y', '-i', vp, '-vf', 'fps=30,scale=1920:1080:flags=lanczos', '-c:v', 'libx264',
     '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  execFileSync(
    'ffmpeg',
    ['-y', '-ss', '5', '-i', FINAL, '-frames:v', '1', '-update', '1',
     path.join(path.dirname(FINAL), 'poster.png')],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  const mb = (fs.statSync(FINAL).size / 1048576).toFixed(1);
  console.log('\nDONE  ' + FINAL + '  (' + mb + 'MB)');
})();
