import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PACKAGE_ROOT } from "./_helpers.mjs";

for (const environment of ["production", "development"]) {
  test(`dashboard ${environment} bundle gates fixture data at build time`, async () => {
    // Given the actual API entry and its build-time environment.
    const result = await build({
      entryPoints: [fileURLToPath(new URL("dashboard/api.ts", PACKAGE_ROOT))],
      bundle: true, write: false, metafile: true, format: "esm", splitting: true, outdir: "out",
      platform: "browser", target: "es2022", minify: true,
      define: { "process.env.NODE_ENV": JSON.stringify(environment) },
      logLevel: "silent",
    });
    // When inspecting the modules that contribute bytes to emitted code.
    const fixtures = Object.values(result.metafile.outputs).flatMap(output =>
      Object.entries(output.inputs).filter(([path, input]) =>
        /dev-fixtures(?:-usage)?\.json$/.test(path) && input.bytesInOutput > 0));
    // Then production excludes both datasets, while development exercises them.
    assert.equal(fixtures.length, environment === "production" ? 0 : 2);
  });
}
