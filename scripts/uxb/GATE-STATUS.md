# PR-1 re-review correction evidence

PR: https://github.com/changeroa/skillar/pull/100, base main, remains draft.
Evidence root E: /Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-1.
The a52bb33 review found two invalid source PNGs; its previous blanket
172/172 claim is superseded by this correction. Exact final head, all CI
checks and final-head gate receipts are in E/rereview-publication.json.

## Corrections

- Audit all 86 original Demo sources: exactly light checked/hover Checkbox
  fail the expected-state pixel check. Both are recaptured from the view-only
  Demo. New captures require nonblank pixels, visible contrasting fill/check,
  center hit-testing, and stable pre/post bounds and state. All 86 now pass.
  Inventories and full-height option PNGs were visually inspected.
- Restore Input/SearchInput 2px accent focus-visible rings with a 2px gap.
  This owner-approved accessibility difference does not replicate the Demo's
  zero-spread field shadow. Real-browser regression fails before the fix;
  it asserts visible normal and forced-color focus in both apps/themes.
- Capture the actual Skeleton pulse at 0ms/opacity 1, after animation.ready
  and paint signals, matching the product's reduced-motion static frame.
  The comparator now checks opacity exactly.
- Badge/Tag alpha and opacity match the Demo. Dark modal references have a
  different backing surface (rgb(23,23,23)) than the standalone gallery
  (rgb(15,15,15)); no primitive alpha correction is justified. Raw differences
  remain counted. See E/transparent-surfaces.json.

## Gates and remaining cases

E/rereview-results.md and E/rereview-summary.json enumerate all 172 final-head
pairs, including exact computed matches, eight approved focus differences,
eight separately classified native adaptations and every raw pixel difference.
Native options retain the original popup PNG and closed-trigger style reference.
No masks, pixel threshold changes or corner allowance are used.

Site regression tests: 368 pass. Site build, local typecheck and local build
exit 0. Fresh real-browser keyboard/AX/touch and forced-color focus evidence
is retained with the final-head receipts. The unchanged backend suite is
covered by exact-head Runtime CI; the historical local /tmp/h ENOTDIR is
not edited or weakened. MJS TypeScript and CSS Biome LSP services are absent;
Node syntax checks and actual compiler/build checks supply validation.

Approved 32px desktop/44px touch geometry and native form semantics remain.
Selected Button retains aria-pressed/check without an invented wash. Prior
selected/copying/copied/error evidence remains supplementary and unchanged;
no unobserved state is relabeled an actual Demo instance. Earlier full legacy
screen evidence is historical, not fresh validation for this head.

No dependency, lockfile, licensing, production route or existing screen
composition change. No new preview, production deployment, merge or account
write. Owned test servers are stopped after final verification; Chrome 9333
and the original OS clipboard are preserved.
