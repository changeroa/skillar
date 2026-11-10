# PR-3 shell gate ledger

Base: `origin/main` at `7bc3da9`. Branch: `uxb/pr-3-shell`.
Evidence root: `/Users/iyen/.dori/state/lane-results/skillar-ux-phase-b-20261109/pr-3/`.
This checkpoint is not a completion claim. No merge or production deployment.

| Gate | Status | Evidence and limits |
| --- | --- | --- |
| 1. Component visual parity | FAIL: validation in progress | Real read-only Demo references in `demo/`, computed styles in `captures.json`. Raw drift is retained in `style-validation.json`; no pixel masks. |
| 2. Page comparison | FAIL: not yet complete | Production before/after fixture servers at 53090/53091, baseline worktree pinned to `7bc3da9`. |
| 3. Keyboard and accessibility | FAIL: browser matrix pending | 374 site tests pass. Real trusted shortcut reopening has been driven; complete browser receipts are pending. |
| 4. Structural R1-R7 | FAIL: not yet complete | Existing assertions will run unchanged against the production fixtures. |
| 5. Build and tests | FAIL locally; CI pending | Site 374/374 and builds/typechecks pass. Local 984/985: the known pre-existing `/tmp/h` ENOTDIR in cli-init; never changed or deleted. |
| 6. License and provenance | FAIL: final audit pending | Three shipped notice files identify the pinned MIT shell sources; local dry-run pack passes. |
| 7. Deployment verification | FAIL: preview and final-head CI pending | Not deployed; deploy gated on owner. Only non-production `uxb-pr-3` is authorized. |

## Owner overrides

32px mouse controls, 44px coarse-pointer or <=768px controls; visible focus;
correct WAI-ARIA semantics; native links and dialogs. The validator gives
owner sizing precedence even if the upstream and product share a wrong size.
Zero-width border colours are non-painted, not visual mismatches.

## Standing-rule supplementary references

The read-only Demo routes `/traces`, `/sessions`, `/prompts` and
`/prompts/answer%20question` expose no disabled Tabs or navigation controls.
The components themselves have live captures. Only unreachable disabled states
may use the labelled actual pinned MIT renderer in `/tmp/uxb/pr3-reference`;
it imports the original components, not translated HTML or product CSS.
Default, hover, focus-visible, collapsed, filtered, empty and underline states
that Demo exposes remain live-Demo comparisons. No settings, writes or errors
were induced. Independent review is arranged by the lane lead.
