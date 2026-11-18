import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PACKAGE_ROOT } from "./_helpers.mjs";
import { installDom, descendants } from "./helpers/dashboard-dom.mjs";

const bundle = await build({ stdin: { contents: 'export * from "./dashboard/components/requests"; export {createElement as h} from "react"; export {render} from "./dashboard/react-mount";',
  resolveDir: fileURLToPath(PACKAGE_ROOT), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", jsxImportSource: "react", logLevel: "silent" });
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const newRoot = installDom();

test("session request counts show success and failure together, zero attempts separately from missing data", () => {
  const root = newRoot();
  const summary = { total: 2, counts: { in_progress: 0, succeeded: 1, failed: 1, cancelled: 0, unknown: 0 }, results: { candidates_found: 0, no_candidates: 0 }, reasons: {} };
  ui.render(ui.h(ui.OperationCounts, { summary }), root);
  assert.match(root.textContent, /성공\s*1/);
  assert.match(root.textContent, /실패\s*1/);
  assert.doesNotMatch(root.textContent, /중단됨|읽음|요청 없음/);
  ui.render(ui.h(ui.OperationCounts, { summary: { ...summary, total: 0 } }), root);
  assert.equal(root.textContent, "요청 없음");
  ui.render(ui.h(ui.OperationCounts, {}), root);
  assert.equal(root.textContent, "알 수 없음");
  ui.render(null, root);
});

