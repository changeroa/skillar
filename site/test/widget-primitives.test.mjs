import assert from "node:assert/strict";
import test from "node:test";
import { act, all, byTag, FakeEvent, h, mount, loadViews } from "./helpers/t10-dom.mjs";
const { Card, Widget, Metric, BarChart, LineChart, Histogram, Alert, StatusMessage, Callout } =
  await loadViews('export * from "./local/dashboard/foundation/widgets/index.ts";');

test("metrics show missing state when a measurement becomes absent", async t => {
  // Given
  const api = await mount(t, Metric, { label: "Requests", value: 0 });
  // When
  await api.show({ label: "Requests", value: null });
  // Then
  assert.equal(byTag(api.container, "strong")[0].getAttribute("data-measured"), "false");
  assert.notEqual(byTag(api.container, "strong")[0].textContent, "0");
});

test("metrics retain measured zero when the recorded value is zero", async t => {
  // Given
  const props = { label: "Requests", value: 0 };
  // When
  const { container } = await mount(t, Metric, props);
  // Then
  assert.equal(byTag(container, "strong")[0].textContent, "0");
  assert.equal(byTag(container, "strong")[0].getAttribute("data-measured"), "true");
});

test("widget failure preserves a real recovery action rather than rendering stale children", async t => {
  // Given
  let retried = false;
  const api = await mount(t, Widget, {
    title: "Requests", state: { kind: "error", message: "Connection failed",
      action: h("button", { onClick: () => { retried = true; } }, "Retry") }, children: "old result",
  });
  // When
  await act(() => byTag(api.container, "button")[0].click());
  // Then
  assert.equal(retried, true);
  assert.equal(api.container.textContent.includes("old result"), false);
  assert.equal(all(api.container, node => node.getAttribute("role") === "alert").length, 1);
});

test("chart fallback contains every bucket including missing and measured zero", async t => {
  // Given
  const data = { labels: ["a", "b", "c"], series: [{ label: "Requests", values: [0, null, 7] }] };
  // When
  const { container } = await mount(t, BarChart, { title: "Requests", data });
  // Then
  assert.equal(byTag(container, "tbody")[0].children.length, 3);
  assert.equal(byTag(container, "td")[0].textContent, "0");
  assert.notEqual(byTag(container, "td")[1].textContent, "0");
  assert.equal(byTag(container, "td")[2].textContent, "7");
});

test("keyboard focus exposes point data with an associated tooltip", async t => {
  // Given
  const { container } = await mount(t, BarChart, { title: "Requests",
    data: { labels: ["a"], series: [{ label: "Requests", values: [0] }] } });
  const point = all(container, node => node.getAttribute("data-chart-point") !== null)[0];
  // When
  await act(() => point.dispatchEvent(new FakeEvent("focus")));
  // Then
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip").length, 1);
  assert.ok(point.getAttribute("aria-describedby"));
});

test("SVG chart points expose a case-sensitive keyboard tab stop", async t => {
  for (const Component of [BarChart, LineChart, Histogram]) {
    const props = Component === Histogram ? { title: "Counts", labels: ["a"], values: [0] } :
      { title: "Requests", data: { labels: ["a"], series: [{ label: "Requests", values: [0] }] } };
    const { container } = await mount(t, Component, props);
    const points = all(container, node => node.getAttribute("data-chart-point") !== null);
    assert.ok(points.length > 0);
    for (const point of points) assert.equal(point.getAttribute("tabindex"), "0");
  }
});

test("Escape removes a chart tooltip without changing measured values", async t => {
  // Given
  const { container } = await mount(t, LineChart, { title: "Requests",
    data: { labels: ["a"], series: [{ label: "Requests", values: [0] }] } });
  const point = all(container, node => node.getAttribute("data-chart-point") !== null)[0];
  await act(() => point.dispatchEvent(new FakeEvent("focus")));
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip").length, 1);
  // When
  await act(() => byTag(container, "svg")[0].dispatchEvent(new FakeEvent("keydown", { key: "Escape" })));
  // Then
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip").length, 0);
  assert.equal(byTag(container, "td")[0].textContent, "0");
});

test("legend toggling hides only its series and retains all source data", async t => {
  // Given
  const { container } = await mount(t, BarChart, { title: "Requests",
    data: { labels: ["a"], series: [{ label: "Requests", values: [3] }] } });
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(byTag(container, "button")[0].getAttribute("aria-pressed"), "false");
  assert.notEqual(byTag(container, "g")[0].getAttribute("hidden"), null);
  assert.equal(byTag(container, "td")[0].textContent, "3");
});

