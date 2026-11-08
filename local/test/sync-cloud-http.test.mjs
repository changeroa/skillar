import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { distImport } from "./_helpers.mjs";

const { CloudHttp, retryAt } = await distImport("sync/cloud-http.js");

test("native connection loss after successful headers schedules a body-phase retry", { timeout: 10000 }, async t => {
  let pending;
  const server = createServer((_request, response) => {
    pending = response;
    response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
    response.write('{"accepted":');
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const ready = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await ready;
  let headersSeen = false;
  const http = new CloudHttp("https://skillar.sh", "fixture", async (_url, init) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, init);
    assert.equal(response.status, 200);
    headersSeen = true;
    pending.destroy();
    return response;
  });
  await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), {
    state: "retry", code: "network_unavailable", status: 200,
  });
  assert.equal(headersSeen, true);
});

test("aborted body reads retry while invalid JSON and UTF-8 stay quarantined", async () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    const http = new CloudHttp("https://skillar.sh", "fixture", async () =>
      new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
        pull(controller) { controller.error(new DOMException("body interrupted", name)); },
      })));
    await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), {
      state: "retry", code: "network_unavailable", status: 200,
    });
  }
  for (const body of ["{bad JSON", Uint8Array.of(0xff)]) {
    const malformed = new CloudHttp("https://skillar.sh", "fixture", async () => new Response(body));
    await assert.rejects(malformed.request("/v1/activity/batches", { body: "{}" }), {
      state: "quarantined", code: "invalid_response",
    });
  }
});

test("network failure while discarding a body preserves its known HTTP or size failure", async () => {
  for (const [status, state, code] of [
    [302, "quarantined", "unsafe_redirect"], [503, "retry", "remote_unavailable"],
  ]) {
    const http = new CloudHttp("https://skillar.sh", "fixture", async () =>
      new Response(new ReadableStream({
        start(controller) { controller.error(new TypeError("terminated")); },
      }), { status }));
    await assert.rejects(http.request("/v1/activity/batches", { body: "{}" }), { state, code, status });
  }
  const oversized = new CloudHttp("https://skillar.sh", "fixture", async () =>
    new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(100)); },
      cancel() { throw new TypeError("terminated"); },
    })));
  await assert.rejects(oversized.request("/v1/activity/batches", { body: "{}", maxResponseBytes: 20 }), {
    state: "quarantined", code: "response_too_large",
  });
});

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
