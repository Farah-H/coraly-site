/*
 * jsdom scroll-simulation harness for the Coraly landing pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * The landing pages are scroll-driven (pinned "rides" whose state is computed from
 * getBoundingClientRect on each animation frame). A real headless browser is the ideal
 * way to test them, but Chromium will not launch in every environment (missing system
 * libraries, no sandbox privileges). jsdom is pure JavaScript, so it runs anywhere Node
 * runs. It executes the page's REAL script, lets us fake the scroll position, pump the
 * animation frames, and read back what every element actually does.
 *
 * WHAT IT CAN AND CANNOT CATCH
 * ----------------------------
 *   CAN  : animation/scroll LOGIC. Does progress advance? Is a scene/reading always
 *          visible (never blank)? Does severity classify correctly? Does the pond gate
 *          skip WebGL on mobile? Does the slider lock? Are there JS errors on load?
 *   CANNOT: pixel LAYOUT. jsdom does no CSS layout or painting, so it will NOT catch a
 *          caption overlapping an image, a wrong size, or a contrast problem. Those still
 *          need a real browser (a screenshot, or serve the file and open it).
 *
 * HOW SCROLL IS FAKED
 * -------------------
 * jsdom returns getBoundingClientRect() = all-zeros (it does no layout). We override it:
 * for any selector listed in `layout`, we return a rect whose `top` = top0 - scrollY and a
 * fixed `height`, so the page's own progress maths (-rect.top / (height - innerHeight))
 * behaves exactly as it would in a browser of height `innerHeight`. Everything else returns
 * zeros. setScroll(y) updates the scroll position, dispatches a real 'scroll' event, and
 * pumps animation frames until the eased motion settles.
 */
'use strict';
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

function zeroRect() {
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return {}; } };
}

/**
 * loadPage(htmlPath, options) -> test handle
 *
 * options:
 *   innerHeight  (default 800)   simulated viewport height
 *   innerWidth   (default 1280)  simulated viewport width
 *   media        ({})            map of media-query string -> boolean for matchMedia
 *   layout       ({})            map of selector -> { top0, height } describing geometry
 *                                at scrollY 0. top0 is the element's distance from the top
 *                                of the document; height is its full scroll height.
 *   deviceMemory (8)             navigator.deviceMemory value
 *   getContext   (()=>null)      canvas.getContext implementation (return null to force the
 *                                pond's graceful no-WebGL fallback). Calls are counted.
 */
function loadPage(htmlPath, options = {}) {
  const {
    innerHeight = 800,
    innerWidth = 1280,
    media = {},
    layout = {},
    deviceMemory = 8,
    getContext = () => null,
  } = options;

  const html = fs.readFileSync(htmlPath, 'utf8');
  const errors = [];
  const scroll = { y: 0 };
  const rafQ = [];
  const counters = { getContext: 0 };

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e && e.message ? e.message : String(e)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.innerWidth = innerWidth;
      window.innerHeight = innerHeight;

      window.matchMedia = q => ({
        matches: !!media[q], media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      });

      window.IntersectionObserver = class {
        constructor(cb) { this._cb = cb; }
        observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
      };

      try {
        Object.defineProperty(window.navigator, 'deviceMemory', { value: deviceMemory, configurable: true });
      } catch (e) { /* some jsdom versions seal navigator; non-fatal */ }

      // animation-frame queue we control (deterministic pumping)
      window.requestAnimationFrame = cb => { rafQ.push(cb); return rafQ.length; };
      window.cancelAnimationFrame = () => {};

      if (!window.performance || typeof window.performance.now !== 'function') {
        window.performance = { now: () => Date.now() };
      }

      // pages may call these; make them harmless no-ops
      window.scrollTo = () => {};
      window.scroll = () => {};

      // spyable canvas context (default null = exercise the no-WebGL path)
      window.HTMLCanvasElement.prototype.getContext = function (...a) {
        counters.getContext++;
        return getContext.apply(this, a);
      };

      // scroll-aware getBoundingClientRect driven by the `layout` map
      window.Element.prototype.getBoundingClientRect = function () {
        for (const sel in layout) {
          if (typeof this.matches === 'function' && this.matches(sel)) {
            const g = layout[sel];
            const top = (g.top0 || 0) - scroll.y;
            return {
              top, bottom: top + g.height, left: 0, right: innerWidth,
              width: innerWidth, height: g.height, x: 0, y: top, toJSON() { return {}; },
            };
          }
        }
        return zeroRect();
      };
    },
  });

  const window = dom.window;
  const document = window.document;

  // Run queued animation frames. The pages' master loop re-queues itself every frame, so
  // `frames` is literally how many frames we advance. Defaults high enough to settle an
  // eased lerp (factor ~0.14-0.16 reaches target in well under 100 frames).
  function pump(frames = 150) {
    for (let i = 0; i < frames; i++) {
      const batch = rafQ.splice(0, rafQ.length);
      for (const cb of batch) {
        try { cb(i * 16.7); } catch (e) { errors.push('raf: ' + (e && e.message ? e.message : e)); }
      }
    }
  }

  function setScroll(y, frames) {
    scroll.y = y;
    window.dispatchEvent(new window.Event('scroll'));
    pump(frames);
  }

  const $ = sel => document.querySelector(sel);
  const exists = sel => !!$(sel);
  const text = sel => { const el = $(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
  const style = (sel, prop) => { const el = $(sel); return el ? el.style[prop] : null; };
  const opacity = sel => { const el = $(sel); if (!el) return null; const o = el.style.opacity; return o === '' ? 1 : parseFloat(o); };

  pump(); // let the page initialise (master loop, first paint at scrollY 0)

  return {
    dom, window, document, errors, counters, scroll,
    pump, setScroll, $, exists, text, style, opacity,
    progressFor(selector, p) {
      // convenience: scroll a `layout` section to fractional progress p (0..1)
      const g = layout[selector];
      if (!g) throw new Error('no layout entry for ' + selector);
      const total = g.height - innerHeight;
      setScroll((g.top0 || 0) + p * total);
    },
  };
}

module.exports = { loadPage };
