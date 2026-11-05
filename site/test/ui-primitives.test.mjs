import assert from "node:assert/strict";
import test from "node:test";
import { useState } from "preact/hooks";
import { DataTable, sortRows, FacetPanel, Pill, KeyValueGrid, NumberTile, Toast, Skeleton,
  SegmentedTabs, BarChart, LineChart, chartLayout, peekUrl, usePeekSelection, PeekPanel } from "../src/ui/index.ts";
import { act, all, byTag, FakeEvent, h, mount, input } from "./helpers/t10-dom.mjs";

const columns = [
  { id: "name", label: "이름", value: row => row.name },
  { id: "count", label: "수", value: row => row.count },
];
const rows = [{ id: "a", name: "가", count: 3 }, { id: "b", name: "나", count: 1 },
  { id: "c", name: "다", count: null }];
const tableProps = { caption: "현재 범위", columns, rows, rowId: row => row.id };

test("table sorts its rendered range and exposes the selected header direction", async t => {
  // Given
  const { container } = await mount(t, DataTable, tableProps);
  const sort = byTag(byTag(container, "th")[1], "button")[0];
  // When
  await act(() => sort.click());
  // Then
  assert.equal(byTag(container, "th")[1].getAttribute("aria-sort"), "ascending");
  assert.deepEqual(byTag(container, "tbody")[0].children.map(row => row.children[0].textContent), ["나", "가", "다"]);
  assert.deepEqual(rows.map(row => row.id), ["a", "b", "c"]);
});

test("descending numeric sorting keeps missing values last", () => {
  // Given / When
  const ordered = sortRows(rows, columns[1], "descending");
  // Then
  assert.deepEqual(ordered.map(row => row.id), ["a", "b", "c"]);
});

test("summary tables can omit view controls while retaining sortable semantic columns", async t => {
  // Given
  const { container } = await mount(t, DataTable, { ...tableProps, controls: false });
  // When
  await act(() => byTag(byTag(container, "th")[1], "button")[0].click());
  // Then
  assert.equal(byTag(container, "select").length, 0);
  assert.equal(byTag(container, "input").length, 0);
  assert.equal(byTag(container, "th")[1].getAttribute("aria-sort"), "ascending");
  assert.deepEqual(byTag(container, "tbody")[0].children.map(row => row.children[0].textContent), ["나", "가", "다"]);
});

test("column visibility updates headers and cells but preserves one visible column", async t => {
  // Given
  const { container } = await mount(t, DataTable, tableProps);
  // When
  await act(() => byTag(container, "input")[1].dispatchEvent(new FakeEvent("change")));
  // Then
  assert.equal(byTag(container, "th").length, 1);
  assert.equal(byTag(container, "td").length, rows.length);
  assert.equal(byTag(container, "input")[0].disabled, true);
});

test("density changes presentation without changing the supplied rows", async t => {
  // Given
  const { container } = await mount(t, DataTable, tableProps);
  // When
  await input(byTag(container, "select")[0], "spacious", "change");
  // Then
  assert.equal(container.children[0].getAttribute("data-density"), "spacious");
  assert.equal(byTag(container, "tbody")[0].children.length, rows.length);
});

test("facet selection reports its group and value without dropping zero-count options", async t => {
  // Given
  let change;
  const { container } = await mount(t, FacetPanel, {
    title: "필터", scope: "현재 범위", selected: {},
    groups: [{ id: "runtime", label: "런타임", values: [{ id: "empty", label: "예시", count: 0 }] }],
    onChange: (...value) => { change = value; },
  });
  const checkbox = byTag(container, "input")[0];
  // When
  await act(() => checkbox.dispatchEvent(new FakeEvent("change")));
  // Then
  assert.deepEqual(change, ["runtime", ["empty"]]);
  assert.equal(checkbox.disabled, false);
  assert.equal(byTag(container, "fieldset").length, 1);
  assert.equal(byTag(container, "legend").length, 1);
});

