// Two-pass dashboard build so Vite's content hash covers the pruned CSS.
//
// Pass 1 bundles the full Astryx stylesheet; the emitted JS/HTML is the corpus
// the pruner scans for referenced StyleX classes. Pass 2 swaps the dashboard's
// astryx-source.css wrapper for the pruned stylesheet and rebuilds, so the
// hashed /assets/ URL matches the bytes actually served (immutable cache URLs
// stay honest). The wrapper is restored afterwards, whatever happens.
//
// A final guard re-scans the pass-2 output: every atomic class the built JS
// references that exists in the full stylesheet must survive in the emitted
// CSS, or the build fails.

import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pruneAstryxCss } from "../../local/dashboard/design/astryx-vendor/prune.mjs";

const wrapper = fileURLToPath(new URL("../src/dashboard/astryx-source.css", import.meta.url));
const dist = new URL("../dist/", import.meta.url);
const assets = new URL("../dist/assets/", import.meta.url);
const fullCss = fileURLToPath(import.meta.resolve("@astryxdesign/core/astryx.css"));
const FULL_IMPORT = '@import "@astryxdesign/core/astryx.css";\n';

function viteBuild() {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const run = spawnSync(npx, ["vite", "build"], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`vite build failed (exit ${run.status})`);
}

async function collectHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) out.push(...await collectHtml(child));
    else if (entry.name.endsWith(".html")) out.push(fileURLToPath(child));
  }
  return out;
}

async function corpusPaths() {
  const names = await readdir(assets);
  const jsPaths = names.filter(name => name.endsWith(".js")).map(name => fileURLToPath(new URL(name, assets)));
  if (!jsPaths.length) throw new Error("build-with-prune: no JS assets found - vite build emitted nothing");
  return [...jsPaths, ...await collectHtml(dist)];
}

const original = await readFile(wrapper, "utf8");
try {
  // Pass 1: full stylesheet, purely to harvest the reference corpus.
  await writeFile(wrapper, FULL_IMPORT);
  viteBuild();
  const corpus = await corpusPaths();

  // Prune into the wrapper; pass 2 hashes the pruned bytes.
  const stats = await pruneAstryxCss(fullCss, corpus, wrapper);
  console.log(`pruned astryx source: ${stats.rawBefore} -> ${stats.rawAfter} bytes (${stats.kept} kept, ${stats.dropped} dropped, ${stats.rescued ?? 0} var rescues)`);
  viteBuild();

  // Guard: no atomic class referenced by the final JS may lose its last rule.
  const full = await readFile(fullCss, "utf8");
  let finalJs = "";
  for (const path of await corpusPaths()) finalJs += await readFile(path, "utf8");
  let finalCss = "";
  for (const name of await readdir(assets)) if (name.endsWith(".css")) finalCss += await readFile(fileURLToPath(new URL(name, assets)), "utf8");
  const missing = [...new Set([...finalJs.matchAll(/x[0-9a-z]{5,8}/g)].map(match => match[0]))]
    .filter(name => new RegExp(`\\.${name}\\b`).test(full) && !new RegExp(`\\.${name}\\b`).test(finalCss));
  if (missing.length) throw new Error(`build-with-prune: final CSS lost referenced classes: ${missing.slice(0, 5).join(", ")}`);
  console.log("two-pass prune verified: all referenced atomic classes present in hashed output");
} finally {
  await writeFile(wrapper, original);
}
