# Consent-aware real-query search evaluation

`real-search.mjs` is an independent evaluator for a real-query dataset. It is not
an automated quality gate and does not make a production-quality claim. The
existing synthetic regression benchmark remains `search.mjs --check`.

## Before authoring

Do not add user queries, session text, account identifiers, or private catalog
metadata to this repository. A genuine dataset must be prepared outside the
repository from an active consent record. Its evaluator input records the
ledger reference, when it was verified, deidentification method and evaluation
purpose, and retention policy/expiry. A session label is not consent; in
particular, labels maintained by the separate PR #42 work do not satisfy this
requirement.

The committed fixture under `fixtures/real-search/` is entirely synthetic and
nonprivate. It verifies the runner contract only. Its results are not evidence
about a production catalog, real users, or search quality. Do not replace it
with old organization-specific cases or claim that it is a genuine holdout.

## Input contract

The evaluator accepts one JSON input and a separate metadata-only catalog:

```sh
node server/bench/real-search.mjs \
  --input /secure/evaluation.json \
  --catalog /secure/catalog.json \
  --split holdout \
  --output report.json
```

The input schema is `real-search-evaluation/v1` and has these required fields:

```json
{
  "schema_version": "real-search-evaluation/v1",
  "dataset": {
    "id": "opaque-dataset-id",
    "digest": "sha256:<canonical-dataset-hash>",
    "consent_ledger": {
      "id": "ledger-reference",
      "status": "active",
      "verified_at": "2026-11-08T00:00:00.000Z"
    },
    "deidentification": {
      "method": "documented transformation",
      "purpose": "independent search evaluation"
    },
    "retention": {
      "policy": "documented retention rule",
      "expires_at": "2026-12-08T00:00:00.000Z"
    }
  },
  "catalog": {
    "commit": "<40-or-64-character-lowercase-git-commit>",
    "digest": "sha256:<raw-catalog-bytes-hash>"
  },
  "splits": {
    "tune": ["source-or-author-group-a"],
    "holdout": ["source-or-author-group-b"]
  },
  "cases": [
    {
      "id": "opaque-case-id",
      "group": "source-or-author-group-b",
      "query": "deidentified query text",
      "decision": "match",
      "judgments": [
        {
          "uri": "skill://catalog-authority/path/SKILL.md",
          "judgment": "relevant"
        }
      ]
    }
  ]
}
```

`status: "synthetic"` is permitted only for fixtures containing no user data.
A genuine dataset uses `status: "active"`; the runner validates the reference
shape but cannot independently prove an external ledger.

The dataset digest is SHA-256 over canonical JSON (object keys sorted,
no whitespace) of this object:

```json
{
  "schema_version": "...",
  "dataset": { "...all dataset fields except digest...": "..." },
  "splits": { "...": "..." },
  "cases": ["..."]
}
```

The catalog digest is SHA-256 over the exact catalog file bytes. The catalog
must be a JSON array of metadata-only documents with canonical `skill://.../SKILL.md`
URIs. Every judged URI must be present in that pinned snapshot.

Each group is exclusively tune or holdout and every declared group must have a
case. Keep all related prompts from one participant, session, source, or
annotation batch in one group. Use `--split holdout` for independent reporting;
never retune on a holdout result. The default is `holdout`.

Each case makes an explicit `match` or `abstain` decision. A `match` has at
least one `relevant` URI. An `abstain` has only `irrelevant` URIs. Use:

- `relevant` for a direct answer; it drives Hit@1, Hit@5, MRR, and recall@5.
- `supporting` for useful context that is not a direct answer; it is retained
  in the row report but does not turn a strict direct-answer metric into a hit.
- `irrelevant` for an evaluated non-answer.

Before publishing an evaluation, judge every candidate that can appear in the
top five. A returned top-five URI with no judgment makes that case `unjudged`.
It remains in the denominator and receives zero credit rather than being
silently dropped.

## Reports, comparisons, and timing

Reports include Hit@1, Hit@5, MRR, recall@5, correct no-match abstentions,
false positives, misses, failures, and unjudged cases. Match-case denominators
include failures and unjudged cases. Recall's denominator includes all labeled
`relevant` URIs from selected cases, including those in failed or unjudged
queries. No-match rates use all selected abstain cases.

`--compare prior-report.json` refuses to compare unless dataset digest, catalog
digest, and catalog commit are identical. Do not compare different annotation
cuts or catalog snapshots.

The runner measures local search-function latency and reports it under
`latency.local`. It does not pretend that this is MCP latency. If full MCP
latencies are captured separately, pass a `real-search-mcp-latency/v1` file:

```json
{
  "schema_version": "real-search-mcp-latency/v1",
  "provenance": {
    "dataset": { "digest": "sha256:<same-dataset-digest>" },
    "catalog": { "commit": "<same-commit>", "digest": "sha256:<same-catalog-digest>" }
  },
  "samples": [{ "case_id": "opaque-case-id", "duration_ms": 12.4 }]
}
```

The runner validates that identity before recording `latency.full_mcp`
separately. Missing samples remain visible; do not combine local and full-MCP
percentiles.
