# Component visual evidence

Skillar is a Preact application. This harness captures live DOM specimens,
computed geometry, real hover/focus/held-pointer states and optional Langfuse
references without introducing a second renderer or a browser dependency.

Run `npm ci` in site and local, then:

```sh
cd site && npm run dev -- --port 5177
# another terminal, from local:
npm run dev:dashboard
# use its printed port for the local gallery URL
```

Both serve `/__gallery.html?theme=light` (also dark/system). The gallery is not
included in either production build. Restart local dev after CSS asset changes.

```sh
OMOWRIGHT_HELPER=/path/to/browser/scripts/omowright.mjs \
  node scripts/uxb/capture.mjs manifest.json /absolute/evidence/directory
```

The supplied browser adapter attaches to Chrome on port 9333. It creates one
owned tab, never opens a second browser, and closes only that tab on exit.
Stop the run if Chrome freezes. Runs stop below 8 GiB free on `/`.

Manifest shape (paths are relative to the manifest):

```json
{
  "requireReferences": true,
  "profiles": [
    { "id": "desktop", "width": 1440, "height": 900 },
    { "id": "phone", "width": 390, "height": 844, "touch": true, "deviceScaleFactor": 3 }
  ],
  "pages": [{
    "id": "site",
    "url": "http://127.0.0.1:5177/__gallery.html",
    "ready": "#gallery[data-ready=true]",
    "states": [{
      "name": "control-hover",
      "selector": "[data-component=control] [data-state=hover]",
      "action": "hover",
      "expected": { "height": 32, "fontSize": 13, "lineHeight": 20, "hovered": true },
      "touchExpected": { "height": 44 },
      "reference": { "light": "langfuse-light.png", "dark": "langfuse-dark.png" }
    }]
  }]
}
```

Phone captures use mobile layout, touch/coarse pointer and DPR 3; the harness
asserts the real CSS viewport, DPR and pointer mode rather than trusting labels.
For isolated component parity, `isolateSpecimens: true` places each live
`[data-specimen]` card at the same integer origin with a 242px sample column,
before layout and interaction. It restores both inline styles afterward.
This avoids comparing fractional descendant positions from different gallery
rows. The real components are neither cloned nor raster-resized. Input
spellcheck is disabled in this synthetic fixture on both sides, and previous
focus/selection is cleared before each state. Full-page captures still show
the normal gallery. `focusSelector` can target an inner input while `selector`
continues to capture the complete search shell and its ring.
Each profile runs light and dark, top/end viewport captures plus every named
specimen. Crop padding is 4px for rings. Actions: none, hover, focus (trusted
Shift+Tab/Tab), active (pointer held until after capture). Specimen geometry
is cropped from the full composited viewport on integer device pixels, rather
than asking Chrome to repaint a fractional CSS clip. Temporary relative layout
offsets align its origin; two animation frames observe the resulting paint.
CSS `translate` is deliberately avoided because it interpolates border pixels.
The specimen must fit
the viewport; use a larger profile for taller specimens.
Specimen geometry
must match within 1px; strings, booleans, colors and ARIA values match exactly.
Provide computed upstream properties through `expected`; the harness never
guesses them from an image.
Use `themeExpected: { "light": {...}, "dark": {...} }` for exact theme colors,
and `profileReferences: { "phone": { "light": "...", "dark": "..." } }` when
responsive states need different reference crops.

Reference images are never resized. The side-by-side canvas preserves each
input's pixels; dimension mismatch fails. The diff includes alpha differences,
with changed pixels in magenta. Results record original dimensions and ratios.
The default RGB channel tolerance is zero. `pixelChannelTolerance: 2` is an
explicit opt-in for demonstrated rounded-edge rasterization noise, not a color
token tolerance. Raw differing pixels and maximum channel delta are always
recorded and highlighted, including within-tolerance pixels; alpha differences
always fail. Computed color and geometry checks remain exact/1px respectively.
For the separately rendered raw-CSS reference, `compare.mjs` also accepts an
explicit final argument `8`: RGB deltas up to 8 only in the four rounded-corner
boxes (4px crop inset, measured radius, scaled by DPR). Interior pixels remain
zero-tolerance and alpha always remains exact. The default is still zero.
Results retain every raw pixel difference, per-channel maxima, accepted corner
counts, and the policy coordinates. Use this only with a recorded edge-raster
diagnosis; it cannot accept text/icon or flat-color drift.

```sh
node scripts/uxb/compare.mjs captures/results.json upstream site,local diffs 8
node scripts/uxb/keyboard.mjs site-gallery-url local-gallery-url keyboard-evidence
node scripts/uxb/screens.mjs matrix-config.json screen-evidence
node scripts/uxb/screens.mjs matrix-config.json screen-evidence summary
```

These commands use the same `OMOWRIGHT_HELPER` environment variable. Screen
captures force a fresh document for each build cookie, record asset URLs and
document identities, and use a unique fetch counter plus exact DOM/paint signals.
Missing provided screen references produce a labelled `no reference` panel;
the summary lists provided and absent filenames without failing before/after
delivery.

Missing references fail by default. A foundation-only metrics run may set
`requireReferences: false`, but its PASS proves metrics, **not upstream parity**.
Review `results.json` and cite the side/diff files; a numeric pass does not
replace independent visual or accessibility review.

Fixtures carry no user data. The page owns its existing scroll and control
behavior. For async components, use a ready selector reflecting the settled
state; there are no sleeps or retry loops. Tests run with `site/npm test`.
