import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import test from "node:test";
import { PACKAGE_ROOT } from "./_helpers.mjs";
import { descendants, installDom } from "./helpers/dashboard-dom.mjs";

const built = await build({
  stdin: { contents: `export { h, render } from "preact"; export { act } from "preact/test-utils";
    export { api } from "./dashboard/api"; export * from "./dashboard/components/capture-health";`,
  resolveDir: fileURLToPath(PACKAGE_ROOT), sourcefile: "capture-health-test.tsx", loader: "tsx" },
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
  jsx: "automatic", jsxImportSource: "preact", logLevel: "silent",
});
const view = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const makeRoot = installDom();
const health = { generatedAt: 1, scope: "all_history", runtimes: [{
  runtime: "codex", lastEventAt: null, sources: { hook: 0, otel: 0, mcp: 0 }, mcpAttributionRate: null,
  unattributedReasons: { no_session: 2, ambiguous: 1, stale: 0, unreported: 0 }, lastProbe: null,
}] };
const report = { id: "probe", runtime: "codex", scope: "daemon_ingest", startedAt: 1, completedAt: 2, ok: true,
  checks: ["transport", "authentication", "storage", "attribution"].map((stage) => ({ stage, status: "passed" })) };
const find = (root, key, value) => descendants(root).find((node) => node.attrs?.[key] === value);
function click(node) {
  const type = Object.keys(node.listeners).find((name) => name.toLowerCase() === "click");
  assert.ok(type, "the component registered a click handler");
  node.listeners[type].call(node, { type, currentTarget: node });
}

test("capture health renders the server's reason counts and all verified stages after an actual component action", async () => {
  const root = makeRoot();
  const original = { health: view.api.captureHealth, test: view.api.testCapture };
  const initialHealth = Promise.withResolvers();
  const completion = Promise.withResolvers();
  const calls = [];
  view.api.captureHealth = () => initialHealth.promise;
  view.api.testCapture = (runtime) => { calls.push(runtime); return completion.promise; };
  try {
    view.act(() => { view.render(view.h(view.CaptureHealthPanel, { revision: 0 }), root); });
    await view.act(async () => { initialHealth.resolve(health); await initialHealth.promise; });
    const button = find(root, "data-test-capture", "codex");
    assert.ok(button);
    assert.deepEqual(view.captureReasonCounts(health.runtimes[0]), [
      { reason: "no_session", count: 2 }, { reason: "ambiguous", count: 1 },
    ]);
    await view.act(async () => { click(button); });
    assert.deepEqual(calls, ["codex"]);
    assert.equal(find(root, "data-capture-result", "passed"), undefined);
    await view.act(async () => { completion.resolve(report); await completion.promise; });
    assert.ok(find(root, "data-capture-result", "passed"));
    assert.equal(descendants(root).filter((node) => node.attrs?.["data-capture-stage"] && node.attrs?.["data-status"] === "passed").length, 4);
  } finally {
    view.act(() => view.render(null, root));
    view.api.captureHealth = original.health;
    view.api.testCapture = original.test;
  }
});

test("a capture request failure remains visible after a successful background health refresh", async () => {
  const root = makeRoot();
  const original = { health: view.api.captureHealth, test: view.api.testCapture };
  const initialHealth = Promise.withResolvers();
  view.api.captureHealth = () => initialHealth.promise;
  view.api.testCapture = async () => { throw new Error("capture_unavailable"); };
  try {
    view.act(() => { view.render(view.h(view.CaptureHealthPanel, { revision: 0 }), root); });
    await view.act(async () => { initialHealth.resolve(health); await initialHealth.promise; });
    await view.act(async () => {
      const button = find(root, "data-test-capture", "codex");
      click(button);
    });
    assert.ok(find(root, "role", "alert"));
    assert.equal(find(root, "data-capture-result", "passed"), undefined);
  } finally {
    view.act(() => view.render(null, root));
    view.api.captureHealth = original.health;
    view.api.testCapture = original.test;
  }
});
