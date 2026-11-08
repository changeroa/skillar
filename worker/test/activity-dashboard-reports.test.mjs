import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, publish, query, result, runtime } from "./helpers/activity-reports.mjs";
import { principal } from "./helpers/activity-content.mjs";

const row = (table, key, values) => ({ table, key: JSON.stringify([key]), revision: 1,
  operation: "upsert", sourceOrder: 1, values });
test("report fixture supports explicit eval save with read-only downscoped authority", async t => {
  // Given the same real Worker fixture used by Pages/browser integration.
  const f = await fixture(t);
  await publish(f, [{ schemaVersion: 2, rows: [
    row("recording_clock", 1, { singleton: 1, domain: "domain", position: 0 }),
  ] }]);
  // When explicit browser save reaches its production service route.
  const response = await f.api("/v1/activity/dashboard/eval-cases", {
    profile: { deviceId: "device-a", sourceDomain: "source" }, requestId: randomUUID(),
    input: { query: "fixture cloud eval" },
  }, principal({ scopes: ["activity:read"] }));
  // Then the migrated fixture stores encrypted bytes without granting ingest scope.
  assert.equal(response.status, 201, JSON.stringify(response));
  assert.equal(response.body.state, "stored");
  const [stored] = await f.rows("SELECT state,object_key FROM dashboard_eval_cases");
  assert.equal(stored.state, "stored");
  assert.notEqual(await f.bucket.get(stored.object_key), null);
});

test("native report handlers execute skills and workflow versions with encrypted pinned inputs", { timeout: 30000 }, async t => {
  // Given a completed snapshot with catalog and immutable workflow facts.
  const f = await fixture(t);
  const uri = "skill://local/r/example/SKILL.md";
  const rows = [
    row("recording_clock", 1, { singleton: 1, domain: "domain", position: 0 }),
    row("skills", uri, { uri, root_id: "r", name: "example", description: "PRIVATE_CATALOG",
      tags_json: "[]", when_to_use: null, examples_json: "[]", aliases_ko_json: "[]",
      group_id: null, group_stage: null, invocation: "automatic", body_head: "body",
      digest: "hash", manifest_digest: "manifest", resources_json: "[]", mtime_ms: 1, removed_at: null }),
    ...[1, 2].map(version => row("workflow_specs", `spec-${version}`, { id: `spec-${version}`,
      name: "flow", version, digest: "hash", created_ms: version,
      body_json: JSON.stringify({ name: "flow", steps: [{ id: "build", skills: ["example"],
        together: false, expectTools: [] }] }) })),
  ];
  const begin = await publish(f, [{ schemaVersion: 2, rows }]);
  await runtime(f, begin, {});
  assert.equal((await f.rows("SELECT count(*) AS n FROM ingest_receipts"))[0].n, 0);
  assert.equal((await f.rows("SELECT sequence FROM device_streams"))[0].sequence, 0);
  // When production report routes dispatch the two added query kinds.
  const payloads = [];
  for (const selection of [{ kind: "skills" }, { kind: "workflow-versions", name: "flow" }]) {
    const request = query(begin, selection), finished = f.finished(request.requestId);
    const response = await f.api("/v1/activity/query", request);
    assert.equal(response.status, 202, JSON.stringify(response));
    const outcome = await finished;
    assert.equal(outcome.state, "complete", JSON.stringify(outcome));
    payloads.push((await result(f, request)).value.payload);
  }
  // Then both native encrypted reports retain the local Api read contract before the first CDC receipt.
  assert.equal(payloads[0][0].uri, uri);
  assert.equal(payloads[0][0].dir, "example");
  assert.equal(payloads[0][0].description, "PRIVATE_CATALOG");
  assert.deepEqual(payloads[1].map(v => v.version), [2, 1]);
  assert.deepEqual(payloads[1][0].steps, [{ id: "build", skills: ["example"], together: false, expectTools: [] }]);
  assert.equal(JSON.stringify(await f.rows("SELECT * FROM report_jobs")).includes("PRIVATE_CATALOG"), false);
});

test("workflow-version reports expose missing workflow explicitly", { timeout: 30000 }, async t => {
  // Given a snapshot without workflow versions.
  const f = await fixture(t);
  const begin = await publish(f, [{ schemaVersion: 2, rows: [
    row("recording_clock", 1, { singleton: 1, domain: "domain", position: 0 }),
  ] }]);
  await runtime(f, begin, {});
  const request = query(begin, { kind: "workflow-versions", name: "missing" });
  const finished = f.finished(request.requestId);
  // When the production report executes.
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  const outcome = await finished;
  // Then the durable report fails explicitly rather than inventing an empty workflow.
  assert.equal(outcome.state, "failed");
  assert.equal(outcome.error, "spec_not_found");
});
