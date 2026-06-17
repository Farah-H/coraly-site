/*
 * Behaviour tests for the Coraly landing pages, run through the jsdom scroll harness.
 * These validate LOGIC, not pixels (see harness.js header).
 *
 *   node tests/landing.test.js          # run, exits non-zero if anything fails
 *   npm test                            # same, via package.json
 *
 * The shared ride/gate/slider checks run against BOTH index.html (the live coming-soon
 * page) and launch.html (the launch-day page) so the two can't silently drift apart.
 * Add a test by calling test('name', () => { ... assert(...) }).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPage } = require('./harness');

const PAGES = {
  'index.html':  path.join(__dirname, '..', 'index.html'),
  'launch.html': path.join(__dirname, '..', 'launch.html'),
};

// Simulated geometry of the two scroll rides. Heights mirror the CSS (.sev = 200vh,
// .trend = 220vh) at an 800px viewport; top0 values just need to be consistent.
const LAYOUT = {
  '#sevdemo':   { top0: 800,  height: 1600 },   // 200vh
  '#trenddemo': { top0: 2400, height: 1760 },   // 220vh
};
const VH = 800;

function open(file, extra = {}) {
  return loadPage(file, { innerHeight: VH, innerWidth: 1280, layout: LAYOUT, ...extra });
}

/* ---------- tiny test runner (no framework dependency) ---------- */
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

/* ============ shared suite — runs against every page ============ */
function rideSuite(label, file) {
  test(`[${label}] loads with no script errors`, () => {
    const h = open(file);
    assert(h.errors.length === 0, 'JS errors: ' + h.errors.join(' | '));
  });

  /* The live WebGL "pond" was retired (Jun 2026) in favour of the static warm background — there should
     be no canvas and no WebGL context created on any device, including desktop where it used to run. */
  test(`[${label}] the WebGL pond is retired — no canvas, no WebGL anywhere`, () => {
    const h = open(file, { deviceMemory: 8 });
    assert(!h.exists('#pond'), 'the #pond canvas should be gone');
    assert(h.counters.getContext === 0, 'no WebGL context should ever be created');
  });

  /* The "once it's in" story is now a STATIC, naturally-scrolled feature section built from real
     app screenshots (assets/once/*.png) — not the old pinned/scrubbed sev & trend rides. */
  test(`[${label}] "once it's in" feature section exists; the old scrubbed sev/trend rides are gone`, () => {
    const h = open(file);
    assert(h.exists('#onceitsin'), '#onceitsin vertical feature section is missing');
    assert(!h.exists('#sevdemo'),   'old scrubbed #sevdemo ride should be replaced, not present');
    assert(!h.exists('#trenddemo'), 'old scrubbed #trenddemo ride should be replaced, not present');
  });
}

rideSuite('index.html', PAGES['index.html']);
rideSuite('launch.html', PAGES['launch.html']);

/* ============ parity guard — index.html and launch.html must be IDENTICAL except the CTA ===========
 * The two pages are the same site; the ONLY intended difference is the call to action:
 * index.html = TestFlight ("Try it early"), launch.html = App Store ("Get the app" / "Download
 * on the App Store"). This normalises every known CTA difference to a placeholder, then requires
 * the two files to be byte-identical. Any other divergence (a fix landing on one page but not the
 * other, a stray edit) fails loudly and points at the first differing line. */
function normalizeCTA(s) {
  return s
    .replace(/<small>Try it early on<\/small>TestFlight/g, '__CTA_PILL__')      // inline applepills
    .replace(/<small>Download on the<\/small>App Store/g,  '__CTA_PILL__')
    .replace(/Try Coraly early on TestFlight/g, '__CTA_ARIA__')                 // mcta aria-label
    .replace(/Get Coraly on the App Store/g,    '__CTA_ARIA__')
    .replace(/Try it early/g, '__CTA_LABEL__')                                  // compact pill text
    .replace(/Get the app/g,  '__CTA_LABEL__')
    .replace(/https:\/\/testflight\.apple\.com\/join\/NeDKevPZ/g, '__CTA_URL__')// links (incl. JSON-LD installUrl)
    .replace(/https:\/\/apps\.apple\.com\/app\/id6778913380/g,    '__CTA_URL__')
    .replace(/brand-black (?:TestFlight|App Store) CTA right/g, '__CTA_COMMENT__');
}

