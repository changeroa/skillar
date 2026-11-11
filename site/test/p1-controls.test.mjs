import assert from "node:assert/strict";
import test from "node:test";
import { useState } from "preact/hooks";
import { act, all, byTag, FakeEvent, h, input, loadViews, mount } from "./helpers/t10-dom.mjs";
const { Textarea, Avatar, Spinner, Toast, Combobox, MultiSelect, DateRangeInput, parseKstDateTime, formatKstDateTime,
  MarkdownViewer, DiffViewer } = await loadViews(`
export * from "./local/dashboard/foundation/controls/index.ts";
export {parseKstDateTime,formatKstDateTime} from "./local/dashboard/foundation/controls/date-range.tsx";
export * from "./local/dashboard/foundation/viewers/index.ts";`);

test("Markdown preserves hostile HTML and URLs as literal text", async t => {
  // Given
  const text = '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))';
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.equal(byTag(container, "img").length + byTag(container, "script").length + byTag(container, "a").length, 0);
  assert.ok(container.textContent.includes(text.split("\n\n")[0]));
});

test("empty diffs expose a named region without fabricated comparison rows", async t => {
  // Given
  const rows = [];
  // When
  const { container } = await mount(t, DiffViewer, { rows });
  // Then
  assert.equal(byTag(container, "ol").length, 0);
  assert.equal(all(container, node => node.getAttribute("role") === "region").length, 1);
});

test("fenced Markdown code retains exact escaped content", async t => {
  // Given
  const value = '<script>alert("x")</script>\n  indented';
  // When
  const { container } = await mount(t, MarkdownViewer, { text: `\`\`\`html\n${value}\n\`\`\`` });
  // Then
  assert.equal(byTag(container, "code")[0].textContent, value);
  assert.equal(byTag(container, "script").length, 0);
});

test("KST datetime boundary preserves milliseconds independently of host timezone", () => {
  // Given
  const value = "2026-11-11T00:00:00.123";
  // When
  const parsed = parseKstDateTime(value);
  // Then
  assert.equal(parsed, Date.UTC(2026, 10, 10, 15, 0, 0, 123));
  assert.equal(formatKstDateTime(parsed), value);
});

test("KST datetime boundary rejects normalized impossible dates", () => {
  // Given
  const value = "2026-02-30T12:00";
  // When
  const parsed = parseKstDateTime(value);
  // Then
  assert.equal(parsed, null);
});

test("DateRange retains an incomplete native edit until the user applies it", async t => {
  // Given
  const { container } = await mount(t, DateRangeInput, { range: { from: 0, to: 1000 }, onChange() {} });
  const field = byTag(container, "input")[0];
  // When
  await input(field, "");
  // Then
  assert.equal(field.value, "");
});

test("DateRange rejects reversed endpoints without changing the caller range", async t => {
  // Given
  const changes = [];
  const { container } = await mount(t, DateRangeInput, { range: { from: 0, to: 1000 }, onChange: value => changes.push(value) });
  await input(byTag(container, "input")[0], "2026-11-12T00:00:00.123");
  await input(byTag(container, "input")[1], "2026-11-11T00:00:00.456");
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(changes.length, 0);
  assert.equal(all(container, node => node.getAttribute("role") === "alert").length, 1);
});

test("DateRange applies both endpoints as KST epochs with millisecond precision", async t => {
  // Given
  const changes = [];
  const { container } = await mount(t, DateRangeInput, { range: { from: 0, to: 1000 }, onChange: value => changes.push(value) });
  await input(byTag(container, "input")[0], "2026-11-11T00:00:00.123");
  await input(byTag(container, "input")[1], "2026-11-12T00:00:00.456");
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.deepEqual(changes, [{ from: Date.UTC(2026, 10, 10, 15, 0, 0, 123), to: Date.UTC(2026, 10, 11, 15, 0, 0, 456) }]);
});

test("Textarea retains native document edits and error association", async t => {
  // Given
  let changed;
  const { container } = await mount(t, Textarea, { id: "document", label: "Document", rows: 18,
    value: "before", error: "Invalid", onInput: event => { changed = event.currentTarget.value; } });
  const field = byTag(container, "textarea")[0];
  // When
  await input(field, "after");
  // Then
  assert.equal(changed, "after");
  assert.equal(field.getAttribute("aria-describedby"), "document-error");
  assert.equal(field.rows, 18);
});

