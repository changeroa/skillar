# Research manifest

This file lists every input behind `docs/design/web-ui-audit.md`, what was read, and what wasn't. Counts below were re-read from the reports in this folder on 2026-11-02, not copied from memory.

## Portable reports in this folder

| File | Origin | Origin SHA-256 | Origin bytes | What changed in the copy |
| --- | --- | --- | ---: | --- |
| `hig-report.md` | Lane research report `hig.md` | `2529ff285b51f24c7d95c85f2de22350d929e0620821e75287730cc1c1d9c1bd` | 43,600 | A provenance comment was added and temporary extraction-cache paths were replaced with a generic description. The original had no private home paths. |
| `frontend-audit.md` | Lane research report `frontend-audit.md` | `02924b7ee0ef11909d10e31c67f9c3e7926684d9d354ad511a256c4b64e53d82` | 97,928 | A provenance comment was added, and private absolute paths became `<repo>` (the skillar repository root) and `<frontend-skill-root>` (the locally installed frontend skill). No other text changed. |

The hashes identify the origin files as they were read. The copies differ from them only by the substitutions listed, so they won't hash to the same value.

## Source coverage

| Corpus | Coverage | Limits |
| --- | --- | --- |
| Apple Human Interface Guidelines | 160 slugs enumerated. 158 fetched as DocC JSON and read in full over three passes (55, 45 and 58 pages). Tables re-extracted for the first 55 pages. `links` and `tooltips` returned 404. | Images, video and inline cross-reference link text weren't extracted on any page. Swatch-only tables carry no values. Mapping pt to CSS px and HIG contrast to WCAG is the researcher's interpretation. The extraction caches lived in a temporary directory and aren't preserved. |
| Local frontend skill references | 172 reference files plus `SKILL.md`, 173 files, 2,681,188 bytes, 37,467 lines, all read in full. Groups: 95 design, 47 designpowers, 2 perfection, 28 ui-ux-db. | The manifest in `frontend-audit.md` has 173 data rows, which matches. Per-file semantic extraction was model-assisted; decision-critical quotes were checked against source. |
| Impeccable guidance | 49 documents at pinned tree `e89e3ada3e875a89ac2c5d33d11e65ebef6fe285` of https://github.com/pbakaus/impeccable, 493,335 bytes, 6,080 lines. | The manifest has 49 data rows, which matches. Generated provider copies and engine code weren't audited. |
| Combined guidance | 222 files, 3,174,523 bytes, 43,547 lines. | |
| Product source | 11 files under `site/` plus root `README.md`, read in full with hashes (see `frontend-audit.md`, "Product source coverage"). | `local/dashboard/main.tsx:105-162` and `local/dashboard/DESIGN.md:119-136` were read for taxonomy only. Binary artwork wasn't visually reviewed. |
| StyleGallery | SaaS settings and sticky-header spatial contracts consulted. | Pattern guidance only, no code imported. |
| beui.dev | Input and action-swap source consulted for label and feedback anatomy. | React dependencies and decorative motion rejected. |
| Baseline screenshots | Phone 390 px at DPR 3 and desktop 1440 px, light and dark, captured before this work. | They live in the lane evidence store and aren't committed. Full-page phone capture hit the 16,383 px compositor limit (G13). They are baseline evidence, not proof of any fix. |

## Not inspected

Externally linked product sites, Lazyweb screenshots, StyleGallery server internals, beui and react-bits registries, Open Design's expanded library, and Impeccable's generated copies. No browser QA, screen reader run, Lighthouse run or build was done for the research. Hosted login, setup and dashboard screens didn't exist when the research ran, so every finding about them is a prospective requirement.

## Review provenance

An independent advisory plan audit asked for complete research and a reporting cadence, then approved the revised plan. The native plan-reviewer wasn't available in that session, so no plan-reviewer receipt exists. This folder doesn't claim one.
