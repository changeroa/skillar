import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { distImport } from "./_helpers.mjs";
import { fixture, grant } from "./helpers/sync-cloud.mjs";
import { seedRich } from "./helpers/sync-restore.mjs";

const { runCloudStep } = await distImport("sync/cloud.js");
const { prepareCloudSnapshot } = await distImport("sync/cloud-prepare.js");
const { restoreCloud } = await distImport("sync/cloud-restore.js");
const { readRows } = await distImport("sync/restore-rows.js");
const { openDb } = await distImport("store/db.js");
const { journalHead } = await distImport("sync/journal.js");
const { targetTables } = await distImport("sync/tables.js");

test("all 15 tables, recursive updates, deletes, raw JSON, row order and original vectors survive cloud restore", async t => {
  const f = await fixture(t);
  seedRich(f.db);
  assert.equal(targetTables.every(table => f.db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()), true);
  const prepared = await prepareCloudSnapshot(f.home, f.source);
  await f.setConsent(grant(prepared));
  const step = () => runCloudStep(f.home, f.source, { fetcher: f.fetcher });
  const drain = async () => {
    for (let units = 0; units < 130; units++) {
      const progress = await step();
      if (progress.phase !== "queued") {
        assert.equal(progress.phase, "caught-up", JSON.stringify(progress));
        return;
      }
    }
    assert.fail("bounded work did not drain");
  };
  await drain();
  f.db.exec(`BEGIN;
    UPDATE events SET data_json='{"args":{"nested":[0,null,"한글"]},"attributionCandidates":["foreign"]}',
      text='corrected',attribution_method='trace_handle',attribution_reason='tool_call_uri'
      WHERE id='e';
    DELETE FROM loads WHERE load_id='delete-me';
    UPDATE sessions SET ended_at=300,end_orders_json='{"original":0,"other":71}' WHERE id='s';
    UPDATE otel_spans SET name='corrected span',end_ms=299;
    UPDATE workflow_specs SET version=2,body_json='{"steps":[{"id":"step","args":[null,7]}]}';
    COMMIT;`);
  await drain();
  // A new explicit full grant can read retained bytes from the prior grant.
  // Uploads still require their exact current consent version.
  await f.setConsent(grant(prepared, { version: 2 }));
  const destination = join(f.home, "golden.sqlite"), cut = journalHead(f.db).cut;
  const result = await restoreCloud(f.home, destination, {
    deviceId: "device-a", generation: 1, sourceDomain: prepared.sourceDomain,
    snapshotId: prepared.snapshotId,
  }, f.fetcher);
  assert.equal(result.cut, cut);
  const restored = openDb(destination);
  try {
    const clock = JSON.parse(restored.prepare("SELECT clock_json FROM sync_restore_state").get().clock_json);
    assert.deepEqual(readRows(restored, cut, clock), readRows(f.db, cut));
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(restored.prepare("SELECT uri,name,body_head FROM skills_fts").all(),
      f.db.prepare("SELECT uri,name,body_head FROM skills WHERE removed_at IS NULL").all());
    assert.equal(journalHead(restored).cut, 0);
    assert.equal(restored.prepare("SELECT count(*) n FROM sync_streams").get().n, 0);
  } finally {
    restored.close();
  }
});
