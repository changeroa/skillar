import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
const [root, evidence, head] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw Error("Repository, evidence and exact head required");
const stage = `/tmp/uxb/pr8-preview-${head}`;
await cp(`${root}/site/dist`, stage, { recursive: true });
const qa = `${stage}/__qa/pr8`;
await mkdir(qa, { recursive: true });
const report = JSON.parse(await readFile(`${evidence}/p1-final.json`, "utf8"));
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sections = [];
for (const folder of ["diffs", "surfaces", "demo-context"]) {
  await mkdir(`${qa}/${folder}`, { recursive: true });
  for (const name of await readdir(`${evidence}/${folder}`)) {
    if (!name.endsWith(".png")) continue;
    await cp(`${evidence}/${folder}/${name}`, `${qa}/${folder}/${name}`);
  }
}
await cp(`${evidence}/surface-review.html`, `${qa}/surface-review.html`);
for (const row of report.results) {
  const name = `${row.surface}-${row.component}-${row.state}-${row.width}-${row.theme}`;
  sections.push(`<details><summary>${escape(name)}: ${row.status} (${row.reference.provenance})</summary><p>${escape(JSON.stringify(row.differences))}</p><a href="diffs/${name}-side.png"><img loading="lazy" src="diffs/${name}-side.png" alt="Reference and product: ${escape(name)}"></a><a href="diffs/${name}-raw.png">Raw pixel diff, no scaling</a></details>`);
}
const surfaces = JSON.parse(await readFile(`${evidence}/g2-complete.json`, "utf8"));
await writeFile(`${qa}/index.html`, `<!doctype html><html lang="en" data-head="${head}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>PR-8 comparison evidence</title><style>body{font:14px/1.5 system-ui;margin:24px;color:#18181b;background:#fafafa}img{display:block;max-width:100%;height:auto}summary{padding:8px;cursor:pointer}p{overflow-wrap:anywhere}section{margin-block:32px}</style><h1>PR-8 comparison evidence</h1><p>Head ${head}. This preview-only directory is staged outside the clean production build. FAIL rows remain FAIL; captures alone are not approval. Actual pinned-MIT references are labelled and are not Demo screenshots.</p><h2>Real before/after screens</h2><p><a href="surface-review.html">${surfaces.surfaces} real surfaces, ${surfaces.pageCaptures} page captures and ${surfaces.rows.length} labelled Demo | before | after comparisons</a></p><h2>Component state comparisons — ${report.results.length} cases</h2>${sections.join("")}</html>`);
console.log(`P1_PREVIEW_STAGE ${stage}`);
