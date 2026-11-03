# Branding verification

- Site: commit 4b819ce, based on main 720222f.
- Regression suite: npm test, 89 passed, 0 failed, exit 0.
- Build: shared production build and site strict TypeScript/Vite build, exit 0.
- Patch: git diff --check, clean.
- GitHub Site build: run 41575714986 passed, including all 89 tests and the
  production build: https://github.com/changeroa/skillar/actions/runs/41575714986
- Structural comparison: all four HTML bodies byte-identical to main outside
  the wordmark home link; all non-brand CSS rules byte-identical.
- Metadata: every route has adaptive SVG + 16/32/48 ICO, Apple icon, manifest,
  absolute OG URL and image dimensions, and both theme-specific wordmark paths.
- Lighthouse: three mobile and three desktop real-Chrome runs per route.
  Median performance/accessibility/SEO: 100 on every route. Homepage best
  practices: 100. Account/connect/dashboard best practices: 96 because the
  static Vite preview does not implement /auth/session. The same finding and
  96 score reproduce on untouched main; no auth or backend code changed.
- Editor diagnostics unavailable: configured Biome is not installed; brand
  scripts have no workspace TypeScript server. Runtime verification and the
  site strict compiler/build are the evidence, not an invented LSP pass.
- Assets: complete generation and verifier exit 0; native-size parent visual
  inspection; independent asset review st_01a19f8c APPROVE, no blockers.
- Rendered text contrast was measured on all seven views in both themes:
  minimum 5.44:1 in light and 6.75:1 in dark; zero values below 4.5:1.
- All 42 final viewport/theme cases measured a single loaded 120px wordmark,
  at least a 44px home-link target, and no horizontal document overflow.

Static preview screenshots contain no account identity. No claim of a new
authentication or screen-reader certification is made by this branding check.
