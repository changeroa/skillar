import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PACKAGE_ROOT } from "./_helpers.mjs";
import { installDom, descendants } from "./helpers/dashboard-dom.mjs";

const bundle = await build({ stdin: { contents: 'export * from "./dashboard/components/requests"; export {TopPathsTable, targetFilter} from "./dashboard/views/flow"; export {h,render} from "preact";',
  resolveDir: fileURLToPath(PACKAGE_ROOT), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", jsxImportSource: "preact", logLevel: "silent" });
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const newRoot = installDom();

test("session request counts show success and failure together, zero attempts separately from missing data", () => {
  const root = newRoot();
  const summary = { total: 2, counts: { in_progress: 0, succeeded: 1, failed: 1, cancelled: 0, unknown: 0 }, results: { candidates_found: 0, no_candidates: 0 }, reasons: {} };
  ui.render(ui.h(ui.OperationCounts, { summary }), root);
  assert.match(root.textContent, /succeeded\s*1/);
  assert.match(root.textContent, /failed\s*1/);
  assert.doesNotMatch(root.textContent, /Aborted|Loaded|not_attempted/);
  ui.render(ui.h(ui.OperationCounts, { summary: { ...summary, total: 0 } }), root);
  assert.equal(root.textContent, "not_attempted");
  ui.render(ui.h(ui.OperationCounts, {}), root);
  assert.equal(root.textContent, "unknown");
  ui.render(null, root);
});

test("the rendered flow table uses requests for percentages and links to the correct operation filter", () => {
  const root = newRoot();
  const dto = { unit: "search_requests", sessionCount: 3, requestCount: 2, columns: ["task_type", "skill", "state"],
    nodes: [{ id: "t:review", column: 0, label: "review", count: 2 }, { id: "s:(none)", column: 1, label: "(no skill)", count: 2 },
      { id: "a:succeeded", column: 2, label: "succeeded", count: 1 }, { id: "a:failed", column: 2, label: "failed", count: 1 }],
    links: [{ source: "t:review", target: "s:(none)", state: "succeeded", count: 1 }, { source: "t:review", target: "s:(none)", state: "failed", count: 1 }] };
  ui.render(ui.h(ui.TopPathsTable, { dto, route: { view: "flow", filter: {} }, navigate() {}, resolve: () => undefined }), root);
  const shares = descendants(root).filter((n) => n.attrs.class === "paths__share");
  assert.deepEqual(shares.map((n) => n.textContent), ["50%", "50%"]);
  const hrefs = descendants(root).filter((n) => n.localName === "a").map((n) => n.attrs.href);
  assert.ok(hrefs.some((href) => href.includes("searchStatus=failed")));
  assert.ok(hrefs.every((href) => !href.includes("loadStatus") && !href.includes("?state=")));
  assert.deepEqual(ui.targetFilter({ kind: "node", node: dto.nodes[3] }, dto.nodes, () => undefined, "load_requests"), { loadStatus: ["failed"] });
  ui.render(null, root);
});
