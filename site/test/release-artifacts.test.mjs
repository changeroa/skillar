import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";

test("production build excludes development fixtures and evidence entries", async t => {
  // Given an isolated output directory and the real production configuration.
  const outDir = await mkdtemp(join(tmpdir(), "skillar-release-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  // When the application is bundled for release.
  await build({ root: new URL("../", import.meta.url).pathname, logLevel: "error", build: { outDir } });
  // Then neither development entries nor synthetic payloads ship.
  const files = (await readdir(outDir, { recursive: true })).sort();
  assert.ok(files.includes("dashboard/index.html"));
  assert.ok(files.includes("skills/index.html"));
  assert.deepEqual(files.filter(file => /dev-fixtures|__gallery|__qa/.test(file)), []);
  const assets = files.filter(file => file.endsWith(".js"));
  assert.ok(assets.length > 0);
  for (const asset of assets) {
    const source = await readFile(join(outDir, asset), "utf8");
    assert.doesNotMatch(source, /dev-fixtures|__gallery|__qa|deterministic fixtures generated|sessions12/);
  }
});
