import assert from "node:assert/strict";
import test from "node:test";
import { seedParity, snapshot, reportReader, NOW, DAY, uri } from "./helpers/activity-facts.mjs";
import { fixture, publish, runtime, query, result } from "../../worker/test/helpers/activity-reports.mjs";

test("real report HTTP, D1/R2 and native Workflow preserve SQLite report payloads", { timeout: 180000 }, async t => {
  // Freeze the local readers as well as the real Worker isolate, not just the captured context.
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const local = seedParity(t), readReport = reportReader(local.store);
  const marker = "PRIVATE_CLOUD_PARITY_RAW";
  const prompt = `${"a".repeat(32766)}\u{1f9ea}\n"\\한글${`${marker} `.repeat(7000)}`;
  local.session("multipart", NOW - 100, prompt);
  const rows = snapshot(local.db), captured = local.runtime();
  const clock = rows.find(row => row.table === "recording_clock").values;
  assert.equal(captured.capturedAtMs, NOW);
  assert.ok(captured.activeRequests.includes("load-in_progress"));
  assert.ok(captured.activeRequests.includes("search-in_progress"));
  assert.ok(captured.ingest.lastError);
  const json = value => JSON.parse(JSON.stringify(value));
  const cases = [];
  const add = (selection, expected) => cases.push({ selection, expected: json(expected) });
  const report = (selection, path, params = {}, changes = {}) => {
    const { kind, flowId, sessionId, ...options } = selection;
    const response = readReport(path, params, {
      ...Object.fromEntries(Object.entries(options)
        .filter(([key, value]) => key !== "automated" || value !== "exclude")
        .map(([key, value]) => [key, String(value)])), ...changes,
    });
    if (response.status === 404) {
      assert.ok(["session_not_found", "automated_excluded", "flow_not_found"].includes(response.body.error));
      cases.push({ selection, expectedError: response.body.error });
    } else {
      assert.equal(response.status, 200, JSON.stringify(selection));
      add(selection, response.body);
    }
  };
  const filters = [
    {}, { automated: "include" }, { automated: "only" },
    { q: "Alpha", loadStatus: ["in_progress"] },
    { q: "İ", searchStatus: ["succeeded"] },
    { searchResult: ["no_candidates"] }, { state: ["exposed_only", "aborted"] },
    { runtime: ["codex"], skill: [uri("pr-review-ko")], from: NOW - 2000, to: NOW },
    { from: NOW, to: NOW }, { runtime: [] },
  ];
  for (const filter of filters) {
    add({ kind: "sessions", filter }, local.store.sessions(filter));
    add({ kind: "stats", filter }, local.store.stats(filter));
    add({ kind: "skill-week", filter }, local.store.skillWeek(filter));
  }
  for (const sessionId of [local.human, "empty-search", "requests-only", "no-activity", "missing"]) {
    add({ kind: "trace", sessionId }, local.store.trace(sessionId));
  }
  for (const unit of ["first_load", "all_loads", "search_requests", "load_requests"]) {
    for (const filter of [{}, { automated: "include", runtime: ["codex"] }]) {
      add({ kind: "flow", filter, unit, top: 3 }, local.store.flow(filter, unit, 3));
    }
  }
  for (const [tz, weekStart, bucketHours] of [["UTC", 0, 1], ["Asia/Seoul", 1, 2], ["America/New_York", 1, 4]]) {
    const filter = { automated: "include", q: "a" };
    add({ kind: "heatmap", filter, tz, weekStart, bucketHours },
      local.store.heatmap(filter, tz, weekStart, bucketHours));
  }
  for (const automated of ["exclude", "include", "only"]) {
    report({ kind: "flows", automated, limit: 2 }, "/api/flows");
    for (const flowId of [local.flowId, "ws:w", "ws:loose", "outside"]) {
      report({ kind: "flow-report", flowId, automated, from: NOW - 55 * DAY, to: NOW + 1, limit: 2 },
        "/api/flows/:id", { id: flowId });
    }
    for (const sessionId of automated === "only" ? ["title"] :
      automated === "include" ? [local.human, "title", "no-activity"] : [local.human, "no-activity"]) {
      report({ kind: "session-report", sessionId, automated },
        "/api/sessions/:id/skill-report", { id: sessionId });
    }
    for (const detailLimit of [0, 2]) {
      report({ kind: "skill-usage", automated, from: NOW - 55 * DAY, to: NOW + 1, detailLimit },
        "/api/skills/usage", {}, { detail: String(detailLimit) });
    }
  }
  const cursorRow = local.store.listFlows({ automated: "include", limit: 1 })[0];
  const cursor = { orderMs: cursorRow.orderMs, id: cursorRow.id };
  report({ kind: "flows", automated: "include", limit: 2, cursor }, "/api/flows", {},
    { cursor: Buffer.from(`${cursor.orderMs}:${cursor.id}`).toString("base64url") });
  // All expected values were read from SQLite, before any cloud request exists.
  t.mock.timers.reset();
  const cloud = await fixture(t);
  assert.equal((await cloud.send("setClock", { now: NOW })).status, 200);
  const transported = [...rows].reverse(), documents = [];
  for (let offset = 0; offset < transported.length; offset += 100) {
    documents.push({ schemaVersion: 2, rows: transported.slice(offset, offset + 100) });
  }
  const begin = await publish({ ...cloud, async send(...args) {
    const response = await cloud.send(...args);
    assert.equal(response.status, 200, `${args[0]}: ${JSON.stringify(response.body)}`);
    return response;
  } }, documents, {
    cut: clock.position, sourceDomain: clock.domain,
  });
  assert.deepEqual(await runtime(cloud, begin, captured), captured);
  let multipart = 0;
  for (const { selection, expected, expectedError } of cases) {
    const label = JSON.stringify(selection), request = query(begin, selection, { tz: captured.tz });
    // This subscribes to actual native Workflow completion before dispatch; no status polling.
    const finished = cloud.finished(request.requestId);
    const accepted = await cloud.api("/v1/activity/query", request);
    assert.equal(accepted.status, 202, `${label}: ${JSON.stringify(accepted.body)}`);
    const completion = await finished;
    if (expectedError) {
      assert.equal(completion.state, "failed", label);
      assert.equal(completion.error, expectedError, label);
      const status = await cloud.api("/v1/activity/reports/status", {
        deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
        generation: begin.generation, jobId: request.requestId,
      });
      assert.equal(status.status, 200, label);
      assert.equal(status.body.error, expectedError, label);
      assert.equal(status.body.result, null, label);
      continue;
    }
    assert.equal(completion.state, "complete", `${label}: ${JSON.stringify(completion)}`);
    const response = await result(cloud, request);
    assert.deepEqual(response.value.payload, expected, label);
    assert.deepEqual(response.value.inputRevision, {
      sequence: 0, journalThrough: clock.position, runtimeSequence: 1,
    }, label);
    assert.equal(response.value.generatedAt, NOW, label);
    assert.equal(response.value.sourceCapturedAt, captured.capturedAtMs, label);
    assert.equal(response.value.analysisVersion, 1, label);
    assert.equal(response.value.coverage.complete, true, label);
    assert.equal(response.status.stale, false, label);
    assert.equal(response.status.pending, false, label);
    assert.equal(response.bytes.toString("utf8"), JSON.stringify(response.value), label);
    if (response.status.result.parts > 1) {
      multipart++;
      const objects = await cloud.rows(
        "SELECT * FROM report_objects WHERE job_id=? AND role='result' ORDER BY part", request.requestId);
      assert.equal(objects.length, response.status.result.parts, label);
      for (const [index, object] of objects.entries()) {
        assert.equal(object.part, index);
        assert.ok(object.key_version > 0);
        const encrypted = await cloud.bucket.get(object.object_key);
        assert.ok(encrypted);
        assert.equal((await encrypted.text()).includes(marker), false, "R2 never contains the raw prompt");
      }
    }
  }
  assert.ok(multipart > 0, "SQLite-equal payloads actually traversed multiple encrypted result parts");
  for (const table of ["report_jobs", "report_objects"]) {
    assert.equal(JSON.stringify(await cloud.rows(`SELECT * FROM ${table}`)).includes(marker), false);
  }
  assert.deepEqual(snapshot(local.db), rows, "reports do not repair or rewrite the original source records");
  t.diagnostic(`${cases.length} cloud payload/error cases equal SQLite; ${multipart} multipart results verified`);
});
