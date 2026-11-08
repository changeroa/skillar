import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../dashboard/cloud.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
const { createCloudApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const profile = { deviceId: "fixture-device", sourceDomain: "fixture-source" };
const jobId = "11223344-1122-4122-8122-112233445566";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const revision = { sequence: 2, journalThrough: 3, runtimeSequence: 1 };
function wire(payload = [], raw) {
  const bytes = raw ?? Buffer.from(JSON.stringify({
    generatedAt: 100, inputRevision: revision, analysisVersion: 1,
    coverage: { complete: true, fromMs: 0, toMs: 200 }, sourceCapturedAt: 90,
    sourceReceivedAt: 95, pending: false, payload,
  }));
  const unicode = bytes.indexOf(Buffer.from("한"));
  const split = unicode < 0 ? 17 : unicode + 1;
  const chunks = [bytes.subarray(0, split), bytes.subarray(split)];
  return {
    status: {
      schemaVersion: 1, jobId, state: "complete", generatedAt: 100, sourceCapturedAt: 90,
      sourceReceivedAt: 95, inputRevision: { ...revision }, analysisVersion: 1, stale: true,
      pending: false, error: null, result: { parts: 2, bytes: bytes.length, hash: digest(bytes) },
    },
    parts: chunks.map((chunk, index) => ({ index, bytes: chunk.length, hash: digest(chunk), body: chunk.toString("base64") })),
  };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function harness(result = wire(), overrides = {}) {
  const requests = [];
  const reports = [];
  const fetch = async (path, init) => {
    requests.push({ path, init, body: JSON.parse(init.body) });
    if (path.endsWith("/result")) return json(result.parts[JSON.parse(init.body).part]);
    return json(result.status);
  };
  const api = createCloudApi(profile, { fetch, onUnauthorized() {}, onReport: (r) => reports.push(r), ...overrides });
  return { api, requests, reports };
}

test("maps every dashboard report read to the actual wire and unwraps payload", async () => {
  // Given
  const { api, requests, reports } = harness(wire(["한글"]));
  const calls = [
    [() => api.sessions({ q: "query" }), { kind: "sessions", filter: { q: "query" } }],
    [() => api.trace("s"), { kind: "trace", sessionId: "s" }],
    [() => api.flow({}), { kind: "flow", filter: {}, unit: "first_load", top: 20 }],
    [() => api.flows(), { kind: "flows", limit: 20, automated: "exclude" }],
    [() => api.flowReport("f"), { kind: "flow-report", flowId: "f", limit: 100, automated: "exclude" }],
    [() => api.workflowVersions("w"), { kind: "workflow-versions", name: "w" }],
    [() => api.skillReport("s"), { kind: "session-report", sessionId: "s", automated: "exclude" }],
    [() => api.heatmap({}, { tz: "UTC", bucket: 4 }), { kind: "heatmap", filter: {}, tz: "UTC", weekStart: 1, bucketHours: 4 }],
    [() => api.skillWeek({}), { kind: "skill-week", filter: {} }],
    [() => api.stats(), { kind: "stats", filter: {} }],
    [() => api.skills(), { kind: "skills" }],
  ];
  // When / Then
  for (const [call, query] of calls) {
    assert.deepEqual(await call(), ["한글"]);
    const submitted = requests.at(-3);
    assert.equal(submitted.path, "/api/dashboard/query");
    assert.deepEqual(submitted.body.profile, profile);
    assert.deepEqual(submitted.body.query, query);
    assert.match(submitted.body.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(submitted.init.credentials, "same-origin");
    assert.equal(submitted.init.cache, "no-store");
    assert.equal(submitted.init.method, "POST");
    assert.deepEqual(requests.at(-1).body, { profile, jobId, part: 1 });
  }
  assert.equal(reports.length, calls.length);
  assert.equal(reports[0].stale, true);
  api.dispose();
});

test("converts an opaque workspace cursor into the cloud report sort key", async () => {
  const cursor = Buffer.from("100:flow:with:colon").toString("base64url");
  const { api, requests } = harness();
  await api.flows({ from: 10, to: 20, limit: 7, automated: "only", cursor });
  assert.deepEqual(requests[0].body.query, {
    kind: "flows", from: 10, to: 20, limit: 7, automated: "only", cursor: { orderMs: 100, id: "flow:with:colon" },
  });
  api.dispose();
});

test("polls queued and running states only after controlled scheduler release", async () => {
  // Given
  const result = wire();
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const entered = [Promise.withResolvers(), Promise.withResolvers()];
  let waits = 0, statuses = 0;
  const { api, requests, reports } = harness(result, {
    wait: () => { const i = waits++; entered[i].resolve(); return gates[i].promise; },
    fetch: async (path, init) => {
      requests.push({ path, body: JSON.parse(init.body) });
      if (path.endsWith("/result")) return json(result.parts[JSON.parse(init.body).part]);
      const state = ["queued", "running", "complete"][statuses++];
      return json({ ...result.status, state, pending: state !== "complete", result: state === "complete" ? result.status.result : null });
    },
  });
  // When
  const pending = api.sessions({});
  await entered[0].promise;
  assert.equal(statuses, 1);
  gates[0].resolve();
  await entered[1].promise;
  assert.equal(statuses, 2);
  gates[1].resolve();
  // Then
  assert.deepEqual(await pending, []);
  assert.deepEqual(reports.map((r) => r.state), ["queued", "running", "complete"]);
  assert.deepEqual(requests[1], { path: "/api/dashboard/reports/status", body: { profile, jobId } });
  api.dispose();
});

for (const state of ["failed", "queued"]) test(`rejects ${state} without reading result parts`, async () => {
  // Given
  const result = wire();
  result.status = { ...result.status, state, error: state === "failed" ? "source_gap" : null, pending: state !== "failed", result: null };
  const { api, requests } = harness(result, { maxPolls: 0 });
  // When / Then
  await assert.rejects(api.stats(), { code: state === "failed" ? "source_gap" : "cloud_pending" });
  assert.equal(requests.length, 1);
  api.dispose();
});

for (const damage of ["part-hash", "part-bytes", "index", "base64", "full-hash", "full-bytes", "utf8", "json", "envelope"]) {
  test(`rejects corrupt ${damage} before exposing payload`, async () => {
    // Given
    const raw = damage === "utf8" ? Buffer.concat([Buffer.alloc(18, 32), Buffer.from([255])])
      : damage === "json" ? Buffer.from(" ".repeat(18) + "{") : undefined;
    const result = wire([], raw);
    if (damage === "part-hash") result.parts[0].hash = "0".repeat(64);
    if (damage === "part-bytes") result.parts[0].bytes++;
    if (damage === "index") result.parts[0].index = 3;
    if (damage === "base64") result.parts[0].body = "!!!!";
    if (damage === "full-hash") result.status.result.hash = "0".repeat(64);
    if (damage === "full-bytes") result.status.result.bytes++;
    if (damage === "envelope") result.status.inputRevision.sequence++;
    const { api } = harness(result);
    // When / Then
    await assert.rejects(api.skills(), (error) => error.code === "cloud_integrity" || error.code === "cloud_report");
    api.dispose();
  });
}

test("401 invalidates content, aborts concurrent work, and invokes cloud login callback once", async () => {
  // Given
  const started = Promise.withResolvers();
  let signal, unauthorized = 0, invalidated = 0, calls = 0;
  const api = createCloudApi(profile, {
    onUnauthorized: () => unauthorized++,
    fetch: async (_path, init) => {
      if (++calls === 1) {
        signal = init.signal;
        started.resolve();
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      }
      return json({}, 401);
    },
  });
  api.events({ onInvalidate: () => invalidated++ });
  const first = api.sessions({});
  const firstRejected = assert.rejects(first, { code: "cloud_unauthorized" });
  await started.promise;
  // When
  await assert.rejects(api.skills(), { status: 401, code: "cloud_unauthorized" });
  await firstRejected;
  // Then
  assert.equal(signal.aborted, true);
  assert.equal(unauthorized, 1);
  assert.equal(invalidated, 1);
  await assert.rejects(api.stats(), { code: "cloud_unauthorized" });
  assert.equal(calls, 2);
});

for (const cancel of ["dispose", "signal"]) test(`clears pending scheduler on ${cancel}`, async () => {
  // Given
  const entered = Promise.withResolvers(), controller = new AbortController();
  const result = wire();
  result.status = { ...result.status, state: "queued", pending: true, result: null };
  let scheduledSignal;
  const { api, requests } = harness(result, {
    signal: controller.signal,
    wait: (_ms, signal) => {
      scheduledSignal = signal;
      entered.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  });
  const pending = api.stats();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await entered.promise;
  // When
  if (cancel === "dispose") api.dispose(); else controller.abort();
  await rejected;
  // Then
  assert.equal(scheduledSignal.aborted, true);
  assert.equal(requests.length, 1);
});

test("snapshot refresh emits a real reload signal without fabricated sessions", () => {
  // Given
  const { api } = harness();
  const states = [];
  let refreshed = 0, sessions = 0;
  const stop = api.events({ onState: (s) => states.push(s), onRefresh: () => refreshed++, onSession: () => sessions++ });
  // When
  api.refresh();
  stop();
  api.refresh();
  // Then
  assert.deepEqual(states, ["offline"]);
  assert.equal(refreshed, 1);
  assert.equal(sessions, 0);
  api.dispose();
});
