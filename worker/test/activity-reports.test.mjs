import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fixture, ingest, publish, query, result, runtime } from "./helpers/activity-reports.mjs";

const clock = { table: "recording_clock", key: "[1]", revision: 1, operation: "upsert", sourceOrder: 1,
  values: { singleton: 1, domain: "original-domain", position: 0 } };
const document = rows => ({ schemaVersion: 2, rows });
const session = (prompt, id = "s") => ({
  table: "sessions", key: JSON.stringify([id]), revision: 1, operation: "upsert", sourceOrder: 1,
  values: { id, runtime: "codex", runtime_session_id: id, conversation_id: null,
    client_name: null, cwd: "/private/project", started_at: 100, ended_at: null,
    first_prompt: prompt, end_orders_json: "{}" },
});

test("native ReportFlow completes pinned stats with encrypted inputs/results and no Oracle", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  const context = await runtime(f, begin, { ingest: { accepted: 7, rejected: 2, dropped: 1 } });
  const request = query(begin, { kind: "stats" });
  const finished = f.finished(request.requestId);
  const accepted = await f.api("/v1/activity/query", request);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  assert.equal((await finished).state, "complete");
  const response = await result(f, request);
  assert.deepEqual(response.value.payload.ingest, context.ingest);
  assert.equal(response.value.inputRevision.sequence, 0);
  assert.equal(response.value.inputRevision.journalThrough, begin.cut);
  assert.equal(response.value.inputRevision.runtimeSequence, 1);
  assert.equal(response.value.analysisVersion, 1);
  assert.equal(response.value.coverage.complete, true);
  assert.equal(response.status.pending, false);
  assert.equal((await f.rows("SELECT count(*) AS n FROM report_jobs WHERE state='complete'"))[0].n, 1);
  const replay = await f.api("/v1/activity/query", request);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.jobId, accepted.body.jobId);
  assert.equal(replay.body.inputRevision.runtimeSequence, 1);
  assert.equal((await f.api("/v1/activity/query", { ...request, query: { kind: "sessions" } })).status, 409);
});

test("multi-part reports preserve native JSON bytes and Unicode across streaming boundaries", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const prompt = `${"a".repeat(32766)}🧪\n"\\한글${" PRIVATE_REPORT_RAW ".repeat(20000)}`;
  const begin = await publish(f, [document([clock, session(prompt)])]);
  await runtime(f, begin, {});
  const request = query(begin, { kind: "sessions", filter: { automated: "include" } });
  const finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  const response = await result(f, request);
  assert.ok(response.status.result.parts > 1);
  assert.equal(response.value.payload[0].firstPrompt, prompt);
  assert.equal(response.bytes.toString("utf8"), JSON.stringify(response.value));
  assert.equal(createHash("sha256").update(JSON.stringify(response.value)).digest("hex"), response.status.result.hash);
  for (const table of ["report_jobs", "report_objects"]) {
    assert.equal(JSON.stringify(await f.rows(`SELECT * FROM ${table}`)).includes("PRIVATE_REPORT_RAW"), false);
  }
  const objects = await f.bucket.list();
  for (const object of objects.objects.filter(object => object.key.includes("/reports/"))) {
    const stored = await f.bucket.get(object.key);
    assert.equal((await stored.text()).includes("PRIVATE_REPORT_RAW"), false);
  }
});

test("a job pins both facts and runtime while later capture makes it stale", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock, session("before")])]);
  await runtime(f, begin, { ingest: { accepted: 1, rejected: 0, dropped: 0 } });
  const request = query(begin, { kind: "sessions", filter: { automated: "include" } });
  f.onStart(request.requestId, async () => {
    await ingest(f, begin, [{ ...session("after"), revision: 2 }]);
    await runtime(f, { ...begin, cut: 2 }, { ingest: { accepted: 2, rejected: 0, dropped: 0 } }, 2);
  });
  const finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  const pinned = await result(f, request);
  assert.equal(pinned.value.payload[0].firstPrompt, "before");
  assert.equal(pinned.value.inputRevision.sequence, 0);
  assert.equal(pinned.value.inputRevision.runtimeSequence, 1);
  assert.equal(pinned.status.stale, true);
  const replay = await f.api("/v1/activity/query", request);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.inputRevision.runtimeSequence, 1);
  assert.equal(replay.body.inputRevision.journalThrough, 1);
  const next = query(begin, request.query), nextFinished = f.finished(next.requestId);
  assert.equal((await f.api("/v1/activity/query", next)).status, 202);
  assert.equal((await nextFinished).state, "complete");
  const latest = await result(f, next);
  assert.equal(latest.value.payload[0].firstPrompt, "after");
  assert.equal(latest.value.inputRevision.sequence, 1);
  assert.equal(latest.value.inputRevision.runtimeSequence, 2);
});