test("Toast updates its persistent polite region without moving focus", async t => {
  // Given
  const api = await mount(t, Toast, { message: "", onDismiss() {} });
  const region = byTag(api.container, "p")[0];
  const focused = api.dom.activeElement;
  // When
  await api.show({ message: "Saved", variant: "success", onDismiss() {} });
  // Then
  assert.equal(byTag(api.container, "p")[0], region);
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("aria-atomic"), "true");
  assert.equal(api.dom.activeElement, focused);
});

test("Spinner inherits its caller foreground and supports inline layout", async t => {
  const { container } = await mount(t, Spinner, { display: "inline" });
  const status = all(container, node => node.getAttribute("role") === "status")[0];
  assert.ok(status.getAttribute("class").includes("lf-loading--inherit"));
  assert.ok(status.getAttribute("class").includes("lf-loading--inline"));
});

test("Avatar removes the fallback when the image loads", async t => {
  const { container } = await mount(t, Avatar, { displayName: "Demo User", src: "/avatar.png" });
  const image = byTag(container, "img")[0];
  const eventType = image.listeners.find(listener => listener.type.toLowerCase() === "load").type;
  await act(() => image.dispatchEvent(new FakeEvent(eventType)));
  const avatar = all(container, node => node.getAttribute("role") === "img")[0];
  assert.equal(avatar.textContent, "");
  assert.equal(avatar.getAttribute("aria-label"), "Demo User");
  assert.equal(byTag(container, "img").length, 1);
});

test("Avatar shows initials again when an image fails", async t => {
  // Given
  const { container } = await mount(t, Avatar, { displayName: "Demo User", src: "/missing.png" });
  // When
  const image = byTag(container, "img")[0];
  const eventType = image.listeners.find(listener => listener.type.toLowerCase() === "error").type;
  await act(() => image.dispatchEvent(new FakeEvent(eventType)));
  // Then
  assert.equal(byTag(container, "img").length, 0);
  assert.equal(all(container, node => node.getAttribute("role") === "img")[0].textContent, "DU");
});

test("Combobox filtered options never create a nonexistent active descendant", async t => {
  // Given
  const { container } = await mount(t, Combobox, { label: "Choose", options: [{ value: "a", label: "Alpha" }],
    value: "", onChange() {} });
  const field = byTag(container, "input")[0];
  // When
  await input(field, "no match");
  // Then
  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(field.getAttribute("aria-activedescendant"), null);
  assert.equal(all(container, node => node.getAttribute("role") === "option").length, 0);
});

test("MultiSelect select-all preserves disabled selections in one controlled update", async t => {
  // Given
  let changes = 0;
  function Harness() {
    const [value, setValue] = useState(["locked"]);
    return h(MultiSelect, { label: "Choose", value, options: [
      { value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "locked", label: "Locked", disabled: true },
    ], onChange: next => { changes++; setValue(next); } });
  }
  const { container } = await mount(t, Harness, {});
  await input(byTag(container, "input")[0], "");
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(changes, 1);
  assert.deepEqual(all(container, node => node.getAttribute("role") === "option").map(node => node.getAttribute("aria-selected")),
    ["true", "true", "true"]);
});

test("DiffViewer retains line identity and renders hostile text without markup", async t => {
  // Given
  const rows = [{ kind: "removed", before: 1, after: null, text: "<img src=x>" }];
  // When
  const { container } = await mount(t, DiffViewer, { rows });
  // Then
  assert.equal(byTag(container, "li")[0].getAttribute("data-change"), "removed");
  assert.equal(byTag(container, "code")[0].textContent, rows[0].text);
  assert.equal(byTag(container, "img").length, 0);
});

test("DiffViewer pairs changed runs without losing unequal sides or unchanged lines", async t => {
  // Given
  const rows = [
    { kind: "removed", before: 1, after: null, text: "before one" },
    { kind: "removed", before: 2, after: null, text: "before two" },
    { kind: "added", before: null, after: 1, text: "after" },
    { kind: "same", before: 3, after: 2, text: "tail" },
  ];
  // When
  const { container } = await mount(t, DiffViewer, { rows });
  // Then
  assert.equal(byTag(container, "li").length, 3);
  assert.deepEqual(all(container, node => node.getAttribute("data-side") === "before").flatMap(node => byTag(node, "code").map(code => code.textContent)),
    ["before one", "before two", "tail"]);
  assert.deepEqual(all(container, node => node.getAttribute("data-side") === "after").flatMap(node => byTag(node, "code").map(code => code.textContent)),
    ["after", "tail"]);
});
