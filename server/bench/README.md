# Search regression benchmark

Run from the repository root after `npm --prefix server run build`:

```sh
node server/bench/search.mjs --check
```

The default `catalog.json` contains 12 entirely synthetic skill metadata entries, including two explicit-only entries. It contains no private catalog metadata or skill bodies and is used only by this benchmark, never for runtime routing or installation. Connected catalogs are unchanged; their results depend on their own names, descriptions and keywords.

The 36 maintainer-authored cases contain 28 expected matches in Korean, English, and mixed-language queries, plus 8 no-match queries. They measure Hit@1, Hit@5, MRR, negative abstention, exact-name lookup, invocation filtering, and warm/cold local search latency. Cases and metadata were developed together: this is a regression suite, not an independent holdout or proof of live catalog quality. Local timings exclude network and agent overhead.

CI requires Hit@1 ≥ 90%, Hit@5 ≥ 98%, all negative and exact-name cases passing, preserved invocation policy, and warm p95 below 20 ms. Cold index construction is reported separately and can cost more than legacy matching.

Use `--inventory path.json` or `--skills-root /path/to/skills` to evaluate other metadata. Pass `--cases path.json` when that catalog has its own expected skill names; every case has an `id`, `query`, and `expected` name array. `--output report.json` saves detailed results. `--mode legacy` and `--implementation /path/to/skill-search.ts` support comparisons. `--save-inventory path.json` saves a metadata-only snapshot.

## Content-authoring validation

The database and accessibility entries in this fixture are regression data, not published skill packages. The repository does not own production `database-query` or `accessibility-check` `SKILL.md` files, so this change makes no claim about a connected catalog. The documented external authoring repository is [`changeroa/iyen-skills`](https://github.com/changeroa/iyen-skills); its maintainers must add or update the relevant content and publish it through that repository.

Before that content is published, run the repository-owned validation path against its checkout:

```sh
node server/bench/validate-metadata.mjs --skills-root /absolute/path/to/iyen-skills/skills
node server/bench/search.mjs --skills-root /absolute/path/to/iyen-skills/skills --cases /absolute/path/to/iyen-skills/search-cases.json --check
```

`validate-metadata.mjs` is read-only. It requires a nonempty `name`, `description`, and `keywords` list, preserves the server's directory/name identity rule, and rejects normalized duplicate or generic standalone keywords within one skill. Use `npm --prefix server run lint:skill-metadata` to validate this synthetic fixture. Keep the source ID, skill directory, and frontmatter `name` unchanged for a metadata-only update so the canonical URI remains stable; use bilingual domain terms such as `DB`/`디비` and `screen reader`/`스크린리더` only on the content they accurately describe. The validator and benchmark leave no files behind unless `--output` or `--save-inventory` is explicitly requested.

This benchmark change does not publish skill content, install a personal plugin, or deploy a server.