test("pill is metadata rather than an interactive target", async t => {
  // Given / When
  const { container } = await mount(t, Pill, { tone: "success", children: "완료" });
  // Then
  assert.equal(byTag(container, "span")[0].getAttribute("role"), null);
  assert.equal(byTag(container, "button").length, 0);
  assert.equal(byTag(container, "span")[0].getAttribute("class"), "ui-pill ui-tone-success");
});

test("key value grid retains complete opaque values in semantic description rows", async t => {
  // Given
  const value = "0123456789".repeat(12);
  // When
  const { container } = await mount(t, KeyValueGrid, { entries: [{ label: "digest", value }] });
  // Then
  assert.equal(byTag(container, "dl").length, 1);
  assert.equal(byTag(container, "dt").length, 1);
  assert.equal(byTag(container, "dd")[0].textContent, value);
});

test("number tile distinguishes missing measurements from measured zero", async t => {
  // Given
  const props = { label: "세션", value: null, note: "현재 범위" };
  const { container, show } = await mount(t, NumberTile, props);
  const missing = byTag(container, "strong")[0].textContent;
  // When
  await show({ ...props, value: 0 });
  // Then
  assert.notEqual(missing, "0");
  assert.equal(byTag(container, "strong")[0].textContent, "0");
});

test("toast exposes polite atomic feedback and explicit dismissal", async t => {
  // Given
  let dismissed = false;
  const { container } = await mount(t, Toast, { message: "완료", onDismiss: () => { dismissed = true; } });
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  const status = all(container, node => node.getAttribute("role") === "status")[0];
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(dismissed, true);
});

test("skeleton has one busy announcement and decorative layout blocks", async t => {
  // Given / When
  const { container } = await mount(t, Skeleton, { rows: 4 });
  // Then
  const status = all(container, node => node.getAttribute("role") === "status");
  assert.equal(status.length, 1);
  assert.equal(status[0].getAttribute("aria-busy"), "true");
  assert.equal(all(container, node => node.getAttribute("aria-hidden") === "true").length, 4);
});

test("segmented tabs use arrow activation with roving focus and linked panels", async t => {
  // Given
  const { dom, container } = await mount(t, SegmentedTabs, {
    id: "inspect", label: "표현", tabs: [
      { id: "tree", label: "구조", content: "A" }, { id: "raw", label: "원문", content: "B" }],
  });
  const tabs = all(container, node => node.getAttribute("role") === "tab");
  // When
  await act(() => tabs[0].dispatchEvent(new FakeEvent("keydown", { key: "ArrowRight" })));
  // Then
  assert.equal(dom.activeElement, tabs[1]);
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("tabindex"), "0");
  assert.equal(tabs[0].getAttribute("tabindex"), "-1");
  const panel = all(container, node => node.id === tabs[1].getAttribute("aria-controls"))[0];
  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute("aria-labelledby"), tabs[1].id);
});

const chart = { labels: ["월", "화", "수"], series: [
  { label: "읽기", values: [0, 7, null] }, { label: "검색", values: [3, 14, 2] }] };
test("every grouped bar ends at the shared baseline, including the labelled zero tick", async t => {
  // Given
  const layout = chartLayout(chart);
  const { container } = await mount(t, BarChart, { title: "요청", data: chart });
  // When
  const bars = byTag(container, "rect");
  // Then
  assert.equal(bars.length, 5);
  for (const bar of bars) assert.equal(Number(bar.getAttribute("y")) + Number(bar.getAttribute("height")), layout.baseline);
  assert.ok(layout.bars.every(bar => Number.isInteger(bar.y) && Number.isInteger(bar.height)));
  assert.equal(bars[0].getAttribute("height"), "1");
  assert.equal(bars[0].getAttribute("data-value"), "0");
  assert.ok(byTag(container, "text").some(node => node.textContent === "0"));
  assert.ok(layout.bars.every(bar => bar.width === layout.bars[0].width));
  const seven = layout.bars.find(bar => bar.value === 7), fourteen = layout.bars.find(bar => bar.value === 14);
  assert.equal(seven.height * 2, fourteen.height);
  const gaps = [0, 2, 4].map(index => layout.bars[index + 1].x - layout.bars[index].x - layout.bars[index].width);
  assert.ok(gaps.every(gap => Math.abs(gap - gaps[0]) < 1e-9));
});

