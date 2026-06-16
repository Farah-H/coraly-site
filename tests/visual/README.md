# Visual progression renderer

Renders the **real** `index.html` in a headless browser and produces two contact sheets so a
human can review every scroll state at a glance:

```bash
npm run shots
# -> tests/visual/output/fast_snap_states.png
# -> tests/visual/output/slow_scroll_progression.png
```

Output is git-ignored — regenerate locally; don't commit the PNGs.

## The policy this enforces

**Every screen we add to the how-it-works timeline must appear in both sheets.** You don't edit
this script to make that happen. The fast sheet is built from the timeline's labels, read live
from the page:

- Loaded with `?coralyRender=1`, `index.html` exposes `window.__HOW__` = the rest-state labels
  (name + time), the timeline duration, and the live pin scroll range.
- The renderer turns each label into one fast frame, and samples the whole pin range every
  ~half-viewport for the slow frames.

So the only thing you do when adding a screen is give it a rest label in the timeline:

```js
.addLabel('myNewStep', t)   // t = the timeline time where that screen is fully settled
```

Re-run `npm run shots` and the new screen is in both sheets.

## Why `?coralyRender=1`

Under that flag the timeline uses **instant scrub** and **snap is disabled**, so each captured
frame is the true state at that exact scroll position — not a frame mid-snap-glide. The flag is
inert without it; production behaviour is unchanged.

## Portability / trust

- **No machine-specific paths.** The page is found relative to this file (`__dirname`); the
  browser is found via `CORALY_CHROMIUM` / `PUPPETEER_EXECUTABLE_PATH`, then a Playwright cache
  or system Chrome. Nothing hardcodes a username, home directory, or absolute device path.
- **First-party only.** It renders this repo's own `index.html` over `file://`; it makes no
  network requests and loads no third-party page.
- **Reduced motion** is forced *off* for the motion media-query only (so the animated branch
  runs headless); the pond's width/pointer gates are left to the real `matchMedia`.
- On a minimal Linux sandbox missing `libXdamage.so.1` (which headless Chromium links but does
  not use), the script will, only if `gcc` is present, compile a tiny stub into the temp dir and
  add it to `LD_LIBRARY_PATH`. On a normal machine where the lib exists this step is skipped.
- `puppeteer-core` is a pinned dev dependency and downloads **no** browser of its own — it drives
  whatever Chromium it finds.
