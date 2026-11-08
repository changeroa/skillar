# Production content boundary

## What this worktree owns

`git ls-files '*SKILL.md'` lists only these five repository-owned packages:

```text
clients/codex/skillar/SKILL.md
clients/gajae-code/plugin/subskills/interview/SKILL.md
clients/oh-my-openagent/skillar/SKILL.md
clients/openclaw/plugin/skills/skillar/SKILL.md
plugins/skillar/skills/skillar/SKILL.md
```

They are client/loader guidance packages. None is `database-query`, `accessibility-check`, or a production skill for slow-query review or screen-reader labeling. The only matching names in this worktree are benchmark, local-evaluation, or test fixtures. Therefore this repository has no relevant production `SKILL.md` manifest to edit for issue #32.

## External catalog inspection (read-only)

The catalog repository documented by this checkout is `changeroa/iyen-skills`, owned by GitHub account `changeroa`. At inspection time its `main` commit was `35c40243315da262ed1a2cd5898d669b26f03816`.

Its primary `skills/` tree has related but non-equivalent packages:

| Path | Blob | Observed scope | Metadata consequence |
| --- | --- | --- | --- |
| `skills/testing-database/SKILL.md` | `ca9369e143062cf7c6cb1bbce2e2637e6d089427` | Database integration tests, DBMS, migrations, transactions, and test-data lifecycle. | Frontmatter has `name` and Korean/English description but no `keywords`; it is not a slow-query-plan skill. |
| `skills/review-client-runtime/SKILL.md` | `ccea7f1bce00f794a9f84bbe1b9352b75f137b8e` | Client-runtime correctness; UI-05 mentions dynamic status announcements and says static source cannot prove observed screen-reader behavior or accessibility conformance. | Frontmatter has `name`, description, and metadata version, but no `keywords`; it is not an `accessibility-check` skill. |

The external tree has no `skills/database-query/SKILL.md` or `skills/accessibility-check/SKILL.md` path. Read-only code search found no `디비`, no `스크린리더`, and no exact `screen reader` phrase in that catalog; `screen-reader` occurs in `review-client-runtime`. Existing related packages must not be relabeled without the content owner's scope decision.

## Required external owner data and publication

A production fix requires the `changeroa/iyen-skills` content owner to:

1. Identify the semantically correct existing package(s), or author a new package, for slow database query performance and for screen-reader/accessibility review. This worktree cannot make that decision from synthetic names.
2. In that catalog's canonical `skills/<name>/SKILL.md`, add accurate bilingual `keywords` and, where useful, description wording. Preserve an existing package directory and `name` when making a metadata-only edit so its canonical URI stays stable. Record content-owned expected query-to-URI cases.
3. Commit/merge the catalog change to `main`. Its `validate.yml` runs on push and pull request, executes `npm run validate`, and runs catalog/publisher/serving tests against a pinned `changeroa/skillar` runtime.
4. After validation, a catalog maintainer must manually dispatch `publish-r2.yml`. The workflow requires an explicitly configured `SKILLAR_RELEASE_BASE_URL`, reuses validation, then runs `node scripts/publish-r2.mjs` with repository publication credentials to upload, verify, pin-read, and promote an immutable release.

This branch did not write the external catalog, dispatch its workflow, publish R2 content, or change a deployed catalog. Consequently it must not be described as a production metadata improvement.
