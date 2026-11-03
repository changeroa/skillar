import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { openDb } from "./helpers/sync.mjs";

const { createStore } = await distImport("store/index.js");
const { createIngestDeps, ingestHook } = await distImport("ingest/pipeline.js");

test("transactional CDC stays within the real hook latency budget without a spool or network hot path", t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const baseline = openDb(join(dir, "baseline.db")), captured = openDb(join(dir, "captured.db"));
  t.after(() => { baseline.close(); captured.close(); });
  // Same v7 store and ingestion path, differing only in the CDC triggers.
  for (const { name } of baseline.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'sync_*'").all()) {
    baseline.exec(`DROP TRIGGER "${name}"`);
  }
  const deps = [baseline, captured].map(db => createIngestDeps(createStore(db), { now: () => 1000 }));
  const payload = { hook_event_name: "UserPromptSubmit", session_id: "latency", cwd: "/fixture", prompt: "measure hook" };
  for (let i = 0; i < 20; i++) for (const d of deps) {
    assert.equal(ingestHook("claude-code", payload, d).accepted, 1);
  }
  const times = [[], []];
  for (let i = 0; i < 200; i++) {
    // Alternate ordering rather than attributing warmup/load drift to one variant.
    for (const index of i % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      const result = ingestHook("claude-code", payload, deps[index]);
      times[index].push(performance.now() - start);
      assert.equal(result.accepted, 1);
    }
  }
  const p95 = samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
  const baselineP95 = p95(times[0]), cdcP95 = p95(times[1]);
  t.diagnostic(JSON.stringify({ hooks: 200, baselineP95Ms: baselineP95, cdcP95Ms: cdcP95,
    addedP95Ms: cdcP95 - baselineP95, budgetMs: 10, addedBudgetMs: 2, platform: process.platform,
    storage: [baseline, captured].map(db => ({
      ...db.prepare("PRAGMA synchronous").get(), ...db.prepare("PRAGMA journal_mode").get(),
      ...db.prepare("PRAGMA wal_autocheckpoint").get(), ...db.prepare("PRAGMA page_size").get(),
    })) }));
  assert.ok(cdcP95 < 10, `hook p95 ${cdcP95}ms exceeds 10ms`);
  assert.ok(cdcP95 - baselineP95 < 2, `CDC adds ${cdcP95 - baselineP95}ms to hook p95`);
  assert.equal(captured.prepare("SELECT COUNT(*) n FROM events").get().n, 220);
  assert.equal(captured.prepare("SELECT COUNT(*) n FROM sync_outbox").get().n, 0);
  assert.equal(captured.prepare("SELECT COUNT(*) n FROM sync_streams").get().n, 0);
});
