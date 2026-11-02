# P0 local parity goldens

Run from the repository root, after the local package has been built:

```sh
node --test local/test/parity*.test.mjs
```

The harness imports `local/dist` and uses `node:sqlite`, not a mock or a second
implementation of Store. It never builds or installs dependencies. Missing built
modules or FTS5/trigram support fail the run rather than skip a parity assertion.

The JSON files are versioned inputs and explicit expectations for later adapters:

- `migrations.json`: schema 001 is `schema.sql`; upgrade entry points 1 through 6,
  preserved rows, tracing keys, lifetime backfill, candidate proofs and triggers,
  null historical cuts, and migration-006 baseline marks.
- `session-substring.json`: session filtering, separate from skill search.
  A string may be encoded as `{ "repeat": "x", "count": 4094, "suffix": "..." }`;
  expand it as `repeat.repeat(count) + suffix`. This encodes large input strings,
  never expected results. Expected session IDs are compared as sets.
- `recording-order.json`: fixed source/destination lineage names, same-time
  endpoint membership, receipt order rather than lexical ID order, delayed
  interior evidence, export/import provenance and duplicate identity collisions.
- `search-ranking.json`: FTS column weights, numeric BM25 and one-based ranks,
  fused search order/scores, trigram minimum Unicode code-point length, and
  independently indexed local/expanded corpora.

BM25 constants are derived from the formula recorded in the fixture, not captured
from `FtsIndex.search`. Numeric tolerance is relative `1e-12` with absolute floor
`1e-15`. The fixture avoids equal-score FTS ties: SQLite's tie order is not a
cross-platform contract. Search trace UUIDs, elapsed time and generated workflow
IDs are excluded; persisted recording domains are fixed before observations.

Nulls stay null in SQL goldens; missing optional span timestamps stay absent in
Store goldens, distinct from explicit zero. This does not assert that every
aggregate exposes unknown: existing Store `abstainRate` is zero for no searches.
The attribution-rate fixture explicitly distinguishes no MCP observations from
observed zero attributed events.

The harness makes no D1 compatibility, remote isolation, cost/size, CI, or
platform-probe claim. Corpus separation here means independent SQLite databases
per catalog profile, not filtering a shared FTS table after global BM25 ranking.
