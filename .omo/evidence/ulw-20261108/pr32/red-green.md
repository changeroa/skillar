# Synthetic metadata RED/GREEN

## Data source and command

`server/src/skill-search.ts` is unchanged between the two metadata snapshots. This command compares the immutable upstream-main fixture with the branch fixture through the built search implementation:

```sh
node --input-type=module <<'EOF'
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { searchSkills } from './server/dist/skill-search.js';
const before = JSON.parse(execFileSync('git', ['show', 'd7e907e:server/bench/catalog.json'], { encoding: 'utf8' }));
const after = JSON.parse(await readFile('./server/bench/catalog.json', 'utf8'));
for (const [phase, catalog] of [['red', before], ['green', after]]) {
  console.log(phase, searchSkills(catalog, '디비 병목을 찾아줘', 'discovery'));
}
EOF
```

- RED source: `d7e907e:server/bench/catalog.json` (`upstream/main` before this branch).
- GREEN source: `eec5260:server/bench/catalog.json` (this branch's synthetic benchmark fixture).

## Exact discovery results

| Query | RED (`d7e907e`) | GREEN (`eec5260`) |
| --- | --- | --- |
| `느린 쿼리` | `database-query` — `skill://fixture/demo/database-query/SKILL.md` | same |
| `디비 병목을 찾아줘` | no results | `database-query` — `skill://fixture/demo/database-query/SKILL.md` |
| `스크린리더 레이블을 점검해줘` | no results | `accessibility-check` — `skill://fixture/demo/accessibility-check/SKILL.md` |
| `screen reader labels` | `accessibility-check` — `skill://fixture/demo/accessibility-check/SKILL.md` | same |

The GREEN change adds `DB`, `디비`, `database`, `스크린리더`, `화면 낭독기`, and `screen reader labels` only to the 12-entry synthetic benchmark catalog. The fixture URI remains canonical for that fixture; it is not a production URI.

## Benchmark result

```sh
node server/bench/search.mjs --check
```

Current run: 12 synthetic entries; 36 maintainer-authored cases; Hit@1 1.0; Hit@5 1.0; MRR 1.0; negative abstention 1.0; exact-name accuracy 1.0; invocation policy preserved; 720 warm samples with p50 `0.013291 ms` and p95 `0.016250 ms`; 30 cold samples with p95 `0.250292 ms`; no misses.

These timings are local fixture measurements only. They exclude network, external-catalog, and agent overhead.
