import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { distImport } from "./_helpers.mjs";
import { journalHead, logicalSnapshot, openDb, readJournal, request, spoolBatch } from "./helpers/sync.mjs";
import {
  applyCatchup, clock, descriptor, facts, fixture, pagesFor, restoredFacts,
  restoreSnapshot, targetTables, triggers, verify,
} from "./helpers/sync-restore.mjs";

const { createStore } = await distImport("store/index.js");

test("restores all fifteen original tables and rowid zero without arrival marks or old spool", t => {
  // Given complete source images and source-only durable transport state.
  const f = fixture(t);
  spoolBatch(f.source, request(f.source));
  const localClock = clock(f.destination);
  const localIdentity = journalHead(f.destination).sourceDomain;
  const definitions = triggers(f.destination);
  const expected = facts(f.source);
  // When every logical page is restored transactionally.
  const result = restoreSnapshot(f.destination, f.descriptor, f.pages);
  // Then every original scalar/order/vector survives, with an independent destination lineage.
  assert.equal(result.hash, f.descriptor.hash);
  assert.deepEqual(restoredFacts(f.destination), expected);
  assert.equal(Object.keys(result.counts).length, 15);
  assert.ok(targetTables.every(table => result.counts[table] > 0));
  assert.deepEqual(clock(f.destination), localClock);
  assert.notEqual(localClock.domain, clock(f.source).domain);
  assert.equal(journalHead(f.destination).sourceDomain, localIdentity);
  assert.notEqual(localIdentity, f.descriptor.sourceDomain);
  for (const table of ["sync_journal", "sync_outbox", "sync_streams", "meta"]) {
    assert.equal(f.destination.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  }
  assert.deepEqual(triggers(f.destination), definitions);
  assert.deepEqual(f.destination.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(f.destination.prepare("SELECT COUNT(*) n FROM skills_fts WHERE skills_fts MATCH 'SENTINEL'").get().n, 1);
  assert.equal(f.destination.prepare("SELECT start_order FROM flows WHERE id='unknown'").get().start_order, null);
  assert.equal(verify(f.destination, f.descriptor).hash, f.descriptor.hash);
});

test("complete coalesced CDC applies final values, tombstones, key moves and rowid reuse exactly", t => {
  // Given a restored cut and later source changes including all trigger-derived facts.
  const f = fixture(t);
  restoreSnapshot(f.destination, f.descriptor, f.pages);
  f.source.exec(`BEGIN;
    UPDATE skills SET description='changed',body_head='new body';
    UPDATE sessions SET ended_at=999,first_prompt=NULL;
    UPDATE events SET text=NULL,data_json='{"attributionCandidates":["next"],"args":{"raw":[0,null,{"x":"y"}]}}';
    UPDATE otel_spans SET name='corrected',parent_span_id=NULL;
    UPDATE herdr_workspaces SET label=NULL;
    UPDATE herdr_tabs SET id='moved';
    UPDATE herdr_panes SET cwd='/changed';
    UPDATE pane_sessions SET source='updated';
    UPDATE workflow_specs SET body_json='{"steps":[{"id":"updated"}]}',digest='new digest';
    UPDATE flows SET end_order_domain=NULL,end_order=NULL,end_spans_json=NULL;
    UPDATE flow_steps SET step_id='updated';
    DELETE FROM loads WHERE load_id='delete-me';
    UPDATE loads SET manifest_digest='new digest';
    UPDATE eval_cases SET query='new query';
    DELETE FROM flows WHERE id='unknown';
    INSERT INTO loads(rowid,load_id,uri,manifest_digest,created_at) VALUES (1,'reused','new','digest',5);
    COMMIT;`);
  const cut = journalHead(f.source).cut;
  const final = descriptor([...logicalSnapshot(f.source)]);
  const records = [];
  let after = f.descriptor.cut;
  for (;;) {
    const page = readJournal(f.source, { after, through: cut, limit: 2 });
    if (page.length === 0) break;
    records.push(...page);
    after = page.at(-1).revision;
  }
  // When the entire fixed committed range is applied as one transaction.
  const result = applyCatchup(f.destination, { ...final, after: f.descriptor.cut, records });
  // Then full final rows, not just identities or counts, match the current source.
  assert.equal(result.hash, final.hash);
  assert.deepEqual(restoredFacts(f.destination), facts(f.source));
  assert.equal(clock(f.destination).position, 0);
  assert.equal(journalHead(f.destination).cut, 0);
  assert.throws(() => applyCatchup(f.destination, { ...final, after: f.descriptor.cut, records }),
    { code: "invalid_catchup" });
});

test("revision zero and cut zero remain valid on a never-written source", t => {
  // Given an empty source whose singleton clock is still part of the snapshot.
  const f = fixture(t);
  const source = openDb(":memory:");
  t.after(() => source.close());
  const pages = [...logicalSnapshot(source)];
  const expected = descriptor(pages);
  assert.equal(expected.cut, 0);
  // When restoring revision-zero images.
  const result = restoreSnapshot(f.destination, expected, pages);
  // Then zero is retained and an empty same-cut catchup is valid.
  assert.equal(result.cut, 0);
  assert.equal(verify(f.destination, expected).hash, expected.hash);
  assert.equal(applyCatchup(f.destination, { ...expected, after: 0, records: [] }).cut, 0);
});

test("reopened restore preserves old boundaries and new normal collection journals local marks", t => {
  // Given restored history on disk and a new database connection.
  const f = fixture(t);
  restoreSnapshot(f.destination, f.descriptor, f.pages);
  const db = openDb(f.destinationPath);
  const store = createStore(db, { now: () => 1000 });
  t.after(() => store.close());
  const domain = clock(db).domain;
  const ref = { runtime: "codex", runtimeSessionId: "new-runtime" };
  const sid = store.upsertSession(ref, 1000);
  // When normal collection appends an event, span and session termination.
  store.append({ id: "new-event", ts: 1001, kind: "prompt", source: "hook", ref, data: { args: [0] } },
    { sessionId: sid, method: "runtime_id" });
  store.putSpans([{ traceId: "new-trace", spanId: "new-span", name: "tool", runtime: "codex",
    startMs: 1001, receivedAt: 1002 }]);
  db.prepare("UPDATE sessions SET ended_at=1003 WHERE id=?").run(sid);
  // Then exact restored provenance remains separate and subsequent writes use ordinary local triggers.
  assert.ok(JSON.parse(db.prepare("SELECT recording_orders_json FROM events WHERE id='new-event'").get()
    .recording_orders_json)[domain] > 0);
  assert.ok(JSON.parse(db.prepare("SELECT recording_orders_json FROM otel_spans WHERE trace_id='new-trace'").get()
    .recording_orders_json)[domain] > 0);
  assert.ok(JSON.parse(db.prepare("SELECT end_orders_json FROM sessions WHERE id=?").get(sid).end_orders_json)[domain] > 0);
  assert.deepEqual(JSON.parse(db.prepare("SELECT recording_orders_json FROM events WHERE id='e'").get()
    .recording_orders_json), { original: 0, other: 17 });
  assert.equal(store.flowEventScope("unknown").boundary, "order_unavailable");
  assert.ok(readJournal(db, { after: 0, through: journalHead(db).cut }).some(r => r.key === '["new-event"]'));
  assert.throws(() => applyCatchup(db, { ...f.descriptor, after: f.descriptor.cut, records: [] }),
    { code: "destination_used" });
});

for (const failure of ["page", "hash", "duplicate", "columns", "foreign-key", "iterator", "rowid"]) {
  test(`snapshot ${failure} failure rolls back rows provenance and exact trigger definitions`, t => {
    // Given a fresh file and a malformed transfer that must not publish any state.
    const f = fixture(t);
    const before = facts(f.destination);
    const definitions = triggers(f.destination);
    const sourceBytes = readFileSync(f.sourcePath);
    let pages = structuredClone(f.pages);
    let expected = { ...f.descriptor };
    switch (failure) {
      case "page": pages[0].index = 1; break;
      case "hash": expected.hash = "0".repeat(64); break;
      case "duplicate": {
        const records = pages.flatMap(p => p.records);
        pages = pagesFor([...records, records[0]], expected.sourceDomain, expected.cut);
        break;
      }
      case "columns": {
        const records = pages.flatMap(p => p.records);
        delete records.find(r => r.table === "sessions").values.cwd;
        pages = pagesFor(records, expected.sourceDomain, expected.cut);
        break;
      }
      case "foreign-key": {
        const records = pages.flatMap(p => p.records).filter(r => r.table !== "workflow_specs");
        pages = pagesFor(records, expected.sourceDomain, expected.cut);
        expected = descriptor(pages);
        break;
      }
      case "iterator": {
        const initial = pages[0];
        pages = (function* () { yield initial; throw new Error("interrupted"); })();
        break;
      }
      case "rowid": {
        const records = pages.flatMap(p => p.records);
        const loads = records.filter(r => r.table === "loads");
        loads[1].sourceOrder = loads[0].sourceOrder;
        pages = pagesFor(records, expected.sourceDomain, expected.cut);
        expected = descriptor(pages);
        break;
      }
    }
    // When restore fails anywhere in parsing, insertion or verification.
    assert.throws(() => restoreSnapshot(f.destination, expected, pages));
    // Then the source file and fresh destination survive and the same transfer can be retried.
    assert.deepEqual(facts(f.destination), before);
    assert.deepEqual(triggers(f.destination), definitions);
    assert.equal(f.destination.isTransaction, false);
    assert.equal(f.destination.prepare("SELECT 1 FROM sqlite_schema WHERE name='sync_restore_state'").get(), undefined);
    assert.deepEqual(readFileSync(f.sourcePath), sourceBytes);
    restoreSnapshot(f.destination, f.descriptor, f.pages);
    assert.equal(verify(f.destination, f.descriptor).hash, f.descriptor.hash);
  });
}

test("nonempty destination and its old files remain unchanged when restore is refused", t => {
  // Given a real destination that already contains user history and transport state.
  const f = fixture(t);
  f.destination.exec("INSERT INTO sessions(id,runtime,started_at) VALUES ('old','codex',0)");
  spoolBatch(f.destination, request(f.destination));
  const before = facts(f.destination);
  const spool = f.destination.prepare("SELECT * FROM sync_outbox").all();
  const bytes = readFileSync(f.destinationPath);
  // When attempting restore without a safe-replacement mode.
  assert.throws(() => restoreSnapshot(f.destination, f.descriptor, f.pages), { code: "destination_used" });
  // Then original rows, old spool and file still exist unchanged.
  assert.deepEqual(facts(f.destination), before);
  assert.deepEqual(f.destination.prepare("SELECT * FROM sync_outbox").all(), spool);
  assert.deepEqual(readFileSync(f.destinationPath), bytes);
});

test("failed catchup verification rolls back the previous committed restore", t => {
  // Given a verified snapshot and a new source transaction.
  const f = fixture(t);
  restoreSnapshot(f.destination, f.descriptor, f.pages);
  f.source.exec("UPDATE sessions SET first_prompt='later'");
  const final = descriptor([...logicalSnapshot(f.source)]);
  const records = readJournal(f.source, { after: f.descriptor.cut, through: final.cut });
  const before = restoredFacts(f.destination);
  const definitions = triggers(f.destination);
  // When the range's final hash is wrong.
  assert.throws(() => applyCatchup(f.destination, { ...final, after: f.descriptor.cut,
    hash: "0".repeat(64), records }), { code: "verification_failed" });
  // Then the old cut remains usable and a correct retry succeeds.
  assert.deepEqual(restoredFacts(f.destination), before);
  assert.deepEqual(triggers(f.destination), definitions);
  assert.equal(verify(f.destination, f.descriptor).hash, f.descriptor.hash);
  assert.equal(applyCatchup(f.destination, { ...final, after: f.descriptor.cut, records }).hash, final.hash);
});

test("restore refuses an existing caller transaction without rolling it back", t => {
  // Given caller-owned uncommitted work.
  const f = fixture(t);
  f.destination.exec("BEGIN; INSERT INTO meta VALUES ('caller','owned')");
  // When restore is invoked on the occupied connection.
  assert.throws(() => restoreSnapshot(f.destination, f.descriptor, f.pages), { code: "destination_busy" });
  // Then the transaction remains caller-owned.
  assert.equal(f.destination.isTransaction, true);
  assert.equal(f.destination.prepare("SELECT value FROM meta WHERE key='caller'").get().value, "owned");
  f.destination.exec("ROLLBACK");
});

test("foreign database readers observe only a committed restore", t => {
  // Given a second connection and a transfer paused between pages.
  const f = fixture(t);
  const reader = new DatabaseSync(f.destinationPath, { readOnly: true });
  t.after(() => reader.close());
  const pages = (function* () {
    for (const page of f.pages) {
      assert.equal(reader.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
      yield page;
    }
  })();
  // When restore publishes its transaction.
  restoreSnapshot(f.destination, f.descriptor, pages);
  // Then the reader sees the final rows only after commit.
  assert.equal(reader.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
});