test("reports enforce current consent and account/device/generation isolation", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  await runtime(f, begin, {});
  const request = query(begin, { kind: "stats" }), finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  await finished;
  const reference = { deviceId: begin.deviceId, generation: 1, sourceDomain: begin.sourceDomain, jobId: request.requestId };
  for (const changes of [{ accountId: "foreign" }, { deviceId: "foreign" }, { generation: 2 }]) {
    const who = { kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
      shardId: "activity-00", scopes: ["activity:read"], issuer: "https://skillar.sh", sessionId: null, ...changes };
    assert.equal((await f.api("/v1/activity/reports/status", reference, who)).status, 403);
    assert.equal((await f.api("/v1/activity/reports/result", { ...reference, part: 0 }, who)).status, 403);
  }
  await f.accounts.prepare("UPDATE device_consents SET consent_json=?").bind('{"mode":"local-only"}').run();
  assert.equal((await f.api("/v1/activity/reports/result", { ...reference, part: 0 })).status, 403);
  assert.equal((await f.api("/v1/activity/query", query(begin, { kind: "stats" }))).status, 403);
});

test("derived report expiry cannot extend its raw input retention", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  await runtime(f, begin, {});
  const created = Date.now() - 10 * 86_400_000;
  await f.db.prepare("UPDATE content_uploads SET created_at=?").bind(created).run();
  const request = query(begin, { kind: "stats" }), finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  const job = (await f.rows("SELECT expires_at FROM report_jobs"))[0];
  assert.equal(job.expires_at, created + 30 * 86_400_000);
  assert.equal((await f.rows("SELECT max(expires_at) AS expires FROM report_objects"))[0].expires, job.expires_at);
  await f.db.prepare("UPDATE report_jobs SET expires_at=?").bind(Date.now() - 86_400_000).run();
  assert.equal((await f.api("/v1/activity/reports/status", {
    deviceId: begin.deviceId, generation: 1, sourceDomain: begin.sourceDomain, jobId: request.requestId,
  })).status, 410);
});

test("expired raw input fails before decryption and never publishes a result", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  await runtime(f, begin, {});
  const old = (await f.rows("SELECT object_key FROM content_uploads WHERE batch_id LIKE '%-page-0'"))[0];
  await f.bucket.delete(old.object_key);
  await f.db.prepare("UPDATE content_uploads SET created_at=? WHERE batch_id LIKE '%-page-0'")
    .bind(Date.now() - 31 * 86_400_000).run();
  const request = query(begin, { kind: "stats" }), finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "failed");
  const job = (await f.rows("SELECT state,error_code FROM report_jobs"))[0];
  assert.deepEqual(job, { state: "failed", error_code: "report_expired" });
  assert.equal((await f.rows("SELECT count(*) n FROM report_objects WHERE role='result'"))[0].n, 0);
});

test("generation closure after encrypted PUT prevents publication and sweeps late objects", { timeout: 30000 }, async t => {
  const f = await fixture(t, { observeParts: true }), begin = await publish(f, [document([clock])]);
  await runtime(f, begin, {});
  const request = query(begin, { kind: "stats" });
  let release;
  const acceptedBarrier = new Promise(resolve => { release = resolve; });
  f.onStart(request.requestId, () => acceptedBarrier);
  f.onPart(request.requestId, () => f.db.prepare("UPDATE tenant_fences SET state='closed'").run());
  const finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  release();
  assert.equal((await finished).state, "errored");
  assert.equal((await f.rows("SELECT count(*) n FROM report_jobs WHERE state='complete'"))[0].n, 0);
  const object = (await f.rows("SELECT object_key FROM report_objects WHERE role='result'"))[0];
  const encrypted = await (await f.bucket.get(object.object_key)).text();
  assert.equal((await f.send("sweepReports", {})).status, 200);
  assert.equal(await f.bucket.get(object.object_key), null);
  await f.bucket.put(object.object_key, encrypted); // The exact encrypted PUT completes late.
  assert.equal((await f.send("sweepReports", {})).status, 200);
  assert.equal(await f.bucket.get(object.object_key), null);
});

test("freshness uses server receipt time even when a source clock is ahead", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  const now = Date.now();
  assert.equal((await f.send("setClock", { now })).status, 200);
  await runtime(f, begin, { capturedAtMs: now + 86_400_000 });
  const request = query(begin, { kind: "stats" }), finished = f.finished(request.requestId);
  assert.equal((await f.api("/v1/activity/query", request)).status, 202);
  assert.equal((await finished).state, "complete");
  assert.equal((await result(f, request)).status.stale, false);
  assert.equal((await f.send("setClock", { now: now + 60_001 })).status, 200);
  assert.equal((await result(f, request)).status.stale, true);
});

test("durable dispatch recovers a queued encrypted request after Workflow service failure", { timeout: 30000 }, async t => {
  const f = await fixture(t), begin = await publish(f, [document([clock])]);
  await runtime(f, begin, {});
  assert.equal((await f.send("dispatchAvailable", { available: false })).status, 200);
  const request = query(begin, { kind: "stats", filter: { q: "PRIVATE_QUERY" } });
  const unavailable = await f.api("/v1/activity/query", request);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, "report_unavailable");
  assert.equal((await f.rows("SELECT state FROM report_jobs"))[0].state, "queued");
  assert.equal(JSON.stringify(await f.rows("SELECT * FROM report_jobs")).includes("PRIVATE_QUERY"), false);
  assert.equal((await f.send("dispatchAvailable", { available: true })).status, 200);
  const finished = f.finished(request.requestId);
  const dispatched = await f.send("dispatchReports", {});
  assert.equal(dispatched.status, 200);
  assert.equal(dispatched.body.dispatched, 1);
  assert.equal((await finished).state, "complete");
  assert.equal((await result(f, request)).status.state, "complete");
});
