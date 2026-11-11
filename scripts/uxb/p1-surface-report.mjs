import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { relative } from "node:path";
const [out, gateFile] = process.argv.slice(2);
const matrix = JSON.parse(await readFile(`${out}/surface-matrix.json`, "utf8"));
const demo = JSON.parse(await readFile(`${out}/demo-context.json`, "utf8"));
const gate = JSON.parse(await readFile(`${out}/${gateFile}`, "utf8"));
assert.equal(gate.results.length, Object.values(gate.expected).reduce((sum, count) => sum + count, 0) * 8 * gate.interactions.length);
assert.equal(gate.errors.length, 0);
assert.ok(gate.results.every(row => row.status === "PASS"));
assert.equal(matrix.rows.length, matrix.specs.length * 8);
assert.ok(matrix.rows.every(row => row.status === "PASS"));
assert.equal(new Set(matrix.rows.map(row => [row.name, row.width, row.theme, row.version].join("/"))).size, matrix.rows.length);
assert.equal(demo.length, 12);
assert.ok(demo.every(row => row.status === "PASS" && row.metrics.footerHidden));
const mappings = {
  home: ["TimePeriodSelect", "default", "home"],
  skills: ["Textarea", "code", "prompt"],
  document: ["MarkdownViewer", "formatted", "trace"],
  "document-raw": ["CodeBlock", "default", "trace"],
  "document-editor": ["Textarea", "code", "prompt"],
  compare: ["DiffViewer", "changed", "prompt"],
  account: ["Avatar", "lg-circle-muted", "home"],
  "device-grant": ["CodeBlock", "default", "trace"],
  "skill-toast": ["Toast", "default", "home"],
  commands: ["Textarea", "code", "prompt"],
  "commands-eval": ["Textarea", "code", "prompt"],
  consent: ["Radio", "unchecked-enabled", "home"],
  "consent-backfill": ["DateRangeInput", "default", "home"],
};
const latestSource = Math.max(...await Promise.all([
  "controls/p1.css", "controls/choices.tsx", "controls/feedback.tsx", "viewers/viewers.css", "viewers/code-block.tsx",
  "viewers/diff-viewer.tsx", "viewers/markdown.tsx",
].map(async path => (await stat(`/Users/iyen/projects/skillar-uxb/local/dashboard/foundation/${path}`)).mtimeMs)));
for (const row of matrix.rows) {
  assert.ok(row.scrollEnds?.length > 0, `${row.name}: missing actual scroll-end proof`);
  assert.ok(row.scrollEnds.every(node => Math.abs(node.top - node.maximum) <= 1), `${row.name}: incomplete scroll`);
  for (const file of [row.file, row.end]) {
    const bytes = await readFile(file), metadata = await stat(file);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
    const scale = row.width === 390 ? 3 : 1;
    assert.equal(bytes.readUInt32BE(16), row.width * scale, file);
    assert.equal(bytes.readUInt32BE(20), (row.width === 390 ? 844 : 900) * scale, file);
    assert.ok(metadata.mtimeMs >= latestSource, `Stale capture: ${file}`);
  }
}
const rows = [];
for (const spec of matrix.specs) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  const before = matrix.rows.find(row => row.name === spec.name && row.width === width && row.theme === theme && row.version === "before");
  const after = matrix.rows.find(row => row.name === spec.name && row.width === width && row.theme === theme && row.version === "after");
  const mapping = mappings[spec.name] ?? (spec.surface && spec.view !== "trace"
    ? [spec.error || ["attributes", "tool-args"].includes(spec.view) ? "CodeBlock" : "TimePeriodSelect",
      spec.view === "attributes" ? "read-only" : "default",
      spec.error || ["attributes", "tool-args"].includes(spec.view) ? "trace" : "home"] : null);
  const context = demo.find(row => row.name.startsWith(mapping?.[2] ?? "home") && row.width === width && row.theme === theme);
  assert.ok(context, `${spec.name} ${width} ${theme}: missing Demo context`);
  const reference = mapping ? gate.results.find(row => row.surface === (spec.surface === "local" ? "local" : "site") &&
    row.width === width && row.theme === theme && row.component === mapping[0] && row.state === mapping[1] && row.interaction === "rest")?.reference : null;
  if (mapping) {
    assert.ok(reference, `${spec.name}: missing atomic reference`);
    assert.ok(after.metrics.components[mapping[0]] > 0 ||
      mapping[0] === "DateRangeInput" && after.metrics.components.DateRangeFields === 2,
    `${spec.name}: expected component was not visible`);
  }
  rows.push({ surface: spec.name, width, theme, demo: context.file, demoRoute: context.metrics.route,
    atomic: reference?.screenshot ?? null,
    atomicComparison: mapping ? `${out}/diffs/${spec.surface === "local" ? "local" : "site"}-${mapping[0]}-${mapping[1]}-${width}-${theme}-side.png` : null,
    atomicProvenance: reference?.url?.startsWith("https://jp.cloud.langfuse.com") ? "REAL-DEMO" : reference?.provenance ?? null,
    before: before.file, beforeEnd: before.end, after: after.file, afterEnd: after.end,
    components: after.metrics.components, contextOnly: mapping === null, status: "PASS" });
}
const text = [
  "# G2 — Demo | before | after",
  "",
  `Complete matrix: ${matrix.specs.length} surfaces × 2 viewports × 2 themes × before/after = ${matrix.rows.length} page captures, plus one scrolled-end capture each.`,
  "Viewports: 1440×900 and 390×844 (true mobile, DPR 3). All actual captures have checked PNG signatures, dimensions and freshness.",
  "",
  "The Demo column is actual read-only Langfuse context with its account footer hidden. Atomic references are separately labelled REAL-DEMO or ACTUAL-PINNED-MIT. They are not substituted for a Demo page.",
  "",
  "## Deviations",
  "",
  "- Langfuse observes its Demo project; Skillar shows deterministic QA skills, grants and activity. Data, titles, timestamps and domain objects differ. These are contextual comparisons, not whole-page pixel-parity claims.",
  "- Before is built from b8b1d62. After uses the current production build. Both receive the same fixture contract; only their loopback hostnames differ.",
  "- Native select/date popups, KST fields, 32/44px targets, visible focus, localized copy, line numbers and change signs are the documented adaptations in REFERENCE-NORMALIZATION.md.",
  "- Editor and command textareas keep their caller-selected rows and content. Raw documents, trace JSON and grant shell commands keep their own languages and values.",
  "- The Skills page exposes the real YAML publication textarea. Consent embeds DateRangeFields in its caller-owned fieldset; both actual datetime inputs are measured independently.",
  "- Account captures open the real navigation drawer on phones so the caller-mounted Avatar is visible. The ordinary closed account page remains covered by the unchanged runtime checks.",
  "- End captures scroll actual visible main-content containers, including nested inspector panels. Every container's final offset and maximum are recorded and asserted; a nonexistent CSS selector cannot silently produce a duplicate top frame.",
  "- Both baseline and product have blank trailing main-scroll space on command forms and some embedded routes, plus tall mobile version rows; actual end captures retain these existing layout issues. Primary captures show the real consumers. Backfill captures center both actual datetime fields and assert their viewport positions.",
  "- Every hosted embed capture mounts the actual LocalViews/App production module through the real source picker. Resource URLs are recorded in surface-matrix.json.",
  "- Grant creation uses only the local mock server. No file is downloaded, no real grant is issued, and no consent is saved. Toast captures use the real skill-ID copy action.",
  "- Technical-error details use existing deterministic 503 fixture scenarios. Every analysis first loads its real report, then exercises its actual refresh failure and expandable details.",
  "- Hosted LocalViews is eagerly bundled into the actual dashboard application. Its four real tabs, selected source, mounted panel and absence of the standalone palette are asserted; no detached /ui/local-dashboard resource is invented.",
  "- The embedded product has Sessions, Flow, Workspaces and Activity tabs. Its overview is the hosted Home surface; the standalone-only Dashboard tab is not fabricated inside the embed.",
  "- Versions, connections and trace previews are retained as additional regression contexts even when no newly introduced P1 instance is visible at rest.",
  "- Families with no standalone real-page consumer remain fully enumerated in G1; no product page was invented to demonstrate them.",
  "",
  "| Surface / viewport / theme | Langfuse Demo and labelled atomic reference | Before | After |",
  "| --- | --- | --- | --- |",
  ...rows.map(row => `| ${row.surface} / ${row.width} / ${row.theme} | [REAL-DEMO context](${row.demo})${row.atomic ? ` · [${row.atomicProvenance}](${row.atomic})` : " · context only"} | [view](${row.before}) · [end](${row.beforeEnd}) | [view](${row.after}) · [end](${row.afterEnd}) |`),
];
await writeFile(`${out}/G2-MATRIX.md`, `${text.join("\n")}\n`);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const image = (file, label) => `<a href="${escape(relative(out, file))}"><img loading="lazy" src="${escape(relative(out, file))}" alt="${escape(label)}"></a>`;
await writeFile(`${out}/surface-review.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex">
<title>PR-8 real surface comparison</title><style>body{margin:24px;font:14px/1.5 system-ui;color:#27272a;background:#fafafa}h1{font-size:24px}summary{padding:12px;cursor:pointer}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0;min-width:0}figcaption{font-weight:600}img{display:block;width:100%;height:auto}details{margin-block:12px;border:1px solid #d4d4d8;border-radius:8px}details>div,details>p{margin:12px}a{color:#174ea6;overflow-wrap:anywhere}@media(max-width:680px){body{margin:12px}.columns{grid-template-columns:minmax(0,1fr)}}</style>
<h1>Langfuse Demo | before | after</h1><p>${matrix.specs.length} real surfaces, ${rows.length} three-column comparisons. Each image is an actual capture; click for original resolution. Demo and Skillar use different labelled data. Before: b8b1d62; after: current production build. No production deployment or self-approval.</p>
${rows.map(row => `<details><summary>${escape(row.surface)} / ${row.width} / ${row.theme}</summary><div class="columns">
<figure><figcaption>REAL-DEMO context — different product/data</figcaption>${image(row.demo, "Genuine read-only Demo context")}</figure>
<figure><figcaption>Before — b8b1d62</figcaption>${image(row.before, "Real before application")}</figure>
<figure><figcaption>After — production build</figcaption>${image(row.after, "Real after application")}</figure></div>
<p>${row.atomicComparison ? `<a href="${escape(relative(out, row.atomicComparison))}">Atomic comparison: ${escape(row.atomicProvenance)}</a> · ` : "Regression context only · "}<a href="${escape(relative(out, row.beforeEnd))}">Before scrolled end</a> · <a href="${escape(relative(out, row.afterEnd))}">After scrolled end</a></p></details>`).join("")}</html>`);
await writeFile(`${out}/g2-complete.json`, JSON.stringify({ surfaces: matrix.specs.length, pageCaptures: matrix.rows.length,
  endCaptures: matrix.rows.length, demoCaptures: demo.length, review: `${out}/surface-review.html`, rows, status: "PASS" }, null, 2));
console.log(`P1_G2_MATRIX_PASS ${matrix.rows.length}/${matrix.rows.length}; ${rows.length} three-column rows; 12 Demo contexts`);
