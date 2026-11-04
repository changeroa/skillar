import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { journalHead, openDb, request, seedAll, spoolBatch } from "./helpers/sync.mjs";

const { createStore } = await distImport("store/index.js");

test("v8 portable history preserves existing import semantics without adopting source spool or lineage", t => {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const source = openDb(join(dir, "source.db")), destination = openDb(join(dir, "destination.db"));
  t.after(() => { source.close(); destination.close(); });
  seedAll(source);
  spoolBatch(source, request(source));
  source.prepare(`INSERT INTO connector_command_receipts
    (account_id,generation,device_id,source_domain,command_id,payload_hash,result_json)
    VALUES('fixture',1,'fixture','fixture','fixture','fixture','{}')`).run();
  const sourceStore = createStore(source), destinationStore = createStore(destination);
  const before = journalHead(destination);
  sourceStore.exportTo(join(dir, "export"), { withHistory: true });
  const dryRun = destinationStore.importFrom(join(dir, "export"), { merge: false });
  assert.ok(dryRun.added > 0);
  assert.deepEqual(journalHead(destination), before);
  const result = destinationStore.importFrom(join(dir, "export"), { merge: true });
  assert.ok(result.added > 0);
  assert.equal(destination.prepare("PRAGMA user_version").get().user_version, 8);
  assert.equal(destination.prepare("SELECT first_prompt FROM sessions WHERE id='s'").get().first_prompt, "SENTINEL");
  assert.equal(destination.prepare("SELECT query FROM eval_cases").get().query, "SENTINEL");
  assert.equal(destination.prepare("SELECT text FROM events WHERE id='e'").get().text, "SENTINEL");
  assert.equal(destination.prepare("SELECT body_json FROM workflow_specs WHERE id='spec'").get().body_json, '{"steps":[]}');
  assert.deepEqual({ ...destination.prepare("SELECT start_order_domain,start_order,end_order_domain,end_order FROM flows").get() },
    { ...source.prepare("SELECT start_order_domain,start_order,end_order_domain,end_order FROM flows").get() });
  assert.equal(journalHead(destination).sourceDomain, before.sourceDomain);
  assert.notEqual(journalHead(destination).sourceDomain, journalHead(source).sourceDomain);
  for (const table of ["sync_streams", "sync_outbox", "connector_command_receipts"]) {
    assert.equal(destination.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  }
  assert.ok(journalHead(destination).cut > 0, "import is fresh local CDC, not the source journal");
  const again = destinationStore.importFrom(join(dir, "export"), { merge: true });
  assert.equal(again.added, 0);
});
