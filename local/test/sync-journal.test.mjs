import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { addSession, journalHead, logicalSnapshot, openDb, readJournal, seedAll } from "./helpers/sync.mjs";

const { targetTables } = await distImport("sync/tables.js");
const { createStore } = await distImport("store/index.js");
const all = (db, after = 0, through = journalHead(db).cut) => readJournal(db, { after, through });

test("session upserts journal only effective row changes", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  const store = createStore(db);
  const ref = { runtime: "claude-code", runtimeSessionId: "stable-session" };
  const id = store.upsertSession(ref, 100);
  const row = () => ({ ...db.prepare("SELECT * FROM sessions WHERE id=?").get(id) });
  const original = row(), firstCut = journalHead(db).cut;
  assert.equal(store.upsertSession(ref, 100), id);
  assert.equal(store.upsertSession(ref, 200), id);
  assert.deepEqual(row(), original);
  assert.equal(journalHead(db).cut, firstCut);
  assert.deepEqual(all(db, firstCut), []);

  assert.equal(store.upsertSession(ref, 50), id);
  assert.equal(row().started_at, 50);
  assert.equal(all(db, firstCut).length, 1);
  const earlierCut = journalHead(db).cut;
  const enriched = { ...ref, conversationId: "conversation", clientName: "fixture-client", cwd: "/fixture" };
  assert.equal(store.upsertSession(enriched, 75), id);
  const populated = row(), changed = all(db, earlierCut);
  assert.equal(populated.started_at, 50);
  assert.equal(populated.conversation_id, "conversation");
  assert.equal(populated.client_name, "fixture-client");
  assert.equal(populated.cwd, "/fixture");
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0].values, populated);

  const populatedCut = journalHead(db).cut;
  assert.equal(store.upsertSession({ ...ref, conversationId: "replacement", clientName: "other", cwd: "/other" }, 80), id);
  assert.equal(store.upsertSession({ runtime: "claude-code", conversationId: "conversation" }, 90), id);
  assert.deepEqual(row(), populated);
  assert.equal(journalHead(db).cut, populatedCut);
});

test("CDC captures every target table, final derived values, key moves and deletes", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  seedAll(db);
  const records = all(db);
  assert.deepEqual([...new Set(records.map(r => r.table))].sort(), [...targetTables].sort());
  for (const record of records) {
    const columns = JSON.parse(record.key);
    const keys = db.prepare(`PRAGMA table_info("${record.table}")`).all()
      .filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const row = db.prepare(`SELECT * FROM "${record.table}" WHERE ${keys.map(c => `"${c.name}"=?`).join(" AND ")}`)
      .get(...columns);
    assert.deepEqual(record.values, { ...row }, record.table);
  }
  assert.ok(JSON.parse(records.find(r => r.table === "events").values.recording_orders_json)
    [db.prepare("SELECT domain FROM recording_clock").get().domain] > 0);
  const cut = journalHead(db).cut;
  db.exec(`UPDATE events SET data_json='{"attributionCandidates":["b"]}',text=NULL WHERE id='e';
    UPDATE sessions SET ended_at=300 WHERE id='s';
    UPDATE otel_spans SET name='corrected' WHERE span_id='span';
    UPDATE herdr_tabs SET id='moved' WHERE id='t';`);
  const changed = all(db, cut);
  assert.equal(changed.filter(r => r.table === "sessions").length, 1);
  assert.deepEqual(changed.find(r => r.table === "sessions").values,
    { ...db.prepare("SELECT * FROM sessions WHERE id='s'").get() });
  assert.equal(changed.find(r => r.table === "load_candidates" && r.key === '["e","s"]').operation, "delete");
  assert.equal(changed.find(r => r.table === "load_candidates" && r.key === '["e","b"]').operation, "upsert");
  assert.equal(changed.find(r => r.table === "herdr_tabs" && r.key === '["t"]').operation, "delete");
  const old = all(db, 0, cut);
  assert.equal(old.find(r => r.table === "events").values.text, "SENTINEL");
  assert.equal(old.find(r => r.table === "sessions").values.ended_at, 200);
  const beforeDelete = journalHead(db).cut;
  db.exec(`DELETE FROM flow_steps; DELETE FROM flows; DELETE FROM workflow_specs;
    DELETE FROM pane_sessions; DELETE FROM events; DELETE FROM sessions;
    DELETE FROM loads; DELETE FROM eval_cases; DELETE FROM otel_spans;
    DELETE FROM herdr_panes; DELETE FROM herdr_tabs; DELETE FROM herdr_workspaces; DELETE FROM skills;`);
  const deleted = all(db, beforeDelete);
  for (const table of targetTables.filter(table => table !== "recording_clock")) {
    assert.ok(deleted.some(r => r.table === table && r.operation === "delete"), table);
  }
  assert.ok(deleted.every(r => r.values === null));
  assert.deepEqual(all(db, 0, cut), old, "old cut survives subsequent updates and deletes");
});

