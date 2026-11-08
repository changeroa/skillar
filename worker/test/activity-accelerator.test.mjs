import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { fixture, publish, query, result, runtime } from "./helpers/activity-reports.mjs";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/activity/accelerator.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node",
});
const { oracleAccelerator } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const job = {
  account_id: "account-a", generation: 1, device_id: "device-a", source_domain: "source",
  job_id: "55555555-5555-4555-8555-555555555555", request_hash: "a".repeat(64),
  lease_fence: 1, lease_until: 2000, expires_at: 3000,
};
for (const [name, changes] of [
  ["current lease", {}],
  ["expired retention", { expires_at: 0 }],
  ["old lease", { lease_fence: 0, lease_until: 0 }],
  ["retired generation", { generation: 0 }],
]) {
  test(`disabled Oracle declines ${name} without accepting external work`, async () => {
    // Given an intentionally disabled processor and a metadata-only job reference.
    const input = { ...job, ...changes };
    // When a caller offers this job to the optional processor.
    const submission = await oracleAccelerator.submit(input);
    // Then no external lease is accepted, including for stale/expired references.
    assert.equal(oracleAccelerator.enabled, false);
    assert.deepEqual(submission, { state: "disabled" });
  });
}

test("authenticated native status reports Oracle disabled without consuming a report lease", { timeout: 30000 }, async t => {
  // Given the real Worker/D1/R2 report runtime with no Oracle resources.
  const f = await fixture(t);
  // When an authenticated internal caller reads its operational status.
  const response = await f.api("/v1/activity/accelerator/status", {});
  // Then the machine-consumed status names the active core and no external writer.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    provider: "oracle", enabled: false, state: "disabled",
    coreProcessor: "cloudflare-workflow", acceptsCallbacks: false, externalJobs: 0,
  });
  assert.equal((await f.rows("SELECT count(*) AS n FROM report_jobs"))[0].n, 0);
});

test("old and duplicate Oracle callbacks cannot replace a native serverless result", { timeout: 30000 }, async t => {
  // Given an actual encrypted source and a completed native Workflow report.
  const f = await fixture(t);
  const clock = { table: "recording_clock", key: "[1]", revision: 1, operation: "upsert",
    sourceOrder: 1, values: { singleton: 1, domain: "original-domain", position: 0 } };
  const begin = await publish(f, [{ schemaVersion: 2, rows: [clock] }]);
  await runtime(f, begin, { ingest: { accepted: 7, rejected: 2, dropped: 1 } });
  const request = query(begin, { kind: "stats" });
  const finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  const before = await f.rows("SELECT * FROM report_jobs");
  // When an unavailable/retired processor sends an old callback twice.
  const callback = { ...job, job_id: request.requestId, lease_fence: 0,
    lease_until: 0, expires_at: 0 };
  const first = await f.api("/v1/activity/accelerator/complete", callback);
  const duplicate = await f.api("/v1/activity/accelerator/complete", callback);
  // Then no callback writer exists and the actual core result remains intact.
  assert.equal(first.status, 404);
  assert.equal(duplicate.status, 404);
  assert.deepEqual(await f.rows("SELECT * FROM report_jobs"), before);
  assert.deepEqual((await result(f, request)).value.payload.ingest,
    { accepted: 7, rejected: 2, dropped: 1 });
});
