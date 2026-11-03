import assert from "node:assert/strict";
import test from "node:test";
import { fixture, snapshot } from "./helpers/activity-reports.mjs";

async function fresh(t) {
  const f = await fixture(t);
  const migration = await snapshot(f, [{ schemaVersion: 2, rows: [] }]);
  // No source, key or upload has ever existed for this fixture account.
  assert.equal((await f.rows("SELECT count(*) n FROM content_uploads"))[0].n, 0);
  await f.db.prepare("DELETE FROM tenant_fences").run();
  return { ...f, migration };
}

test("first consented migration and first chunk provision the missing account fence", async t => {
  for (const first of ["migration", "chunk"]) {
    const f = await fresh(t);
    const response = first === "migration"
      ? await f.api("/v1/activity/migrations/begin", f.migration.begin)
      : await f.api("/v1/activity/chunks", f.migration.packets[0].uploads[0]);
    assert.equal(response.status, first === "migration" ? 200 : 201, JSON.stringify(response));
    const rows = await f.rows("SELECT * FROM tenant_fences");
    assert.deepEqual(rows, [{ account_id: "account-a", generation: 1, state: "active" }]);
  }
});

for (const [name, sql] of [
  ["local-only", `UPDATE device_consents SET consent_json='{"mode":"local-only"}'`],
  ["revoked device", "UPDATE devices SET revoked_at=1"],
  ["revoked account", "UPDATE accounts SET state='revoked'"],
  ["changed generation", "UPDATE accounts SET auth_generation=2"],
  ["ungranted project", `UPDATE device_consents SET consent_json=json_set(
    consent_json,'$.scope.projectIds',json('["another-project"]'))`],
]) test(`missing fence is not provisioned for ${name}`, async t => {
  const f = await fresh(t);
  await f.accounts.prepare(sql).run();
  const response = await f.api("/v1/activity/migrations/begin", f.migration.begin);
  assert.equal(response.status, 403, JSON.stringify(response));
  assert.equal((await f.rows("SELECT count(*) n FROM tenant_fences"))[0].n, 0);
  assert.equal((await f.rows("SELECT count(*) n FROM migration_runs"))[0].n, 0);
  assert.equal((await f.bucket.list()).objects.length, 0);
});

for (const [state, generation] of [["closed", 1], ["active", 2]]) {
  test(`initialization never reopens an existing ${state} generation ${generation} fence`, async t => {
    const f = await fresh(t);
    await f.db.prepare("INSERT INTO tenant_fences VALUES ('account-a',?,?)").bind(generation, state).run();
    const response = await f.api("/v1/activity/migrations/begin", f.migration.begin);
    assert.equal(response.status, 403, JSON.stringify(response));
    assert.equal(response.body.error, "tenant_fenced");
    assert.deepEqual(await f.rows("SELECT * FROM tenant_fences"), [
      { account_id: "account-a", generation, state },
    ]);
  });
}

test("a concurrent close at the first fence insert wins and remains closed on retry", async t => {
  const f = await fresh(t);
  await f.db.prepare(`CREATE TRIGGER fixture_close_first_fence AFTER INSERT ON tenant_fences
    BEGIN UPDATE tenant_fences SET state='closed' WHERE account_id=NEW.account_id; END`).run();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.api("/v1/activity/migrations/begin", f.migration.begin);
    assert.equal(response.status, 403, JSON.stringify(response));
    assert.equal(response.body.error, "tenant_fenced");
    assert.equal((await f.rows("SELECT state FROM tenant_fences"))[0].state, "closed");
    assert.equal((await f.rows("SELECT count(*) n FROM migration_runs"))[0].n, 0);
  }
});