test("rollback, ignored replay, savepoint rollback and REPLACE have transactional CDC", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  const head = journalHead(db);
  db.exec("BEGIN");
  db.exec("UPDATE sessions SET first_prompt='rolled back'; DELETE FROM sessions");
  assert.throws(() => journalHead(db), { code: "transaction_active" });
  db.exec("ROLLBACK");
  assert.deepEqual(journalHead(db), head);
  db.exec("BEGIN; SAVEPOINT inner; UPDATE sessions SET first_prompt='inner'; ROLLBACK TO inner; RELEASE inner; COMMIT");
  assert.deepEqual(journalHead(db), head);
  db.exec("INSERT OR IGNORE INTO sessions(id,runtime,started_at) VALUES ('s','codex',200)");
  assert.deepEqual(journalHead(db), head);
  db.exec("INSERT OR REPLACE INTO sessions(id,runtime,started_at) VALUES ('s','codex',300)");
  const final = all(db, head.cut);
  assert.equal(final.length, 1);
  assert.equal(final[0].values.started_at, 300);
  assert.equal(final[0].operation, "upsert");
  db.exec("UPDATE sqlite_sequence SET seq=9007199254740991 WHERE name='sync_journal'");
  assert.throws(() => db.exec("INSERT OR IGNORE INTO sessions(id,runtime,started_at) VALUES ('overflow','codex',1)"),
    /sync journal exhausted/);
  assert.equal(db.prepare("SELECT id FROM sessions WHERE id='overflow'").get(), undefined);
});

test("every target UPDATE and later-created AFTER trigger publish the final stored image", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  seedAll(db);
  const cut = journalHead(db).cut;
  db.exec(`UPDATE skills SET name='updated';
    UPDATE sessions SET first_prompt='updated';
    UPDATE events SET text='updated';
    UPDATE loads SET manifest_digest='updated';
    UPDATE eval_cases SET query='updated';
    UPDATE otel_spans SET name='updated';
    UPDATE herdr_workspaces SET label='updated';
    UPDATE herdr_tabs SET label='updated';
    UPDATE herdr_panes SET cwd='/updated';
    UPDATE pane_sessions SET source='updated';
    UPDATE workflow_specs SET body_json='{"steps":[{"id":"updated"}]}';
    UPDATE flows SET label='updated';
    UPDATE flow_steps SET step_id='updated';
    UPDATE load_candidates SET ts=151;
    UPDATE recording_clock SET position=position+1;`);
  const changed = all(db, cut);
  assert.deepEqual(changed.map(r => r.table).sort(), [...targetTables].sort());
  for (const record of changed) {
    assert.deepEqual(record.values, { ...db.prepare(`SELECT * FROM "${record.table}"`).get() }, record.table);
  }
  // SQLite currently runs newer triggers first. NEW in the outer CDC trigger
  // would overwrite the nested image at the final cut if it were used here.
  db.exec(`CREATE TRIGGER test_later_derived AFTER INSERT ON events BEGIN
      UPDATE events SET text='derived-final' WHERE id=NEW.id;
    END;
    INSERT INTO events(id,ts,kind,source,session_id,attribution_method,runtime,text)
      VALUES ('later-trigger',500,'prompt','hook','s','runtime_id','codex','intermediate');`);
  const final = all(db).find(r => r.table === "events" && r.key === '["later-trigger"]');
  assert.equal(final.values.text, "derived-final");
  assert.deepEqual(final.values, { ...db.prepare("SELECT * FROM events WHERE id='later-trigger'").get() });
});

