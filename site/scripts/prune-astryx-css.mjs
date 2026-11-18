// Post-build: prune the Astryx StyleX rules out of the emitted dashboard CSS,
// keeping only the atomic classes the emitted site JS references. Shares the
// pruner with the local dashboard build (local/dashboard/design/astryx-vendor).
// Runs via `npm run postbuild`; fails the build if a referenced class is lost.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pruneAstryxCss } from "../../local/dashboard/design/astryx-vendor/prune.mjs";

const dist = new URL("../dist/", import.meta.url);
const assets = new URL("../dist/assets/", import.meta.url);
const names = await readdir(assets);

async function collectHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) out.push(...await collectHtml(child));
    else if (entry.name.endsWith(".html")) out.push(fileURLToPath(child));
  }
  return out;
}
const htmlPaths = await collectHtml(dist);
const jsPaths = names.filter(name => name.endsWith(".js")).map(name => fileURLToPath(new URL(name, assets)));
if (!jsPaths.length) throw new Error("prune-astryx-css(site): no JS assets found - run vite build first");

let corpus = "";
for (const path of jsPaths) corpus += await readFile(path, "utf8");

for (const name of names.filter(name => name.endsWith(".css"))) {
  const path = fileURLToPath(new URL(name, assets));
  const css = await readFile(path, "utf8");
  // StyleX payload marker: hashed atomic classes or the astryx layer names.
  if (!/\.x[0-9a-z]{5,8}\{/.test(css) && !css.includes("astryx-base")) continue;
  const stats = await pruneAstryxCss(path, jsPaths, path, htmlPaths);
  console.log(`pruned ${name}: ${stats.rawBefore} -> ${stats.rawAfter} bytes (${stats.kept} kept, ${stats.dropped} dropped, ${stats.rescued ?? 0} var rescues, corpus ${(corpus.length / 1024).toFixed(0)} KB JS)`);
}
