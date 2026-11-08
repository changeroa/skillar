import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const worker = await build({
  stdin: {
    contents: `
      import { commitActivityBatch } from "./src/activity/ledger.ts";
      export default { async fetch(request, env) {
        try { return Response.json(await commitActivityBatch(env.ACTIVITY, await request.json())); }
        catch (error) { return Response.json({ code: error.code ?? error.message },
          { status: error.status ?? (error.name === "ZodError" ? 400 : 500) }); }
      } };
    `,
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-ledger-fixture.mjs",
  },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});

export const tables = ["ingest_receipts", "session_facts", "event_facts", "span_facts",
  "entity_tombstones", "jobs", "dispatch_outbox", "account_heads", "account_changes", "device_streams"];
export const principal = (changes = {}) => ({
  kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
  shardId: "activity-00", scopes: ["activity:ingest"], ...changes,
});
export const session = (key = "session", revision = 1, facts = {}) => ({
  key, revision, entity: "session",
  facts: { runtime: "unknown", startedMs: 0, endedMs: null, automated: null, ...facts },
});
export const event = (key = "event", revision = 1, facts = {}) => ({
  key, revision, entity: "event", facts: {
    sessionId: "session", kind: "prompt", timestampMs: 10, sourceOrder: null,
    recordingOrders: {}, sourceKey: null, status: "unknown",
    inputTokens: null, outputTokens: null, ...facts,
  },
});
export const span = (key = "span", revision = 1, facts = {}) => ({
  key, revision, entity: "span", facts: {
    traceId: "trace", spanId: key, parentSpanId: null, sessionId: null,
    startMs: null, endMs: null, recordingOrders: {}, inputTokens: null, outputTokens: null, ...facts,
  },
});
export const tombstone = (target, key, revision) => ({ key, revision, entity: "tombstone", target });
export const batch = (changes = {}) => ({
  schemaVersion: 1, batchId: "batch-1", deviceId: "device-a", sourceDomain: "codex",
  generation: 1, consentVersion: 1, projectId: "project", rootId: null,
  range: { fromMs: 0, toMs: 1000 }, backfill: null,
  sequence: 1, journal: { from: 1, through: 1 }, mutations: [session()], ...changes,
});
export const expectedReceipt = (value, sequence = 1, changeSeq = sequence, durableAt = 100) => ({
  batchId: value.batchId, payloadHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  sequence, durableAt, projectedThrough: value.journal.through, changeSeq, state: "projected",
});

export async function fixture(t, { seed = true } = {}) {
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [{ config: {
      type: "worker", name: "activity-ledger-test", compatibilityDate: "2026-09-03",
      manifest: { mainModule: "index.js", modules: {
        "index.js": { type: "esm", contents: worker.outputFiles[0].text },
      } },
      env: { ACTIVITY: { type: "d1", name: "activity-ledger-test" } }, exports: {},
    } }],
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACTIVITY");
  const sql = await readFile(new URL("../../activity-migrations/0001_activity_ledger.sql", import.meta.url), "utf8");
  // D1 exec is line-oriented. Each trigger must remain one complete prepared statement.
  const statements = [];
  let current = "";
  let trigger = false;
  for (const line of sql.replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim()));
      current = "";
      trigger = false;
    }
  }
  assert.equal(current, "", "migration must contain complete SQL statements");
  await db.batch(statements);
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const seedFence = (account = "account-a", generation = 1, state = "active") =>
    db.prepare("INSERT INTO tenant_fences VALUES (?,?,?)").bind(account, generation, state).run();
  if (seed) await seedFence();
  return {
    db, rows, seedFence,
    async send(value = batch(), who = principal(), receivedAtMs = 100) {
      const response = await runtime.dispatchFetch("https://fixture.invalid/commit", {
        method: "POST", body: JSON.stringify({ principal: who, batch: value, receivedAtMs }),
      });
      return { status: response.status, body: await response.json() };
    },
    async counts(expected) {
      const actual = {};
      for (const table of tables) actual[table] = (await rows(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
      assert.deepEqual(actual, Object.fromEntries(tables.map(table => [table, expected[table] ?? 0])));
    },
  };
}

export const oneCommit = { ingest_receipts: 1, session_facts: 1, jobs: 1,
  dispatch_outbox: 1, account_heads: 1, account_changes: 1, device_streams: 1 };
export function accepted(result, value, sequence = 1, changeSeq = sequence, durableAt = 100) {
  assert.deepEqual(result, { status: 200, body: expectedReceipt(value, sequence, changeSeq, durableAt) });
}
export function rejected(result, status, code) {
  assert.deepEqual(result, { status, body: { code } });
}