test("logical snapshot pins journal cut and every row while a WAL writer mutates between chunks", t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const path = join(dir, "db");
  const writer = openDb(path), reader = openDb(path);
  t.after(() => { reader.close(); writer.close(); });
  seedAll(writer);
  const before = [...logicalSnapshot(reader)].flatMap(c => c.records);
  const expectedHead = journalHead(writer);
  const iterator = logicalSnapshot(reader, { maxRecords: 1 });
  const first = iterator.next().value;
  assert.equal(first.cut, expectedHead.cut);
  writer.exec(`UPDATE sessions SET first_prompt='after-cut',ended_at=999;
    DELETE FROM eval_cases; UPDATE flows SET end_order=NULL,end_order_domain=NULL;
    INSERT INTO herdr_tabs(id,label) VALUES ('later','after-cut');`);
  const chunks = [first, ...iterator];
  const records = chunks.flatMap(c => c.records);
  assert.deepEqual(records, before);
  for (const chunk of chunks) {
    assert.equal(chunk.cut, expectedHead.cut);
    assert.equal(chunk.sourceDomain, expectedHead.sourceDomain);
    assert.equal(chunk.hash, createHash("sha256").update(JSON.stringify(chunk.records)).digest("hex"));
    assert.equal(chunk.bytes, Buffer.byteLength(JSON.stringify(chunk.records)));
  }
  const catchup = all(writer, first.cut);
  assert.equal(catchup.find(r => r.table === "sessions").values.first_prompt, "after-cut");
  assert.equal(catchup.find(r => r.table === "eval_cases").operation, "delete");
  assert.ok(catchup.every(r => r.revision > first.cut));
  const expected = [...logicalSnapshot(reader)].flatMap(c => c.records);
  const merged = new Map(records.map(r => [`${r.table}:${r.key}`, r]));
  for (const record of catchup) {
    if (record.operation === "delete") merged.delete(`${record.table}:${record.key}`);
    else merged.set(`${record.table}:${record.key}`, record);
  }
  const facts = items => items.map(({ revision, ...r }) => r)
    .sort((a, b) => `${a.table}:${a.key}`.localeCompare(`${b.table}:${b.key}`));
  assert.deepEqual(facts([...merged.values()]), facts(expected), "full values, not just IDs/counts");
  assert.equal(reader.isTransaction, false);
});

test("snapshot bounds, early close and deadline errors release the pinned reader", t => {
  const db = openDb(":memory:");
  t.after(() => db.close());
  addSession(db);
  const iterator = logicalSnapshot(db, { maxRecords: 1 });
  iterator.next();
  assert.equal(db.isTransaction, true);
  iterator.return();
  assert.equal(db.isTransaction, false);
  assert.throws(() => [...logicalSnapshot(db, { maxBytes: 10 })], { code: "record_too_large" });
  assert.equal(db.isTransaction, false);
  const now = t.mock.method(performance, "now");
  now.mock.mockImplementationOnce(() => 0);
  now.mock.mockImplementation(() => 100);
  assert.throws(() => [...logicalSnapshot(db, { maxDurationMs: 1 })], { code: "snapshot_expired" });
  assert.equal(db.isTransaction, false);
});
