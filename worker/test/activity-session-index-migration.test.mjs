import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const sql = name => readFile(new URL(`../activity-migrations/${name}`, import.meta.url), "utf8");

test("0014 migrates pre-existing facts rows (client-sent mutations) and keeps the new indexes usable", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(await sql("0001_activity_ledger.sql"));
  const id = ["a", 1, "d", "x"];
  db.prepare(`INSERT INTO session_facts VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(...id, "s1", 1, JSON.stringify({ runtime: "codex", startedMs: 5, endedMs: null, automated: true }), "codex", 5, null);
  db.prepare(`INSERT INTO session_facts VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(...id, "s2", 1, JSON.stringify({ runtime: "codex", startedMs: 6, endedMs: null, automated: null }), "codex", 6, null);
  db.prepare(`INSERT INTO event_facts VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...id, "e1", 1, JSON.stringify({ sessionId: "s1", kind: "load" }), 7, null, null, "{}");
  db.exec(await sql("0014_session_index.sql"));
  assert.deepEqual(db.prepare("SELECT entity_key,automated FROM session_facts ORDER BY entity_key").all()
    .map(r => [r.entity_key, r.automated]), [["s1", 1], ["s2", null]]);
  assert.deepEqual(db.prepare("SELECT session_id,kind FROM event_facts").all()
    .map(r => [r.session_id, r.kind]), [["s1", "load"]]);
  const plan = q => db.prepare(`EXPLAIN QUERY PLAN ${q}`).all().map(r => r.detail).join("|");
  assert.match(plan(`SELECT entity_key FROM session_facts WHERE account_id='a' AND generation=1 AND device_id='d'
    AND source_domain='x' AND started_ms>=0 ORDER BY started_ms DESC LIMIT 50`), /session_facts_started/);
  assert.match(plan(`SELECT kind FROM event_facts WHERE account_id='a' AND generation=1 AND device_id='d'
    AND source_domain='x' AND session_id='s1'`), /event_facts_session/);
});
