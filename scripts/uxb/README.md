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
Each profile runs light and dark, top/end viewport captures plus every named
specimen. Crop padding is 4px for rings. Actions: none, hover, focus (trusted
Shift+Tab/Tab), active (pointer held until after capture). Specimen geometry
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
Missing references fail by default. A foundation-only metrics run may set
`requireReferences: false`, but its PASS proves metrics, **not upstream parity**.
Review `results.json` and cite the side/diff files; a numeric pass does not
replace independent visual or accessibility review.

Fixtures carry no user data. The page owns its existing scroll and control
behavior. For async components, use a ready selector reflecting the settled
state; there are no sleeps or retry loops. Tests run with `site/npm test`.
