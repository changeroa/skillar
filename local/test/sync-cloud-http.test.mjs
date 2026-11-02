import assert from "node:assert/strict";
import test from "node:test";
import { distImport } from "./_helpers.mjs";

const { CloudHttp, retryAt } = await distImport("sync/cloud-http.js");

test("HTTP transport pins origin and never follows redirects with bearer credentials", async () => {
  const calls = [];
  const http = new CloudHttp("https://skillar.sh", "fixture", async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 302, headers: { location: "https://foreign.example/" } });
  });
  await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), {
    code: "unsafe_redirect", state: "quarantined",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer fixture");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.credentials, "omit");
  await assert.rejects(http.request("//foreign.example/v1/steal"), { code: "invalid_remote_target" });
  assert.equal(calls.length, 1);
});

test("Retry-After and bounded jitter remain durable scheduling data, including HTML gateway errors", async t => {
  t.mock.method(Date, "now", () => 1000);
  t.mock.method(Math, "random", () => 0.5);
  assert.equal(retryAt("3", 0), 4125);
  assert.equal(retryAt(null, 20), 68_500);
  const http = new CloudHttp("https://skillar.sh", "fixture", async () =>
    new Response("<html>unavailable</html>", { status: 503, headers: { "retry-after": "3" } }));
  await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), {
    state: "retry", status: 503, retryAtMs: 4125,
  });
  const repeated = new CloudHttp("https://skillar.sh", "fixture", async () =>
    new Response(null, { status: 503 }), 30_000, 4);
  await assert.rejects(repeated.request("/v1/activity/batches", { body: "{}" }), {
    state: "retry", status: 503, retryAtMs: 19_000,
  });
});

test("authorization consent disabled and permanent schema failures cannot skip a pending batch", async () => {
  for (const [status, error, state] of [
    [401, "unauthorized", "auth-required"], [403, "range_not_allowed", "consent-required"],
    [404, "not_found", "disabled"], [409, "sequence_gap", "quarantined"],
    [400, "invalid_request", "quarantined"],
  ]) {
    const http = new CloudHttp("https://skillar.sh", "fixture", async () =>
      Response.json({ error }, { status }));
    await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), {
      state, status, code: error,
    });
  }
});

test("request and response bounds fail explicitly instead of truncating JSON", async () => {
  let calls = 0;
  const http = new CloudHttp("https://skillar.sh", null, async () => {
    calls++;
    return Response.json({ large: "x".repeat(100) });
  });
  await assert.rejects(http.request("/v1/x", { body: "x".repeat(256 * 1024 + 1) }),
    { code: "request_too_large" });
  assert.equal(calls, 0);
  await assert.rejects(http.request("/v1/x", { maxResponseBytes: 20 }), { code: "response_too_large" });
  assert.equal(calls, 1);
});
