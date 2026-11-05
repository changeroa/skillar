import assert from "node:assert/strict";
import test from "node:test";
import { act, all, loadViews, mount, waitFor } from "../../site/test/helpers/t10-dom.mjs";
import { assembleSession } from "../../shared/dist/activity-analysis.js";

const ui = await loadViews(`
  export { api, configureApi } from "./local/dashboard/api.ts";
  export { TraceView, createTimelineKeys, planTimeline } from "./local/dashboard/views/trace.tsx";
`);

test("grouping one legacy call preserves an ungrouped call at the same timestamp", async t => {
  const argsA = "A".repeat(200);
  const argsB = "B".repeat(200);
  // Trace DTOs without callId/toolUseId are an explicitly supported legacy path.
  const steps = [
    { ts: 0, kind: "prompt", summary: "request", detail: { kind: "prompt", text: "request" } },
    { ts: 50, kind: "native_skill", summary: "native", detail: { kind: "native_skill", name: "fixture", via: "hook" } },
    { ts: 100, kind: "tool_call", summary: "tool-A", detail: { kind: "tool_call", toolName: "tool-A", args: argsA } },
    { ts: 100, kind: "tool_call", summary: "tool-B", detail: { kind: "tool_call", toolName: "tool-B", args: argsB } },
  ];
  const common = { sessionId: "gate-session", source: "hook", turnKey: "known-turn",
    callId: null, toolUseId: null, spanId: null, traceId: null, skillUri: null, textLength: null };
  // The real assembler leaves a reported but unknown turn unassigned instead of relabeling it.
  const tree = assembleSession({
    id: "gate-session", runtime: "claude-code", startedAt: 0, endedAt: 200, spans: [],
    events: [
      { ...common, id: "prompt", ts: 0, kind: "prompt", text: "request", data: {} },
      { ...common, id: "activation", ts: 50, kind: "native_skill", text: null, data: { name: "fixture" } },
      { ...common, id: "event-A", ts: 100, kind: "tool_call", text: argsA, data: { toolName: "tool-A" } },
      { ...common, id: "event-B", ts: 100, kind: "tool_call", turnKey: "unknown-turn", text: argsB, data: { toolName: "tool-B" } },
    ],
  });
  assert.deepEqual(tree.turns[0].skillSpans[0].events.map(event => event.id), ["event-A"]);
  assert.deepEqual(tree.unassignedEvents.map(event => event.id), ["event-B"]);
  const report = {
    tree,
    finding: { turns: [] }, unattributedLoads: { count: 0, uris: [] },
  };
  let available = false;
  ui.configureApi({
    ...ui.api,
    trace: async () => structuredClone(steps),
    sessions: async () => [{ id: "gate-session", startedAt: 100 }],
    skillReport: async () => { if (!available) throw Error("report unavailable"); return report; },
  });
  const props = { route: { view: "trace", sessionId: "gate-session", filter: {} }, live: { state: "paused", seq: 0 }, navigate() {} };
  const { dom, container, show } = await mount(t, ui.TraceView, props);
  const findB = () => all(container, n => n.localName === "details" && n.textContent.includes(argsB))[0];
  await waitFor(dom, findB, "ungrouped tool-B");
  const original = findB();
  await act(() => { original.open = true; });
  available = true;
  await show({ ...props, live: { state: "paused", seq: 1 } });
  await waitFor(dom, () => all(container, n => n.getAttribute("data-kind") === "skill_span")[0], "tool-A grouped into a span");
  assert.ok(findB() === original, "the unchanged ungrouped call must retain its disclosure DOM");
  assert.equal(findB().open, true, "the unchanged ungrouped call must stay expanded");
});

test("untouched source keys survive seeded random grouping changes", () => {
  // Given: deliberately colliding legacy timestamps, plus recorded IDs.
  let seed = 0x53a219;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed >>> 0;
  };
  const steps = Array.from({ length: 40 }, (_, index) => ({
    ts: 100 + Math.floor(index / 10), kind: "tool_call", summary: `call-${index}`,
    detail: { kind: "tool_call", toolName: `tool-${index}`, args: `args-${index}`,
      ...(index % 4 === 0 ? { eventId: `recorded-${index}` } : {}) },
  }));
  const identify = ui.createTimelineKeys();
  const original = new Map(identify(steps).map(item => [item.step.summary, item.key]));
  const groupKeys = new Map();
  for (let round = 0; round < 200; round++) {
    const grouped = new Set();
    const spans = Array.from({ length: 3 }, (_, group) => ({
      id: `activation-${group}`, skill: `skill-${group}`, name: `skill-${group}`, uri: null,
      activation: { id: `activation-${group}` },
      startedAt: random() % 3, endedAt: 200, events: [],
    }));
    const available = random() % 4 !== 0;
    if (available) for (let ts = 100; ts < 104; ts++) {
      const bucket = steps.filter(step => step.ts === ts);
      // Any prefix can become owned, including none/all, while siblings remain unchanged.
      const count = random() % (bucket.length + 1);
      for (const step of bucket.slice(0, count)) {
        grouped.add(step.summary);
        spans[random() % spans.length].events.push({
          id: step.detail.eventId ?? step.summary, ts: step.ts, kind: step.kind,
          text: step.detail.args, data: { toolName: step.detail.toolName },
        });
      }
    }
    // When: grouping, display order, timestamp ties and report availability change.
    for (let index = spans.length - 1; index > 0; index--) {
      const other = random() % (index + 1);
      [spans[index], spans[other]] = [spans[other], spans[index]];
    }
    const report = available ? { tree: { turns: [{ id: "turn", skillSpans: spans }] }, finding: { turns: [] } } : undefined;
    const planned = ui.planTimeline(identify(structuredClone(steps)), report);
    // Then: every untouched event retains its own source key, not its display occurrence.
    const untouched = planned.filter(item => item.kind === "step");
    assert.deepEqual(untouched.map(item => item.step.summary).sort(),
      steps.filter(step => !grouped.has(step.summary)).map(step => step.summary).sort(), `round ${round}`);
    for (const item of untouched) assert.equal(item.key, original.get(item.step.summary), `round ${round}: ${item.step.summary}`);
    for (const item of planned.filter(item => item.kind === "span")) {
      assert.equal(item.key, `span:${item.span.activation.id}`);
      if (groupKeys.has(item.span.activation.id)) assert.equal(item.key, groupKeys.get(item.span.activation.id));
      groupKeys.set(item.span.activation.id, item.key);
    }
    assert.equal(new Set(planned.map(item => item.key)).size, planned.length, `unique keys in round ${round}`);
  }
});
