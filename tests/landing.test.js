/*
 * Behaviour tests for the Coraly landing pages, run through the jsdom scroll harness.
 * These validate LOGIC, not pixels (see harness.js header).
 *
 *   node tests/landing.test.js          # run, exits non-zero if anything fails
 *   npm test                            # same, via package.json
 *
 * Since the app went live (June 2026) there is a single page: index.html is the App Store
 * launch page. The old coming-soon/TestFlight page and its launch.html twin were removed.
 * Add a test by calling test('name', () => { ... assert(...) }).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPage } = require('./harness');

// Single live page since launch (June 2026): index.html IS the App Store launch page. The old
// coming-soon/TestFlight page and its launch.html twin were removed once the app went live.
const PAGES = {
  'index.html':  path.join(__dirname, '..', 'index.html'),
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

/* ============ page suite ============ */
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

/* ============ launch CTA guard — the live page points at the App Store, not TestFlight ===========
 * Since launch, index.html must carry the App Store call to action and must NOT regress to the old
 * coming-soon TestFlight CTA. */
test('index.html uses the App Store CTA (no leftover TestFlight / coming-soon CTA)', () => {
  const src = fs.readFileSync(PAGES['index.html'], 'utf8');
  assert(src.includes('https://apps.apple.com/app/id6778913380'), 'App Store link is missing');
  assert(!/testflight\.apple\.com/.test(src), 'a TestFlight link is still present');
  assert(!/Try it early|Try Coraly early on TestFlight/.test(src), 'coming-soon TestFlight CTA text is still present');
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
