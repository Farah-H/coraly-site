# Coraly landing-page tests

Behaviour tests for the scroll-driven landing pages (`index.html`), run in
[jsdom](https://github.com/jsdom/jsdom). No browser, no system libraries, no build step.

```bash
npm install      # once, installs jsdom (dev only)
npm test         # runs tests/landing.test.js — exits non-zero on any failure
```

## Visual progression sheets (real browser)

jsdom proves the logic; it cannot show you what a frame *looks like*. For that there is a
real-browser renderer that drives `index.html` and screenshots the how-it-works pin at two
cadences, stitching each into one contact sheet:

```bash
npm run shots    # writes tests/visual/output/{fast_snap_states,slow_scroll_progression}.png
```

- **fast_snap_states.png** — one frame per rest-state (where the snap settles).
- **slow_scroll_progression.png** — a frame every ~half-viewport scroll (what you see after
  each average-sized scroll).

**POLICY — every new screen must appear in both sheets.** The fast sheet is generated from the
timeline's **labels** (read live via `window.__HOW__`), so the rule is simply: when you add a
screen to the how-it-works timeline, give it an `addLabel('name', t)` at its rest point. It
then shows up in the fast sheet automatically, and the slow sheet covers it by construction.
Re-run `npm run shots` and review both before considering the change done. See
[`tests/visual/README.md`](visual/README.md) for how it works and how it stays portable.

## Why jsdom and not a real browser

The pages are scroll-driven: pinned "rides" whose state is computed from
`getBoundingClientRect()` on every animation frame. A real headless browser (Playwright,
Puppeteer) is the gold standard, but Chromium won't launch in every environment — it needs
system libraries and privileges a locked-down sandbox may not have. jsdom is pure
JavaScript, so it runs anywhere Node does. It executes the page's **real** script, lets us
fake the scroll position, pump the animation frames, and read back what each element does.

This is the same "synthetic-scroll headless suite" approach noted in the project handoff.

## What these tests CAN and CANNOT catch

**Can** (behaviour / logic):
- JS errors on load.
- The pond performance gate: WebGL is skipped on phones, coarse pointers, and low-memory
  devices, and attempted on desktop.
- Reduced-motion removes the pond.
- The severity ride starts calm, climbs, classifies (Normal → Elevated → High → Very High),
  and is never blank.
- Progress bars advance 0 → 100%.
- The manual slider sets a reading and holds it (accessibility path).
- The trend ride advances.

**Cannot** (pixels / layout): jsdom does no CSS layout or painting. It will **not** catch a
caption overlapping an image, an element sized wrong, an overflow, or a contrast failure.
For those, use a real browser — take a screenshot, or serve the file
(`python3 -m http.server`) and open it. Treat a green run here as "the logic is sound", then
eyeball the layout.

## How scroll is simulated

jsdom returns an all-zero `getBoundingClientRect()` (it does no layout). `harness.js`
overrides it: for any selector you list in `layout`, it returns a rect whose `top = top0 -
scrollY` and a fixed `height`, so the page's own progress maths
(`-rect.top / (height - innerHeight)`) behaves just like a real browser of height
`innerHeight`. `setScroll(y)` (or `progressFor(selector, p)`) moves the scroll, fires a real
`scroll` event, and pumps frames until the eased motion settles.

## Adding a test

```js
const { loadPage } = require('./harness');
const h = loadPage(path.join(__dirname, '..', 'index.html'), {
  innerHeight: 800,
  layout: { '#sevdemo': { top0: 800, height: 1600 } },   // 200vh ride
  media:  { '(max-width:900px)': true },                  // pretend to be a phone
  deviceMemory: 8,
});
h.progressFor('#sevdemo', 0.5);          // scroll the ride to 50%
assert(/High/.test(h.text('#sev-badge')));
```

Handles returned by `loadPage`: `$`, `text(sel)`, `style(sel, prop)`, `opacity(sel)`,
`exists(sel)`, `setScroll(y)`, `progressFor(sel, p)`, `pump(frames)`, `errors`, `counters`
(e.g. `counters.getContext`), plus raw `window` / `document`.

## Security / trust boundary

This harness is for **first-party, trusted HTML only** (the repo's own pages). Two notes:

- It loads pages with jsdom's `runScripts: 'dangerously'`, which executes the page's inline
  JavaScript. That is exactly what lets us test real behaviour, but it means you should never
  point `loadPage` at HTML you don't control.
- It does **not** enable jsdom's `resources: 'usable'`, so external sub-resources (image,
  script, stylesheet `src`/`href`) are **not** fetched — the tests make no network requests.
- `package-lock.json` is committed and `jsdom` is pinned to a major version, so installs are
  reproducible and a changed/malicious dependency patch can't slip in unnoticed.
- All paths are resolved relative to the test files (`__dirname`); nothing hardcodes a
  machine path, username, or home directory.

## Testing a mockup

The harness works on any HTML file, including the narrative-scroll concept that currently
lives in the design-notes folder (`Coraly/Landing_Design/narrative-scroll.html`). Point
`loadPage` at its path and drive `#story`. When a mockup graduates into this repo, copy its
checks into `landing.test.js` so they run with the rest.