test('index.html and launch.html are identical except for the CTA wording/link', () => {
  const a = normalizeCTA(fs.readFileSync(PAGES['index.html'], 'utf8')).split('\n');
  const b = normalizeCTA(fs.readFileSync(PAGES['launch.html'], 'utf8')).split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert(a.length === b.length && i === a.length,
    'index.html and launch.html have drifted beyond the CTA (line ' + (i + 1) + '):\n' +
    '      index:  ' + (a[i] === undefined ? '<end of file>' : a[i].trim()) + '\n' +
    '      launch: ' + (b[i] === undefined ? '<end of file>' : b[i].trim()) + '\n' +
    '      The two pages must stay the same except the TestFlight vs App Store CTA.');
});

/* ============ snap guard — the how-it-works pin must settle on whole steps ============
 * jsdom can't feel the settle, but it CAN guarantee the snap config and its labelled
 * rest-states survive future edits, so the page never rests on a mid-pan view again. */
test('index.html: how-it-works pin snaps to labelled rest-states (never a mid-pan view)', () => {
  const src = fs.readFileSync(PAGES['index.html'], 'utf8');
  assert(/snapTo:\s*'labels'/.test(src), "nearest-label snap (snapTo:'labels') is missing");
  for (const label of ['hero', 'logged', 'step1', 'step2']) {
    assert(src.includes("addLabel('" + label + "'"), 'rest-state label "' + label + '" is missing');
  }
});

/* The visual progression renderer (tests/visual) reads the rest-states live from the page via
 * window.__HOW__ when loaded with ?coralyRender=1, so every screen we add to the timeline appears
 * in both contact sheets automatically. Guard that hook so the tool can't silently break. */
test('index.html: exposes the ?coralyRender hook for the visual progression renderer', () => {
  const src = fs.readFileSync(PAGES['index.html'], 'utf8');
  assert(/coralyRender/.test(src), '?coralyRender render flag is missing');
  assert(/window\.__HOW__/.test(src), 'window.__HOW__ (states + pin range) is not exposed');
});

/* Mobile is a SEPARATE experience, not the desktop narrative reflowed: a >900px branch runs the
 * pinned/scrubbed/snapped cinematic, and a <=900px branch runs native vertical scroll. Guard that
 * the two branches stay split (and that mobile never pins). */
test('index.html: desktop and mobile run separate matchMedia branches', () => {
  const src = fs.readFileSync(PAGES['index.html'], 'utf8');
  assert(/\(min-width:1200px\) and \(prefers-reduced-motion: no-preference\)/.test(src), 'desktop (>=1200px) branch is missing');
  assert(/\(max-width:1199px\) and \(prefers-reduced-motion: no-preference\)/.test(src), 'mobile/tablet (<=1199px) native branch is missing');
});

/* The "once it's in" section must use REAL app screenshots (assets/once/*.png), one per shipped
 * feature, and must not regress back to the old scrubbed sev/trend markup. */
test('index.html: "once it\'s in" section references the five real app screenshots', () => {
  const src = fs.readFileSync(PAGES['index.html'], 'utf8');
  assert(/id="onceitsin"/.test(src), '#onceitsin section is missing');
  for (const img of ['know', 'catch', 'trend', 'remind', 'private']) {
    assert(src.includes('assets/once/' + img + '.png'), 'missing real screenshot assets/once/' + img + '.png');
  }
  assert(!/id="sevdemo"|id="trenddemo"/.test(src), 'old scrubbed sev/trend sections must be gone');
});

/* ============================ run ============================ */
let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + tests.length + ' total');
process.exit(fail ? 1 : 0);
