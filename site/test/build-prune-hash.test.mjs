import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The dashboard CSS is served from an immutable, content-hashed /assets/ URL.
// Pruning must change the hash: an immutable URL whose bytes change between
// deploys keeps serving the stale (superset) CSS from browser and edge caches.
// This test builds once with the full stylesheet and once through the two-pass
// pruned build, and requires different filenames plus a smaller pruned output.

const assets = new URL("../dist/assets/", import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "pipe" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}`);
}

// The prunable stylesheet follows the entry that embeds the local dashboard
// views (원문82: /skills/?tab=evidence), so pick the largest CSS asset.
async function dashboardCss() {
  const names = (await readdir(assets)).filter(name => name.endsWith(".css"));
  assert.ok(names.length > 0, "at least one CSS asset");
  let best = null;
  for (const name of names) {
    const path = fileURLToPath(new URL(name, assets));
    const info = { name, size: (await stat(path)).size, text: await readFile(path, "utf8") };
    if (best === null || info.size > best.size) best = info;
  }
  return best;
}

test("pruned build emits the dashboard CSS under a different content hash", async t => {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npx, ["vite", "build"]); // full stylesheet, unpruned
  const unpruned = await dashboardCss();

  run(process.execPath, ["scripts/build-with-prune.mjs"]); // two-pass pruned build
  const pruned = await dashboardCss();

  assert.notEqual(pruned.name, unpruned.name,
    `immutable filename must change when bytes change (${unpruned.name})`);
  assert.ok(pruned.size < unpruned.size * 0.7,
    `pruned output should be much smaller (${unpruned.size} -> ${pruned.size})`);
  assert.ok(pruned.text.includes(":root"), "theme carrier rules preserved");
  assert.ok(pruned.text.includes("--color-accent"), "accent tokens preserved");
});
