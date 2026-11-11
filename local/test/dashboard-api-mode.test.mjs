import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

for (const mode of ["development", "production"]) {
  test(`dashboard fixture query uses ${mode === "development" ? "fixtures in development" : "HTTP in production"}`, async t => {
    // Given the same explicit fixture query in each build mode.
    const previousLocation = globalThis.location;
    const previousFetch = globalThis.fetch;
    t.after(() => {
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
      globalThis.fetch = previousFetch;
    });
    globalThis.location = new URL("http://localhost/?fixtures=1");
    const requests = [];
    globalThis.fetch = async path => {
      requests.push(path);
      return Response.json({ ok: true, version: "real-http-response" });
    };
    const result = await build({
      entryPoints: [new URL("../dashboard/api.ts", import.meta.url).pathname],
      bundle: true, write: false, platform: "browser", format: "esm",
      define: { "process.env.NODE_ENV": JSON.stringify(mode) }, logLevel: "silent",
    });
    const { api } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
    // When the actual API adapter reads health.
    const health = await api.health();
    // Then only development selects synthetic data; production uses HTTP.
    assert.equal(api.mode, mode === "development" ? "fixtures" : "http");
    assert.equal(health.version, mode === "development" ? "fixtures" : "real-http-response");
    assert.deepEqual(requests, mode === "development" ? [] : ["/healthz"]);
  });
}