test("line chart leaves a path gap at missing points", async t => {
  // Given / When
  const { container } = await mount(t, LineChart, { title: "요청", data: {
    labels: ["월", "화", "수"], series: [{ label: "읽기", values: [3, null, 6] }],
  } });
  // Then
  const path = byTag(container, "path")[0].getAttribute("d");
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/L/g) ?? []).length, 0);
  assert.equal(byTag(container, "circle").length, 2);
});

test("missing bar slots do not draw overlapping per-group labels", async t => {
  // Given
  const { container } = await mount(t, BarChart, { title: "요청", data: chart });
  // When
  const slots = byTag(container, "g");
  // Then
  assert.equal(slots.length, 6);
  assert.equal(slots.filter(slot => slot.children.length === 0).length, 1);
  assert.equal(slots.filter(slot => byTag(slot, "text").length === 1).length, 5);
});

test("unmeasured charts do not fabricate SVG points or bars", async t => {
  // Given / When
  const { container } = await mount(t, BarChart, { title: "요청", data: {
    labels: ["월"], series: [{ label: "읽기", values: [null] }],
  } });
  // Then
  assert.equal(byTag(container, "svg").length, 0);
  assert.equal(byTag(container, "rect").length, 0);
});

test("peek URL adds and removes only its selection while preserving filters and hash", () => {
  // Given
  const original = "https://skillar.sh/skills/?sort=name#/skill/version";
  // When
  const opened = peekUrl(original, "selected", "a/b");
  const closed = peekUrl(opened, "selected", null);
  // Then
  assert.equal(new URL(opened).searchParams.get("selected"), "a/b");
  assert.equal(closed, original);
});

test("peek selection restores reload and browser navigation state", async t => {
  // Given
  const previous = globalThis.window;
  const win = new EventTarget();
  win.location = new URL("https://skillar.sh/skills/?selected=first&sort=name");
  win.history = { pushState: (_state, _title, href) => { win.location = new URL(href); } };
  globalThis.window = win;
  let select, selected;
  function Fixture() {
    [selected, select] = usePeekSelection();
    return h("div", { "data-selected": selected });
  }
  const { container } = await mount(t, Fixture, {});
  t.after(() => { globalThis.window = previous; });
  assert.equal(selected, "first");
  // When
  await act(() => select("second"));
  win.location = new URL("https://skillar.sh/skills/?selected=first&sort=name");
  await act(() => win.dispatchEvent(new Event("popstate")));
  // Then
  assert.equal(container.children[0].getAttribute("data-selected"), "first");
  assert.equal(win.location.searchParams.get("sort"), "name");
});

test("peek Escape closes the desktop panel and restores its opener", async t => {
  // Given: native dialog methods are the browser boundary; the lifecycle is real.
  const previous = globalThis.window;
  const win = new EventTarget();
  win.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  globalThis.window = win;
  t.after(() => { globalThis.window = previous; });
  let opener;
  function Fixture() {
    const [selected, setSelected] = useState("record");
    if (!opener) {
      opener = document.createElement("button");
      document.body.appendChild(opener);
    }
    return h(PeekPanel, { id: "peek", selectedId: selected, title: "상세", fullPageHref: "/skills/",
      returnFocus: opener, onClose: () => setSelected(null), children: "내용" });
  }
  // Install dialog behavior before Preact runs layout effects.
  const { installFakeDom } = await import("./helpers/fake-dom.mjs");
  const dom = installFakeDom();
  const proto = Object.getPrototypeOf(dom.body);
  proto.close = function () { this.open = false; };
  proto.show = function () { this.open = true; };
  t.after(() => { delete proto.close; delete proto.show; });
  const { container, dom: mounted } = await mount(t, Fixture, {});
  byTag(container, "button")[0].focus();
  // When
  const escape = new Event("keydown", { cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await act(() => win.dispatchEvent(escape));
  // Then
  assert.equal(byTag(container, "dialog")[0].open, false);
  assert.equal(mounted.activeElement, opener);
});
