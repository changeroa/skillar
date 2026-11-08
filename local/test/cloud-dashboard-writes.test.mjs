import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../dashboard/cloud.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
const { createCloudApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const profile = { deviceId: "fixture-device", sourceDomain: "fixture-source" };

test("health uses the real snapshot GET route and eval writes use a cloud receipt", async () => {
  // Given
  const requests = [];
  const api = createCloudApi(profile, {
    onUnauthorized() {},
    fetch: async (path, init) => {
      requests.push({ path, init });
      return Response.json(path.endsWith("/status")
        ? { ok: true, version: "cloud", transport: "snapshot" }
        : { caseId: "cloud-case", state: "stored", retainedUntilMs: 1000 });
    },
  });
  // When
  const health = await api.health();
  await api.addEvalCase({ query: "fixture", expectedUri: "skill://fixture", fromTraceId: "trace" });
  // Then
  assert.deepEqual(health, { ok: true, version: "cloud", transport: "snapshot" });
  assert.equal(requests[0].path, "/api/dashboard/status");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.body, undefined);
  const write = requests[1];
  assert.equal(write.path, "/api/dashboard/eval-cases");
  const body = JSON.parse(write.init.body);
  assert.deepEqual(body.profile, profile);
  assert.deepEqual(body.input, { query: "fixture", expectedUri: "skill://fixture", fromTraceId: "trace" });
  assert.match(body.requestId, /^[a-f0-9-]{36}$/);
  api.dispose();
});

test("non-401 errors use cloud context and never expose raw server content", async () => {
  // Given
  const api = createCloudApi(profile, {
    onUnauthorized: () => assert.fail("not an authentication failure"),
    fetch: async () => Response.json({ error: "private fixture text" }, { status: 403 }),
  });
  // When / Then
  await assert.rejects(api.stats(), (error) => {
    assert.equal(error.code, "cloud_http_403");
    assert.equal(error.status, 403);
    assert.ok(!error.message.includes("private fixture text"));
    assert.ok(!error.message.includes("skillar open"));
    return true;
  });
  api.dispose();
});

test("pre-aborted profile lifetime never starts fetch or event subscriptions", async () => {
  // Given
  const controller = new AbortController();
  controller.abort();
  let invalidated = 0;
  const api = createCloudApi(profile, {
    signal: controller.signal, onUnauthorized() {},
    fetch: async () => assert.fail("must not fetch"),
  });
  // When
  api.events({ onInvalidate: () => invalidated++ });
  // Then
  await assert.rejects(api.health(), { name: "AbortError" });
  assert.equal(invalidated, 1);
  api.dispose();
});