test("focused chart tooltip survives pointer departure", async t => {
  const { container } = await mount(t, BarChart, { title: "Requests",
    data: { labels: ["a"], series: [{ label: "Requests", values: [3] }] } });
  const point = all(container, node => node.getAttribute("data-chart-point") !== null)[0];
  await act(() => point.dispatchEvent(new FakeEvent("focus")));
  await act(() => byTag(container, "svg")[0].dispatchEvent(new FakeEvent("MouseLeave")));
  await act(() => byTag(container, "figure")[0].dispatchEvent(new FakeEvent("MouseLeave")));
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip")[0]?.textContent, point.getAttribute("aria-label"));
});

test("Escape dismisses hover-only chart tooltips", async t => {
  const { container, dom } = await mount(t, BarChart, { title: "Requests",
    data: { labels: ["a"], series: [{ label: "Requests", values: [3] }] } });
  const point = all(container, node => node.getAttribute("data-chart-point") !== null)[0];
  await act(() => point.dispatchEvent(new FakeEvent("MouseEnter")));
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip").length, 1);
  await act(() => dom.documentElement.dispatchEvent(new FakeEvent("keydown", { key: "Escape" })));
  assert.equal(all(container, node => node.getAttribute("role") === "tooltip").length, 0);
});

test("focused chart tooltip follows current measurements", async t => {
  const props = { title: "Requests", data: { labels: ["a"], series: [{ label: "Requests", values: [3] }] } };
  const api = await mount(t, BarChart, props);
  await act(() => all(api.container, node => node.getAttribute("data-chart-point") !== null)[0].dispatchEvent(new FakeEvent("focus")));
  await api.show({ ...props, data: { ...props.data, series: [{ label: "Requests", values: [7] }] } });
  const point = all(api.container, node => node.getAttribute("data-chart-point") !== null)[0];
  assert.equal(all(api.container, node => node.getAttribute("role") === "tooltip")[0]?.textContent, point.getAttribute("aria-label"));
});

test("chart tooltip disappears when its measurement becomes absent", async t => {
  const props = { title: "Requests", data: { labels: ["a"], series: [{ label: "Requests", values: [3] }] } };
  const api = await mount(t, BarChart, props);
  await act(() => all(api.container, node => node.getAttribute("data-chart-point") !== null)[0].dispatchEvent(new FakeEvent("focus")));
  await api.show({ ...props, data: { ...props.data, series: [{ label: "Requests", values: [null] }] } });
  assert.equal(all(api.container, node => node.getAttribute("role") === "tooltip").length, 0);
});

test("histogram preserves zero buckets without fabricating missing counts", async t => {
  // Given / When
  const { container } = await mount(t, Histogram, { title: "Counts", labels: ["a", "b"], values: [0, null] });
  // Then
  assert.equal(byTag(container, "rect").length, 1);
  assert.equal(byTag(container, "rect")[0].getAttribute("height"), "1");
  assert.equal(byTag(container, "tbody")[0].children.length, 2);
});

test("static messages do not announce assertively", async t => {
  // Given / When
  const { container } = await mount(t, Alert, { title: "Info", children: "Recorded information" });
  // Then
  assert.equal(all(container, node => node.getAttribute("role") === "alert").length, 0);
});

test("callout dismissal invokes only the supplied dismissal action", async t => {
  // Given
  let count = 0;
  const { container } = await mount(t, Callout, { variant: "info", children: "Information", onDismiss: () => { count++; } });
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(count, 1);
});

test("status messages preserve recorded newlines and severity", async t => {
  // Given / When
  const { container } = await mount(t, StatusMessage, { level: "WARNING", message: "first\nsecond", size: "compact" });
  // Then
  assert.equal(container.children[0].getAttribute("data-level"), "WARNING");
  assert.equal(container.children[0].textContent, "first\nsecond");
});

test("status announcements follow severity only when enabled", async t => {
  for (const level of ["DEFAULT", "DEBUG", "WARNING", "ERROR"]) {
    const props = { level, message: "Recorded observation" };
    const api = await mount(t, StatusMessage, props);
    assert.equal(api.container.children[0].getAttribute("role"), null);
    await api.show({ ...props, announce: true });
    assert.equal(api.container.children[0].getAttribute("role"), level === "ERROR" ? "alert" : "status");
  }
});
