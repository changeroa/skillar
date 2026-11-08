import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { onRequest } from "../functions/assets/[[path]].ts";

const url = "https://skillar.sh/assets/dashboard-deadbeef.js";
const immutable = "public, max-age=31536000, immutable";
const html = () => new Response("<!doctype html><html>SPA fallback</html>", {
  headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"index"', "Cache-Control": "public, max-age=14400" },
});

test("Pages routes asset requests through the boundary and revalidates static HTML", async () => {
  const routes = JSON.parse(await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"));
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.ok(routes.include.includes("/assets/*"));
  assert.ok(!routes.exclude.includes("/assets/*") && !routes.exclude.includes("/*"));
  assert.match(headers, /^\/\*\r?\n\s+Cache-Control:\s*no-cache\s*$/m);
});

test("a missing hashed asset cannot cache the Pages HTML fallback", async () => {
  const response = await onRequest({ request: new Request(url), next: async () => html() });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("Content-Type"), /^text\/plain/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.doesNotMatch(await response.text(), /<!doctype|<html/i);
});

test("a missing asset with the fallback ETag is still 404, not a bodyless 304", async () => {
  const request = new Request(url, { headers: { "If-None-Match": '"index"' } });
  const response = await onRequest({ request, next: async (lookup = request) =>
    lookup.headers.has("If-None-Match") ? new Response(null, { status: 304, headers: { ETag: '"index"' } }) : html(),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(response.headers.get("Content-Type"), /html/i);
});

test("an explicit static 404 also becomes a non-HTML no-store response", async () => {
  const response = await onRequest({ request: new Request(url), next: async () =>
    new Response("<html>Not found</html>", { status: 404, headers: { "Content-Type": "text/html" } }),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(await response.text(), /<html/i);
});

test("existing hashed assets retain their bytes, MIME and ETag with immutable caching", async () => {
  const body = "export const answer = 42;\n";
  const response = await onRequest({ request: new Request(url), next: async () =>
    new Response(body, { headers: { "Content-Type": "text/javascript", ETag: '"asset"' } }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/javascript");
  assert.equal(response.headers.get("ETag"), '"asset"');
  assert.equal(response.headers.get("Cache-Control"), immutable);
  assert.equal(await response.text(), body);
});

test("real assets retain conditional GET and HEAD semantics, including weak ETag lists", async () => {
  for (const method of ["GET", "HEAD"]) {
    const request = new Request(url, { method, headers: { "If-None-Match": '"other", W/"asset"' } });
    const response = await onRequest({ request, next: async () =>
      new Response("export {};", { headers: { "Content-Type": "text/javascript", ETag: '"asset"' } }),
    });
    assert.equal(response.status, 304);
    assert.equal(response.headers.get("ETag"), '"asset"');
    assert.equal(response.headers.get("Cache-Control"), immutable);
    assert.equal(await response.text(), "");
  }
});

test("upstream errors are not reclassified or cached as immutable assets", async () => {
  const response = await onRequest({ request: new Request(url), next: async () => new Response("upstream", { status: 503 }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "upstream");
});
