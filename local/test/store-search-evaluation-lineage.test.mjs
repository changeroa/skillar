import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PACKAGE_ROOT, distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb, SCHEMA_VERSION } = await distImport("store/db.js");
const { createStore } = await distImport("store/index.js");
const baseMigrations = ["schema.sql", "migrations/002_tracing.sql", "migrations/003_tracing_indexes.sql", "migrations/004_load_reconciliation.sql",
  "migrations/005_execution_boundaries.sql", "migrations/006_recording_order.sql"];

function sql(file) {
  return readFileSync(new URL(`dist/store/${file}`, PACKAGE_ROOT), "utf8");
}

function apply(db, files) {
  for (const file of files) db.exec(sql(file));
}

test("the v7 search-evaluation and v8 sync lineages both migrate forward without losing their data", () => {
  const dir = makeTempDir();
  try {
    const evaluationPath = join(dir, "search-evaluation-v7.db");
    const evaluation = new DatabaseSync(evaluationPath);
    apply(evaluation, [...baseMigrations, "migrations/009_search_evaluation.sql"]);
    evaluation.exec(`PRAGMA user_version = 7;
      INSERT INTO eval_cases (id, query, expected_uri, from_trace_id, created_at, label)
        VALUES ('case-1', 'review this change', 'skill://local/agents/review/SKILL.md', 'trace-1', 100, 'skill');
      INSERT INTO eval_runs (id, catalog_fingerprint, catalog_size, created_at, baseline, metrics_json)
        VALUES ('run-1', 'catalog-before', 1, 101, 1, '{}');
      INSERT INTO eval_run_cases (run_id, eval_case_id, label, expected_uri, language, rank, abstained)
        VALUES ('run-1', 'case-1', 'skill', 'skill://local/agents/review/SKILL.md', 'en', 2, 0);`);
    evaluation.close();

    const upgradedEvaluation = openDb(evaluationPath);
    try {
      assert.equal(SCHEMA_VERSION, 9);
      assert.equal(upgradedEvaluation.prepare("PRAGMA user_version").get().user_version, 9);
      assert.deepEqual({ ...upgradedEvaluation.prepare("SELECT query, label, expected_uri, from_trace_id FROM eval_cases").get() }, {
        query: "review this change", label: "skill", expected_uri: "skill://local/agents/review/SKILL.md", from_trace_id: "trace-1",
      });
      assert.deepEqual({ ...upgradedEvaluation.prepare("SELECT catalog_fingerprint, baseline FROM eval_runs").get() }, {
        catalog_fingerprint: "catalog-before", baseline: 1,
      });
      assert.deepEqual({ ...upgradedEvaluation.prepare("SELECT rank, abstained FROM eval_run_cases").get() }, { rank: 2, abstained: 0 });
      assert.ok(upgradedEvaluation.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connector_command_receipts'").get());
    } finally {
      upgradedEvaluation.close();
    }

    const syncPath = join(dir, "sync-v8.db");
    const sync = new DatabaseSync(syncPath);
    apply(sync, [...baseMigrations, "migrations/007_sync.sql", "migrations/008_connector_commands.sql"]);
    sync.exec("PRAGMA user_version = 8;");
    sync.prepare("INSERT INTO connector_command_receipts (account_id, generation, device_id, source_domain, command_id, payload_hash, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("account", 1, "device", "source", "command", "hash", "{}");
    sync.close();

    const upgradedSync = openDb(syncPath);
    try {
      assert.equal(upgradedSync.prepare("PRAGMA user_version").get().user_version, 9);
      assert.deepEqual({ ...upgradedSync.prepare("SELECT command_id, result_json FROM connector_command_receipts").get() }, { command_id: "command", result_json: "{}" });
      assert.deepEqual(upgradedSync.prepare("SELECT label FROM eval_cases").all(), []);
    } finally {
      upgradedSync.close();
    }
  } finally {
    removeDir(dir);
  }
});

test("version 8 history import retains portable evaluation cases and persisted runs", () => {
  const dir = makeTempDir();
  try {
    const out = join(dir, "export");
    mkdirSync(out);
    const sourcePath = join(dir, "evaluation-v7.db");
    const sourceLegacy = new DatabaseSync(sourcePath);
    apply(sourceLegacy, [...baseMigrations, "migrations/009_search_evaluation.sql"]);
    sourceLegacy.exec(`PRAGMA user_version = 7;
      INSERT INTO eval_cases (id, query, expected_uri, from_trace_id, created_at, label)
        VALUES ('case-1', 'portable evaluation', 'skill://local/agents/review/SKILL.md', 'trace-1', 100, 'skill');
      INSERT INTO eval_runs (id, catalog_fingerprint, catalog_size, created_at, baseline, metrics_json)
        VALUES ('run-1', 'catalog', 1, 101, 1, '{}');
      INSERT INTO eval_run_cases (run_id, eval_case_id, label, expected_uri, language, rank, abstained)
        VALUES ('run-1', 'case-1', 'skill', 'skill://local/agents/review/SKILL.md', 'en', 1, 0);`);
    sourceLegacy.close();
    const source = createStore(openDb(sourcePath));
    source.exportTo(out, { withHistory: false });
    source.close();

    const history = new DatabaseSync(join(out, "history.db"));
    apply(history, [...baseMigrations, "migrations/007_sync.sql", "migrations/008_connector_commands.sql"]);
    history.exec("PRAGMA user_version = 8; INSERT INTO sessions (id, runtime, started_at) VALUES ('v8-session', 'codex', 1);");
    history.close();

    const targetDb = openDb(":memory:");
    const target = createStore(targetDb);
    try {
      target.importFrom(out, { merge: true });
      assert.deepEqual(target.evaluationCases().map((row) => [row.query, row.label, row.expectedUri]), [
        ["portable evaluation", "skill", "skill://local/agents/review/SKILL.md"],
      ]);
      assert.equal(target.evaluationSummary().latest?.catalogFingerprint, "catalog");
      assert.equal(target.evaluationSummary().latest?.baseline, true);
      assert.equal(targetDb.prepare("SELECT id FROM sessions WHERE id = 'v8-session'").get().id, "v8-session");
    } finally {
      target.close();
    }
  } finally {
    removeDir(dir);
  }
});
