import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const runner = resolve(root, "server/bench/real-search.mjs");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const sha256 = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "skillar-real-search-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const uri = "skill://fixture.example/registration-flow/SKILL.md";
  const catalog = [{
    uri,
    name: "registration-flow",
    description: "Synthetic registration confirmation flow for runner validation.",
    keywords: ["registration confirmation", "synthetic fixture"],
    automatic: true,
    digest: "synthetic-nonprivate-catalog-entry",
  }, {
    uri: "skill://fixture.example/registration-guide/SKILL.md",
    name: "registration-guide",
    description: "A synthetic supporting guide for the registration flow.",
    keywords: ["registration guide"],
    automatic: true,
    digest: "synthetic-nonprivate-supporting-entry",
  }, {
    uri: "skill://fixture.example/astronomy-window/SKILL.md",
    name: "astronomy-window",
    description: "Astronomical window observations for a harmless fixture.",
    keywords: ["window observation"],
    automatic: true,
    digest: "synthetic-nonprivate-unjudged-entry",
  }];
  const catalogPath = join(directory, "catalog.json");
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(catalogPath, catalogText);
  const dataset = {
    id: "synthetic-runner-contract",
    consent_ledger: {
      id: "synthetic-fixture-no-user-data",
      status: "synthetic",
      verified_at: "2026-11-08T00:00:00.000Z",
    },
    deidentification: {
      method: "entirely synthetic nonprivate text",
      purpose: "validate the real-search runner contract only",
    },
    retention: {
      policy: "versioned synthetic fixture with no user data",
      expires_at: "2099-12-08T00:00:00.000Z",
    },
  };
  const splits = { tune: ["synthetic-author-a"], holdout: ["synthetic-author-b"] };
  const cases = [
    {
      id: "synthetic-relevant-holdout",
      group: "synthetic-author-b",
      query: "review the synthetic registration confirmation flow",
      decision: "match",
      judgments: [
        { uri, judgment: "relevant" },
        { uri: catalog[1].uri, judgment: "supporting" },
      ],
    },
    {
      id: "synthetic-no-match-holdout",
      group: "synthetic-author-b",
      query: "basalt telescope calibration ledger",
      decision: "abstain",
      judgments: catalog.map(document => ({ uri: document.uri, judgment: "irrelevant" })),
    },
    {
      id: "synthetic-tune-match",
      group: "synthetic-author-a",
      query: "read the registration guide",
      decision: "match",
      judgments: [
        { uri: catalog[1].uri, judgment: "relevant" },
        { uri, judgment: "supporting" },
      ],
    },
  ];
  const datasetDigest = sha256(canonical({ schema_version: "real-search-evaluation/v1", dataset, splits, cases }));
  const input = {
    schema_version: "real-search-evaluation/v1",
    dataset: { ...dataset, digest: datasetDigest },
    catalog: { commit: "a".repeat(40), digest: sha256(catalogText) },
    splits,
    cases,
  };
  const inputPath = join(directory, "evaluation.json");
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return { catalog, catalogPath, directory, input, inputPath, reportPath: join(directory, "report.json") };
}

function run(args) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
}

test("real-search runner binds the synthetic holdout to digests and scores relevant and abstain decisions", async t => {
  const data = await fixture(t);
  const result = run(["--input", data.inputPath, "--catalog", data.catalogPath, "--output", data.reportPath]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(data.reportPath, "utf8"));
  assert.equal(report.split, "holdout");
  assert.equal(report.provenance.dataset.digest, data.input.dataset.digest);
  assert.equal(report.provenance.catalog.digest, data.input.catalog.digest);
  assert.equal(report.metrics.hit_at_1, 1);
  assert.equal(report.metrics.hit_at_5, 1);
  assert.equal(report.metrics.mrr, 1);
  assert.equal(report.metrics.recall_at_5, 1);
  assert.equal(report.metrics.no_match.correct_abstentions, 1);
  assert.equal(report.metrics.no_match.false_positives, 0);
  assert.deepEqual(report.metrics.denominators, {
    cases: 2,
    match_cases: 1,
    relevant_judgments: 1,
    no_match_cases: 1,
    failures: 0,
    unjudged: 0,
  });
  assert.equal(report.latency.full_mcp.measured, false);
});

test("real-search runner records identity-bound full MCP latency separately from local latency", async t => {
  const data = await fixture(t);
  const latencyPath = join(data.directory, "mcp-latency.json");
  await writeFile(latencyPath, JSON.stringify({
    schema_version: "real-search-mcp-latency/v1",
    provenance: { dataset: { digest: data.input.dataset.digest }, catalog: data.input.catalog },
    samples: [{ case_id: "synthetic-relevant-holdout", duration_ms: 12.5 }],
  }));
  const result = run(["--input", data.inputPath, "--catalog", data.catalogPath, "--mcp-latency", latencyPath, "--output", data.reportPath]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(data.reportPath, "utf8"));
  assert.equal(report.latency.local.measured, true);
  assert.equal(report.latency.local.samples, 2);
  assert.deepEqual(report.latency.full_mcp, {
    measured: true,
    samples: 1,
    p50_ms: 12.5,
    p95_ms: 12.5,
    missing_case_ids: ["synthetic-no-match-holdout"],
  });
});

test("real-search runner keeps unjudged results and failures in the selected split denominators", async t => {
  const data = await fixture(t);
  const implementationPath = join(data.directory, "contract-search.mjs");
  await writeFile(implementationPath, `export function searchSkills(documents, query) {
  if (query.includes("basalt")) throw new Error("synthetic search failure");
  return [documents[2], documents[1], documents[0]];
}\n`);
  const result = run(["--input", data.inputPath, "--catalog", data.catalogPath, "--implementation", implementationPath, "--output", data.reportPath]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(data.reportPath, "utf8"));
  assert.deepEqual(report.metrics.denominators, {
    cases: 2,
    match_cases: 1,
    relevant_judgments: 1,
    no_match_cases: 1,
    failures: 1,
    unjudged: 1,
  });
  assert.equal(report.metrics.hit_at_1, 0);
  assert.equal(report.metrics.hit_at_5, 0);
  assert.equal(report.metrics.mrr, 0);
  assert.equal(report.metrics.recall_at_5, 0);
  assert.deepEqual(report.metrics.failures.map(item => item.case_id), ["synthetic-no-match-holdout"]);
  assert.deepEqual(report.metrics.unjudged.map(item => item.case_id), ["synthetic-relevant-holdout"]);
});

test("real-search runner rejects changed catalog bytes and comparison reports with another dataset", async t => {
  const data = await fixture(t);
  await writeFile(data.catalogPath, `${JSON.stringify([...data.catalog, { ...data.catalog[0], uri: "skill://fixture.example/other/SKILL.md", name: "other" }], null, 2)}\n`);
  const changedCatalog = run(["--input", data.inputPath, "--catalog", data.catalogPath]);
  assert.notEqual(changedCatalog.status, 0);
  assert.match(changedCatalog.stderr, /catalog digest/i);

  await writeFile(data.catalogPath, `${JSON.stringify(data.catalog, null, 2)}\n`);
  const comparisonPath = join(data.directory, "different-dataset.json");
  await writeFile(comparisonPath, JSON.stringify({ provenance: { dataset: { digest: `sha256:${"b".repeat(64)}` }, catalog: data.input.catalog } }));
  const comparison = run(["--input", data.inputPath, "--catalog", data.catalogPath, "--compare", comparisonPath]);
  assert.notEqual(comparison.status, 0);
  assert.match(comparison.stderr, /identical dataset and catalog digests/i);
});
