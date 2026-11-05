import assert from "node:assert/strict";
import test from "node:test";
import { loadViews } from "../../site/test/helpers/t10-dom.mjs";

const ui = await loadViews(`
  export { parseHash, buildHash, serializeFilter } from "./local/dashboard/state.ts";
  export { destination } from "./local/dashboard/components/command-jump.tsx";
`);

test("local view preferences round-trip without leaking into API filters", () => {
  const route = {
    view: "sessions", filter: { runtime: ["codex"], q: "request & skill", from: 100, automated: "include" },
    sort: "-reads", columns: ["started", "runtime", "reads", "id"], density: "compact",
    peek: "session/with space", event: "source:event/1", traceTab: "timeline", format: "raw", attributes: true,
  };
  assert.deepEqual(ui.parseHash(ui.buildHash(route)), route);
  assert.equal(ui.serializeFilter(route.filter), "from=100&runtime=codex&q=request%20%26%20skill&automated=include");
  assert.ok(!ui.serializeFilter(route.filter).includes("peek"));
});

test("unrecognised view preference values do not become active controls", () => {
  assert.deepEqual(ui.parseHash("#/sessions?sort=bad&density=bad&tab=graph&format=bad&runtime=codex"), {
    view: "sessions", filter: { runtime: ["codex"] },
  });
});

test("navigation-only command destinations retain the list scope and clear entity selection", () => {
  const route = {
    view: "trace", sessionId: "session", filter: { q: "migration", state: ["loaded"] },
    sort: "started", columns: ["started", "reads"], density: "comfortable", peek: "session", event: "load-id",
  };
  const next = ui.destination(route, "dashboard");
  const parsed = ui.parseHash(ui.buildHash(next));
  assert.equal(parsed.view, "dashboard");
  assert.deepEqual(parsed.filter, route.filter);
  assert.deepEqual(parsed.columns, route.columns);
  assert.equal(parsed.sort, route.sort);
  assert.equal(parsed.density, route.density);
  assert.equal(parsed.event, undefined);
  assert.equal(parsed.peek, undefined);
  assert.equal(parsed.sessionId, undefined);
});
