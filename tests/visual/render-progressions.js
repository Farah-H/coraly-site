/*
 * Visual progression renderer for the Coraly landing page.
 * ---------------------------------------------------------------------------
 * Drives the REAL index.html in a headless browser and screenshots the
 * how-it-works pin at two cadences, for each device viewport, then stitches
 * each into one contact sheet:
 *
 *   <device>/fast_snap_states.png        — one frame per rest-state (where snap lands).
 *                                          Read live from the timeline's labels (window.__HOW__),
 *                                          so EVERY screen we add appears automatically.
 *   <device>/slow_scroll_progression.png — a frame every ~half-viewport of scroll (what you see
 *                                          after each average-sized scroll).
 *
 * Devices: desktop (1440x900), ipad (834x1194 portrait), phone (390x844). Narrow widths trip the
 * page's own max-width:900px rules, so the iPad/phone sheets show the real responsive layout
 * (column step layouts, the scroll cues hidden, etc).
 *
 * Output goes to tests/visual/output/<device>/ (git-ignored). Run it with:  npm run shots
 *
 * The page is loaded with ?coralyRender=1 (instant scrub, snap off) so each frame is the true
 * state at that scroll position. Reduced-motion is forced OFF so the animated branch runs.
 * Browser lookup is portable (CORALY_CHROMIUM / PUPPETEER_EXECUTABLE_PATH, then a Playwright
 * cache or system Chrome); no machine-specific paths are baked in.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const PAGE = 'file://' + path.join(REPO, 'index.html') + '?coralyRender=1';
const OUT = path.join(__dirname, 'output');
const SLOW_SCROLL_VH = 0.5;          // "one average scroll" ~= half a viewport
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
  { name: 'desktop', w: 1440, h: 900,  dsf: 1, mobile: false },
  { name: 'ipad',    w: 834,  h: 1194, dsf: 2, mobile: true  },
  { name: 'phone',   w: 390,  h: 844,  dsf: 2, mobile: true  },
];

/* ---------- portable Chromium lookup ---------- */
function findChromium() {
  const env = process.env.CORALY_CHROMIUM || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;
  const c = [];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw)) if (/^chromium/.test(d)) {
    c.push(path.join(pw, d, 'chrome-linux', 'chrome'));
    c.push(path.join(pw, d, 'chrome-linux', 'headless_shell'));
    c.push(path.join(pw, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    c.push(path.join(pw, d, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  }
  c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  c.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  c.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  for (const p of c) if (p && fs.existsSync(p)) return p;
  for (const b of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = cp.execSync('command -v ' + b, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (e) {}
  }
  return null;
}

/* ---------- best-effort libXdamage stub for minimal Linux sandboxes ---------- */
function ensureLibs() {
  if (process.platform !== 'linux') return;
  let have = false;
  try { have = cp.execSync('ldconfig -p 2>/dev/null').toString().includes('libXdamage.so.1'); } catch (e) {}
  if (have) return;
  const dir = path.join(os.tmpdir(), 'coraly-render-libs');
  const so = path.join(dir, 'libXdamage.so.1');
  try {
    if (!fs.existsSync(so)) {
      fs.mkdirSync(dir, { recursive: true });
      const src = path.join(dir, 'x.c');
      fs.writeFileSync(src,
        'typedef unsigned long XID;\n' +
        'int  XDamageQueryExtension(void*a,int*b,int*c){if(b)*b=0;if(c)*c=0;return 0;}\n' +
        'XID  XDamageCreate(void*a,XID b,int c){return 0;}\n' +
        'void XDamageDestroy(void*a,XID b){}\n' +
        'void XDamageSubtract(void*a,XID b,XID c,XID d){}\n');
      cp.execSync('gcc ' + JSON.stringify(src) + ' -shared -fPIC -Wl,-soname,libXdamage.so.1 -o ' + JSON.stringify(so), { stdio: 'ignore' });
    }
    process.env.LD_LIBRARY_PATH = dir + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
  } catch (e) { /* no gcc — fine on a normal machine where the lib exists */ }
}

/* ---------- contact-sheet builder (uses the browser, no ImageMagick needed) ---------- */
async function buildSheet(browser, title, cells, cols, cellW, outFile) {
  const fig = cells.map(c => {
    const b64 = fs.readFileSync(c.file).toString('base64');
    return '<figure><img src="data:image/png;base64,' + b64 + '"><figcaption>' + c.label + '</figcaption></figure>';
  }).join('');
  const html =
    '<style>body{margin:0;background:#141414;font:16px -apple-system,Segoe UI,Roboto,sans-serif}' +
    'h1{color:#fff;font-size:18px;font-weight:600;padding:18px 20px 4px}' +
    '.grid{display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:14px;padding:14px 20px 24px}' +
    'figure{margin:0}img{width:100%;display:block;border:1px solid #2a2a2a}' +
    'figcaption{color:#f0f0f0;font-size:14px;padding:7px 2px;letter-spacing:.02em}</style>' +
    '<h1>' + title + '</h1><div class="grid">' + fig + '</div>';
  const p = await browser.newPage();
  await p.setViewport({ width: cols * cellW + 40, height: 800, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: outFile, fullPage: true });
  await p.close();
}

/* ---------- render one device ---------- */
async function renderDevice(browser, dev) {
  const outDir = path.join(OUT, dev.name);
  const frameDir = path.join(outDir, 'frames');
  fs.mkdirSync(frameDir, { recursive: true });

  const page = await browser.newPage();
  // headless Chromium reports prefers-reduced-motion: reduce; force no-preference for the motion
  // queries only, and delegate everything else (the pond's width/pointer gates) to the real impl.
  await page.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => {
      if (!/prefers-reduced-motion/.test(q)) return real(q);
      // force reduced-motion = no-preference, but still honour any width/other conditions for real
      const rmOK = /no-preference/.test(q) ? true : (/reduce/.test(q) ? false : true);
      const rest = q.replace(/and\s*\(prefers-reduced-motion:[^)]*\)/g, '')
                    .replace(/\(prefers-reduced-motion:[^)]*\)\s*and/g, '')
                    .replace(/\(prefers-reduced-motion:[^)]*\)/g, '').trim();
      const restOK = rest ? real(rest).matches : true;
      return { matches: rmOK && restOK, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } };
    };
  });
  await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: dev.dsf });
  await page.goto(PAGE, { waitUntil: 'networkidle0' });
  await sleep(1400);

  const how = await page.evaluate(() => (typeof window.__HOW__ === 'function' ? window.__HOW__() : null));
  if (!how || !how.fast || !how.slow) { throw new Error('window.__HOW__ missing on ' + dev.name + ' — is the ?coralyRender hook present?'); }
  const range = how.slow.end - how.slow.start;
  const pct = y => range > 0 ? Math.round((y - how.slow.start) / range * 100) : 0;

  async function shotY(file, y) {
    await page.evaluate(yy => { window.scrollTo(0, yy); if (window.ScrollTrigger) window.ScrollTrigger.update(); }, Math.round(y));
    await sleep(420);   // let scroll-driven UI (e.g. the mobile sticky CTA slide-in) settle before capture
    await page.screenshot({ path: file });
  }

  // FAST — one frame per key state: rest-states on desktop, section tops on mobile (read live)
  const fastCells = [];
  for (let i = 0; i < how.fast.length; i++) {
    const s = how.fast[i];
    const file = path.join(frameDir, 'fast_' + String(i).padStart(2, '0') + '_' + s.name + '.png');
    await shotY(file, s.y);
    fastCells.push({ file, label: 'SNAP ' + (i + 1) + '  ·  ' + s.name + '  ·  ' + pct(s.y) + '%' });
  }

  // SLOW — a frame every ~half-viewport of scroll across the whole range
  const steps = Math.max(1, Math.round(range / (SLOW_SCROLL_VH * dev.h)));
  const slowCells = [];
  for (let k = 0; k <= steps; k++) {
    const y = how.slow.start + (k / steps) * range;
    const file = path.join(frameDir, 'slow_' + String(k).padStart(2, '0') + '.png');
    await shotY(file, y);
    slowCells.push({ file, label: 'scroll → ' + Math.round(k / steps * 100) + '%' });
  }

  // sheet layout: portrait device frames tile more columns / narrower cells than wide desktop ones
  const fastCols = dev.mobile ? 4 : 2;
  const slowCols = dev.mobile ? 5 : 3;
  const cellW = dev.mobile ? 250 : 480;
  const cap = dev.name.toUpperCase() + ' (' + dev.w + '×' + dev.h + ')';
  await buildSheet(browser, cap + ' — Fast scroll · where snap settles (' + fastCells.length + ' rest-states)', fastCells, fastCols, cellW, path.join(outDir, 'fast_snap_states.png'));
  await buildSheet(browser, cap + ' — Slow scroll · after each ~half-viewport scroll (' + slowCells.length + ' frames)', slowCells, slowCols, cellW, path.join(outDir, 'slow_scroll_progression.png'));
  await page.close();
  return { fast: fastCells.length, slow: slowCells.length };
}

(async () => {
  const exe = findChromium();
  if (!exe) {
    console.error('No Chromium found. Set CORALY_CHROMIUM=/path/to/chrome (or install Playwright/Chrome) and retry.');
    process.exit(2);
  }
  ensureLibs();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader']
  });
  for (const dev of DEVICES) {
    const r = await renderDevice(browser, dev);
    console.log('OK  ' + dev.name.padEnd(8) + ' · ' + r.fast + ' rest-states, ' + r.slow + ' slow frames  ->  tests/visual/output/' + dev.name + '/');
  }
  await browser.close();
})().catch(e => { console.error('RENDER FAIL:', e.message); process.exit(1); });
