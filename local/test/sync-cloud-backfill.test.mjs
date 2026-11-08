import assert from "node:assert/strict";
import test from "node:test";
import { distImport } from "./_helpers.mjs";
import { fixture, grant } from "./helpers/sync-cloud.mjs";

const { runCloudStep } = await distImport("sync/cloud.js");
const { prepareCloudSnapshot } = await distImport("sync/cloud-prepare.js");
const { journalHead } = await distImport("sync/journal.js");

test("historical backfill interleaves with live CDC and cannot reset its acknowledged cursor", async t => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES('old','codex',100,?)")
    .run("old raw".repeat(50000));
  await f.setConsent(grant(null));
  const step = options => runCloudStep(f.home, f.source, { fetcher: f.fetcher, ...options });
  assert.equal((await step()).phase, "queued");
  assert.equal((await step()).phase, "queued");
  assert.equal((await step()).phase, "caught-up");
  const prepared = await prepareCloudSnapshot(f.home, f.source);
  await f.setConsent(grant(prepared, { version: 2 }));
  assert.equal((await step()).phase, "queued"); // The browser's explicit historical grant schedules it.
  for (let index = 0; index < 6; index++) {
    f.db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES(?,'codex',?,'live')")
      .run(`new-${index}`, 2000 + index);
    assert.equal((await step()).phase, "queued");
  }
  const staged = await f.remote.rows("SELECT state FROM migration_runs WHERE purpose='backfill'");
  assert.equal(staged[0].state, "staging");
  const live = (await f.remote.rows("SELECT sequence,journal_through FROM device_streams"))[0];
  assert.ok(live.sequence >= 5);
  assert.ok(live.journal_through > prepared.cut);
  for (let units = 0; units < 130; units++) {
    const progress = await step();
    if (progress.phase !== "queued") {
      assert.equal(progress.phase, "caught-up", JSON.stringify(progress));
      break;
    }
    assert.notEqual(units, 129, "bounded backfill failed to drain");
  }
  const published = (await f.remote.rows(`SELECT state,cursor_sequence,cursor_through
    FROM migration_runs WHERE purpose='backfill'`))[0];
  assert.equal(published.state, "complete");
  assert.ok(published.cursor_sequence >= live.sequence);
  assert.ok(published.cursor_through >= live.journal_through);
  const final = (await f.remote.rows("SELECT sequence,journal_through FROM device_streams"))[0];
  assert.equal(final.journal_through, journalHead(f.db).cut);
  assert.equal((await step({ backfill: true })).phase, "caught-up");
  assert.deepEqual((await f.remote.rows("SELECT sequence,journal_through FROM device_streams"))[0], final);
});
