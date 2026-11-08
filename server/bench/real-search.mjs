import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = "real-search-evaluation/v1";
const MCP_LATENCY_SCHEMA_VERSION = "real-search-mcp-latency/v1";
const TOP_K = 5;

const usage = `Usage: node server/bench/real-search.mjs --input evaluation.json --catalog catalog.json [options]

Required:
  --input PATH              Consent-bound evaluation input (${SCHEMA_VERSION})
  --catalog PATH            Pinned metadata-only catalog JSON array

Options:
  --split tune|holdout      Split to score (default: holdout)
  --mode MODE               Search mode: legacy, discovery, automatic, or explicit (default: discovery)
  --implementation PATH     Module exporting searchSkills(documents, query, mode)
  --mcp-latency PATH        Separately captured full-MCP latency measurements
  --compare PATH            Prior report; only identical dataset/catalog identities compare
  --output PATH             Write the full report to PATH
  --help                    Show this help

This is an evaluator, not a quality gate. It never invents consent or treats labels as consent.`;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, name) {
  assert(isRecord(value), `${name} must be an object`);
}

function assertKnownKeys(value, keys, name) {
  assertRecord(value, name);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${name}.${key} is not allowed by this schema`);
  for (const key of keys) assert(Object.hasOwn(value, key), `${name}.${key} is required`);
}

function assertString(value, name) {
  assert(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
}

function assertTimestamp(value, name) {
  assertString(value, name);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), `${name} must be an RFC 3339 UTC timestamp`);
}

function assertDigest(value, name) {
  assert(typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value), `${name} must be a lowercase sha256 digest`);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "digest payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assertRecord(value, "digest payload");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalDatasetPayload(input) {
  const { digest, ...dataset } = input.dataset;
  return { schema_version: input.schema_version, dataset, splits: input.splits, cases: input.cases };
}

function isCanonicalSkillUri(value) {
  if (typeof value !== "string") return false;
  try {
    const uri = new URL(value);
    const segments = uri.pathname.split("/");
    return uri.protocol === "skill:"
      && uri.hostname.length > 0
      && uri.username === ""
      && uri.password === ""
      && uri.search === ""
      && uri.hash === ""
      && uri.pathname.endsWith("/SKILL.md")
      && !segments.some(segment => segment === "." || segment === "..")
      && uri.toString() === value;
  } catch {
    return false;
  }
}

function validateEvaluation(input) {
  assertKnownKeys(input, ["schema_version", "dataset", "catalog", "splits", "cases"], "evaluation");
  assert(input.schema_version === SCHEMA_VERSION, `evaluation.schema_version must be ${SCHEMA_VERSION}`);

  assertKnownKeys(input.dataset, ["id", "digest", "consent_ledger", "deidentification", "retention"], "evaluation.dataset");
  assertString(input.dataset.id, "evaluation.dataset.id");
  assertDigest(input.dataset.digest, "evaluation.dataset.digest");
  assertKnownKeys(input.dataset.consent_ledger, ["id", "status", "verified_at"], "evaluation.dataset.consent_ledger");
  assertString(input.dataset.consent_ledger.id, "evaluation.dataset.consent_ledger.id");
  assert(["active", "synthetic"].includes(input.dataset.consent_ledger.status), "evaluation.dataset.consent_ledger.status must be active or synthetic");
  assertTimestamp(input.dataset.consent_ledger.verified_at, "evaluation.dataset.consent_ledger.verified_at");
  assertKnownKeys(input.dataset.deidentification, ["method", "purpose"], "evaluation.dataset.deidentification");
  assertString(input.dataset.deidentification.method, "evaluation.dataset.deidentification.method");
  assertString(input.dataset.deidentification.purpose, "evaluation.dataset.deidentification.purpose");
  assertKnownKeys(input.dataset.retention, ["policy", "expires_at"], "evaluation.dataset.retention");
  assertString(input.dataset.retention.policy, "evaluation.dataset.retention.policy");
  assertTimestamp(input.dataset.retention.expires_at, "evaluation.dataset.retention.expires_at");

  assertKnownKeys(input.catalog, ["commit", "digest"], "evaluation.catalog");
  assert(typeof input.catalog.commit === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.catalog.commit), "evaluation.catalog.commit must be a lowercase 40- or 64-character commit id");
  assertDigest(input.catalog.digest, "evaluation.catalog.digest");

  assertKnownKeys(input.splits, ["tune", "holdout"], "evaluation.splits");
  const groups = new Set();
  for (const split of ["tune", "holdout"]) {
    assert(Array.isArray(input.splits[split]) && input.splits[split].length > 0, `evaluation.splits.${split} must be a non-empty group array`);
    for (const group of input.splits[split]) {
      assertString(group, `evaluation.splits.${split} group`);
      assert(!groups.has(group), `evaluation split group ${JSON.stringify(group)} appears more than once`);
      groups.add(group);
    }
  }

  assert(Array.isArray(input.cases) && input.cases.length > 0, "evaluation.cases must be a non-empty array");
  const caseIds = new Set();
  const seenGroups = new Set();
  for (const [index, item] of input.cases.entries()) {
    const name = `evaluation.cases[${index}]`;
    assertKnownKeys(item, ["id", "group", "query", "decision", "judgments"], name);
    assertString(item.id, `${name}.id`);
    assert(!caseIds.has(item.id), `${name}.id is duplicated`);
    caseIds.add(item.id);
    assertString(item.group, `${name}.group`);
    assert(groups.has(item.group), `${name}.group is not assigned to tune or holdout`);
    seenGroups.add(item.group);
    assertString(item.query, `${name}.query`);
    assert(["match", "abstain"].includes(item.decision), `${name}.decision must be match or abstain`);
    assert(Array.isArray(item.judgments) && item.judgments.length > 0, `${name}.judgments must be a non-empty array`);
    const judgedUris = new Set();
    let relevant = 0;
    for (const [judgmentIndex, judgment] of item.judgments.entries()) {
      const judgmentName = `${name}.judgments[${judgmentIndex}]`;
      assertKnownKeys(judgment, ["uri", "judgment"], judgmentName);
      assert(isCanonicalSkillUri(judgment.uri), `${judgmentName}.uri must be a canonical skill URI ending in /SKILL.md`);
      assert(!judgedUris.has(judgment.uri), `${judgmentName}.uri is duplicated`);
      judgedUris.add(judgment.uri);
      assert(["relevant", "supporting", "irrelevant"].includes(judgment.judgment), `${judgmentName}.judgment must be relevant, supporting, or irrelevant`);
      if (judgment.judgment === "relevant") relevant++;
      if (item.decision === "abstain") assert(judgment.judgment === "irrelevant", `${name} abstain decisions may only contain irrelevant judgments`);
    }
    if (item.decision === "match") assert(relevant > 0, `${name} match decisions require at least one relevant URI`);
  }
  assert(seenGroups.size === groups.size, "every tune and holdout group must contain at least one case");

  const expectedDigest = sha256(canonicalJson(canonicalDatasetPayload(input)));
  assert(input.dataset.digest === expectedDigest, "evaluation.dataset.digest does not bind the schema, consent boundary, split, and judgments");
}

function validateCatalog(catalog) {
  assert(Array.isArray(catalog) && catalog.length > 0, "catalog must be a non-empty JSON array");
  const uris = new Set();
  for (const [index, document] of catalog.entries()) {
    const name = `catalog[${index}]`;
    assertKnownKeys(document, ["uri", "name", "description", "keywords", "automatic", "digest"], name);
    assert(isCanonicalSkillUri(document.uri), `${name}.uri must be a canonical skill URI ending in /SKILL.md`);
    assert(!uris.has(document.uri), `${name}.uri is duplicated`);
    uris.add(document.uri);
    assertString(document.name, `${name}.name`);
    assertString(document.description, `${name}.description`);
    assert(Array.isArray(document.keywords) && document.keywords.every(keyword => typeof keyword === "string"), `${name}.keywords must be an array of strings`);
    assert(typeof document.automatic === "boolean", `${name}.automatic must be boolean`);
    assertString(document.digest, `${name}.digest`);
  }
  return uris;
}

function validateJudgmentsExist(input, catalogUris) {
  for (const item of input.cases) {
    for (const judgment of item.judgments) {
      assert(catalogUris.has(judgment.uri), `judgment ${judgment.uri} for case ${item.id} is absent from the pinned catalog`);
    }
  }
}

function percentile(samples, fraction) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeLatency(samples, measured = true, missingCaseIds = []) {
  return {
    measured,
    samples: samples.length,
    p50_ms: percentile(samples, 0.5),
    p95_ms: percentile(samples, 0.95),
    missing_case_ids: missingCaseIds,
  };
}

function parseArgs(argv) {
  const options = { split: "holdout", mode: "discovery" };
  const seen = new Set();
  const valued = new Set(["--input", "--catalog", "--split", "--mode", "--implementation", "--mcp-latency", "--compare", "--output"]);
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === "--help") return { help: true };
    assert(valued.has(option), `unknown option ${option}\n\n${usage}`);
    const value = argv[++index];
    assert(value !== undefined && !value.startsWith("--"), `${option} requires a value`);
    assert(!seen.has(option), `${option} may only be provided once`);
    seen.add(option);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }
  assertString(options.input, "--input");
  assertString(options.catalog, "--catalog");
  assert(["tune", "holdout"].includes(options.split), "--split must be tune or holdout");
  assert(["legacy", "discovery", "automatic", "explicit"].includes(options.mode), "--mode must be legacy, discovery, automatic, or explicit");
  return options;
}

async function readJson(path, name) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    fail(`cannot read ${name} ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${name} ${path} is not valid JSON: ${error.message}`);
  }
}

async function loadSearch(options) {
  const modulePath = options.implementation
    ? pathToFileURL(resolve(options.implementation)).href
    : new URL("../dist/skill-search.js", import.meta.url).href;
  let implementation;
  try {
    implementation = await import(modulePath);
  } catch (error) {
    fail(`cannot load search implementation ${modulePath}: ${error.message}`);
  }
  assert(typeof implementation.searchSkills === "function", `search implementation ${modulePath} must export searchSkills`);
  return implementation.searchSkills;
}

async function evaluateCase(item, documents, search, mode) {
  const started = performance.now();
  let found;
  try {
    found = await search(documents, item.query, mode);
    assert(Array.isArray(found), "searchSkills must return an array");
    const outputUris = found.map((document, index) => {
      assertRecord(document, `search result ${index}`);
      assert(isCanonicalSkillUri(document.uri), `search result ${index}.uri must be a canonical skill URI`);
      return document.uri;
    });
    assert(new Set(outputUris).size === outputUris.length, "search result contains duplicate URIs");
    const top = outputUris.slice(0, TOP_K);
    const judgments = new Map(item.judgments.map(judgment => [judgment.uri, judgment.judgment]));
    const unjudgedUris = top.filter(uri => !judgments.has(uri));
    const directRelevant = top.filter(uri => judgments.get(uri) === "relevant");
    const supporting = top.filter(uri => judgments.get(uri) === "supporting");
    const rankIndex = top.findIndex(uri => judgments.get(uri) === "relevant");
    return {
      case_id: item.id,
      group: item.group,
      decision: item.decision,
      status: unjudgedUris.length ? "unjudged" : "scored",
      rank: rankIndex < 0 ? null : rankIndex + 1,
      returned_uris: top,
      total_returned: outputUris.length,
      judged_results: top.map(uri => ({ uri, judgment: judgments.get(uri) ?? "unjudged" })),
      relevant_retrieved_at_5: directRelevant,
      supporting_retrieved_at_5: supporting,
      unjudged_uris: unjudgedUris,
      local_ms: performance.now() - started,
    };
  } catch (error) {
    return {
      case_id: item.id,
      group: item.group,
      decision: item.decision,
      status: "failure",
      rank: null,
      returned_uris: [],
      total_returned: 0,
      judged_results: [],
      relevant_retrieved_at_5: [],
      supporting_retrieved_at_5: [],
      unjudged_uris: [],
      error: error instanceof Error ? error.message : String(error),
      local_ms: performance.now() - started,
    };
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function buildMetrics(rows, selectedCases) {
  const matchRows = rows.filter(row => row.decision === "match");
  const noMatchRows = rows.filter(row => row.decision === "abstain");
  const failures = rows.filter(row => row.status === "failure");
  const unjudged = rows.filter(row => row.status === "unjudged");
  const hitAt1 = matchRows.filter(row => row.status === "scored" && row.rank === 1).length;
  const hitAt5 = matchRows.filter(row => row.status === "scored" && row.rank !== null && row.rank <= TOP_K).length;
  const mrr = matchRows.reduce((total, row) => total + (row.status === "scored" && row.rank !== null ? 1 / row.rank : 0), 0);
  const relevantJudgments = selectedCases
    .filter(item => item.decision === "match")
    .flatMap(item => item.judgments)
    .filter(judgment => judgment.judgment === "relevant");
  const relevantRetrieved = rows.reduce((total, row) => total + (row.status === "scored" ? row.relevant_retrieved_at_5.length : 0), 0);
  const falsePositives = noMatchRows.filter(row => row.status === "scored" && row.returned_uris.length > 0);
  const correctAbstentions = noMatchRows.filter(row => row.status === "scored" && row.returned_uris.length === 0);
  const misses = matchRows.filter(row => row.status === "scored" && row.rank === null);
  const supportingRetrieved = rows.reduce((total, row) => total + (row.status === "scored" ? row.supporting_retrieved_at_5.length : 0), 0);

  return {
    denominators: {
      cases: rows.length,
      match_cases: matchRows.length,
      relevant_judgments: relevantJudgments.length,
      no_match_cases: noMatchRows.length,
      failures: failures.length,
      unjudged: unjudged.length,
    },
    hit_at_1: ratio(hitAt1, matchRows.length),
    hit_at_5: ratio(hitAt5, matchRows.length),
    mrr: ratio(mrr, matchRows.length),
    recall_at_5: ratio(relevantRetrieved, relevantJudgments.length),
    supporting_retrieved_at_5: supportingRetrieved,
    no_match: {
      correct_abstentions: correctAbstentions.length,
      false_positives: falsePositives.length,
      abstention_rate: ratio(correctAbstentions.length, noMatchRows.length),
    },
    misses: misses.map(row => row.case_id),
    failures: failures.map(row => ({ case_id: row.case_id, error: row.error })),
    unjudged: unjudged.map(row => ({ case_id: row.case_id, uris: row.unjudged_uris })),
    false_positives: falsePositives.map(row => ({ case_id: row.case_id, uris: row.returned_uris })),
  };
}

function identityFromReport(report, name) {
  assertRecord(report, `${name} report`);
  assertRecord(report.provenance, `${name} report.provenance`);
  assertRecord(report.provenance.dataset, `${name} report.provenance.dataset`);
  assertRecord(report.provenance.catalog, `${name} report.provenance.catalog`);
  assertDigest(report.provenance.dataset.digest, `${name} report dataset digest`);
  assertDigest(report.provenance.catalog.digest, `${name} report catalog digest`);
  assert(typeof report.provenance.catalog.commit === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(report.provenance.catalog.commit), `${name} report catalog commit is invalid`);
  return {
    datasetDigest: report.provenance.dataset.digest,
    catalogDigest: report.provenance.catalog.digest,
    catalogCommit: report.provenance.catalog.commit,
  };
}

function compareReports(report, previous, path) {
  const current = identityFromReport(report, "current");
  const prior = identityFromReport(previous, "comparison");
  assert(current.datasetDigest === prior.datasetDigest && current.catalogDigest === prior.catalogDigest && current.catalogCommit === prior.catalogCommit, "comparisons require identical dataset and catalog digests and catalog commits");
  assertRecord(previous.metrics, "comparison report.metrics");
  const delta = {};
  for (const metric of ["hit_at_1", "hit_at_5", "mrr", "recall_at_5"]) {
    if (typeof report.metrics[metric] === "number" && typeof previous.metrics[metric] === "number") delta[metric] = report.metrics[metric] - previous.metrics[metric];
  }
  return { path, identity: prior, metric_delta: delta };
}

function validateMcpLatency(latency, report, selectedCaseIds) {
  assertKnownKeys(latency, ["schema_version", "provenance", "samples"], "MCP latency");
  assert(latency.schema_version === MCP_LATENCY_SCHEMA_VERSION, `MCP latency.schema_version must be ${MCP_LATENCY_SCHEMA_VERSION}`);
  const identity = identityFromReport({ provenance: latency.provenance }, "MCP latency");
  const current = identityFromReport(report, "current");
  assert(identity.datasetDigest === current.datasetDigest && identity.catalogDigest === current.catalogDigest && identity.catalogCommit === current.catalogCommit, "MCP latency measurements require identical dataset and catalog digests and catalog commits");
  assert(Array.isArray(latency.samples), "MCP latency.samples must be an array");
  const selected = new Set(selectedCaseIds);
  const seen = new Set();
  const samples = [];
  for (const [index, sample] of latency.samples.entries()) {
    const name = `MCP latency.samples[${index}]`;
    assertKnownKeys(sample, ["case_id", "duration_ms"], name);
    assertString(sample.case_id, `${name}.case_id`);
    assert(selected.has(sample.case_id), `${name}.case_id is not in the selected split`);
    assert(!seen.has(sample.case_id), `${name}.case_id is duplicated`);
    seen.add(sample.case_id);
    assert(typeof sample.duration_ms === "number" && Number.isFinite(sample.duration_ms) && sample.duration_ms >= 0, `${name}.duration_ms must be a non-negative finite number`);
    samples.push(sample.duration_ms);
  }
  return summarizeLatency(samples, true, selectedCaseIds.filter(caseId => !seen.has(caseId)));
}

export async function runRealSearch(options) {
  const input = await readJson(options.input, "evaluation input");
  validateEvaluation(input);
  const catalogBytes = await readFile(options.catalog);
  const actualCatalogDigest = sha256(catalogBytes);
  assert(input.catalog.digest === actualCatalogDigest, "catalog digest does not match the pinned catalog bytes");
  let documents;
  try {
    documents = JSON.parse(catalogBytes.toString("utf8"));
  } catch (error) {
    fail(`catalog ${options.catalog} is not valid JSON: ${error.message}`);
  }
  const catalogUris = validateCatalog(documents);
  validateJudgmentsExist(input, catalogUris);
  const selectedCases = input.cases.filter(item => input.splits[options.split].includes(item.group));
  assert(selectedCases.length > 0, `selected ${options.split} split has no cases`);
  const search = await loadSearch(options);
  const rows = [];
  for (const item of selectedCases) rows.push(await evaluateCase(item, documents, search, options.mode));
  const metrics = buildMetrics(rows, selectedCases);
  const report = {
    schema_version: SCHEMA_VERSION,
    split: options.split,
    mode: options.mode,
    top_k: TOP_K,
    provenance: {
      dataset: input.dataset,
      catalog: input.catalog,
    },
    catalog_size: documents.length,
    metrics,
    latency: {
      local: summarizeLatency(rows.map(row => row.local_ms)),
      full_mcp: summarizeLatency([], false),
    },
    cases: rows,
    limitations: [
      "This evaluator makes no production-quality claim. A genuine result requires a separately consented, deidentified evaluation dataset.",
      "Failures and top-five unjudged results remain in every metric denominator and contribute zero credit.",
      "Local latency measures only the configured search implementation. Full MCP latency is absent unless separately captured with matching dataset and catalog identities.",
      "Session labels and consent are independent; this runner requires a consent ledger reference and does not infer consent from labels.",
    ],
  };
  if (options.mcpLatency) report.latency.full_mcp = validateMcpLatency(await readJson(options.mcpLatency, "MCP latency"), report, selectedCases.map(item => item.id));
  if (options.compare) report.comparison = compareReports(report, await readJson(options.compare, "comparison report"), options.compare);
  return report;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
      return;
    }
    const report = await runRealSearch(options);
    if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      split: report.split,
      provenance: {
        dataset_digest: report.provenance.dataset.digest,
        catalog_commit: report.provenance.catalog.commit,
        catalog_digest: report.provenance.catalog.digest,
      },
      metrics: report.metrics,
      latency: report.latency,
    }, null, 2));
  } catch (error) {
    console.error(`real-search: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
