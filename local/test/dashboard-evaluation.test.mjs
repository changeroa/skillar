import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { test } from "node:test";
import { PACKAGE_ROOT } from "./_helpers.mjs";
import { descendants, installDom } from "./helpers/dashboard-dom.mjs";

async function loadView() {
  const result = await build({
    stdin: { contents: `export { h, render } from "preact"; export { act } from "preact/test-utils";
      export { api } from "./dashboard/api"; export * from "./dashboard/views/evaluation";`,
      resolveDir: fileURLToPath(PACKAGE_ROOT), sourcefile: "evaluation-view-test.tsx", loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const view = await loadView();
const makeRoot = installDom();
const find = (root, key, value) => descendants(root).find((node) => node.attrs?.[key] === value);
function dispatch(node, event) {
  const type = Object.keys(node.listeners).find((name) => name.toLowerCase() === event);
  assert.ok(type);
  node.listeners[type].call(node, { type, currentTarget: node });
}
const savedCase = { id: "case-1", query: "rank this query", label: "skill", expectedUri: "skill://local/agents/alpha/SKILL.md", createdAt: 1 };
const summary = { cases: [savedCase], currentCatalogFingerprint: "catalog" };

test("evaluation label selector preserves the three distinct judgement values", () => {
  assert.deepEqual(view.labelUpdate("unlabeled"), { label: "unlabeled" });
  assert.deepEqual(view.labelUpdate("no_match"), { label: "no_match" });
  assert.deepEqual(view.labelUpdate("skill://local/agents/review/SKILL.md"), {
    label: "skill", expectedUri: "skill://local/agents/review/SKILL.md",
  });
});

test("a late refresh cannot overwrite a completed evaluation", async () => {
  const root = makeRoot();
  const original = { evaluation: view.api.evaluation, skills: view.api.skills, run: view.api.runEvaluation };
  const initial = Promise.withResolvers(), stale = Promise.withResolvers(), run = Promise.withResolvers();
  let loads = 0;
  view.api.evaluation = () => (++loads === 1 ? initial.promise : stale.promise);
  view.api.skills = async () => [{ uri: savedCase.expectedUri, name: "alpha" }];
  const runs = [];
  view.api.runEvaluation = (opts) => { runs.push(opts); return run.promise; };
  try {
    view.act(() => view.render(view.h(view.EvaluationView, {}), root));
    await view.act(async () => { initial.resolve(summary); await initial.promise; });
    view.act(() => dispatch(find(root, "data-evaluation-action", "refresh"), "click"));
    assert.equal(loads, 2);
    view.act(() => dispatch(find(root, "data-evaluation-action", "baseline"), "click"));
    assert.deepEqual(runs, [{ baseline: true }]);
    await view.act(async () => { run.resolve({ ...summary, currentCatalogFingerprint: "new-catalog" }); await run.promise; });
    await view.act(async () => { stale.resolve({ cases: [], currentCatalogFingerprint: "old-catalog" }); await stale.promise; });
    assert.ok(find(root, "data-eval-case", savedCase.id));
  } finally {
    view.act(() => view.render(null, root));
    view.api.evaluation = original.evaluation;
    view.api.skills = original.skills;
    view.api.runEvaluation = original.run;
  }
});

test("label changes disable evaluations until the judgement is committed", async () => {
  const root = makeRoot();
  const original = { evaluation: view.api.evaluation, skills: view.api.skills, update: view.api.updateEvalCase };
  const initial = Promise.withResolvers(), update = Promise.withResolvers();
  view.api.evaluation = () => initial.promise;
  view.api.skills = async () => [{ uri: savedCase.expectedUri, name: "alpha" }];
  const changes = [];
  view.api.updateEvalCase = (id, value) => { changes.push([id, value]); return update.promise; };
  try {
    view.act(() => view.render(view.h(view.EvaluationView, {}), root));
    await view.act(async () => { initial.resolve(summary); await initial.promise; });
    const select = find(root, "data-eval-label", savedCase.id);
    select.value = "no_match";
    view.act(() => dispatch(select, "change"));
    assert.deepEqual(changes, [[savedCase.id, { label: "no_match" }]]);
    assert.notEqual(find(root, "data-evaluation-action", "baseline").attrs.disabled, undefined);
    assert.notEqual(find(root, "data-evaluation-action", "current").attrs.disabled, undefined);
    view.api.evaluation = async () => ({ ...summary, cases: [{ ...savedCase, label: "no_match", expectedUri: undefined }] });
    await view.act(async () => { update.resolve(); await update.promise; });
  } finally {
    view.act(() => view.render(null, root));
    view.api.evaluation = original.evaluation;
    view.api.skills = original.skills;
    view.api.updateEvalCase = original.update;
  }
});
