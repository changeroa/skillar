import assert from "node:assert/strict";
import test from "node:test";
import { useState } from "preact/hooks";
import { act, byTag, FakeEvent, h, input, loadViews, mount } from "./helpers/t10-dom.mjs";

const { Button, Badge, Tag, Input, SearchInput, Select, Checkbox, Link, KeyboardShortcut, CopyButton } = await loadViews(
  'export * from "./local/dashboard/foundation/controls/index.ts";',
);

test("loading button blocks activation without losing its accessible name", async t => {
  // Given
  let activated = 0;
  const { container } = await mount(t, Button, { text: "Save", loading: true, onClick() { activated++; } });
  // When
  const button = byTag(container, "button")[0];
  await act(() => button.click());
  // Then
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.getAttribute("aria-label"), "Save");
  assert.equal(activated, 0);
});

test("input associates its visible label and validation message", async t => {
  // Given
  const { container } = await mount(t, Input, { label: "Name", error: "Required", id: "name" });
  // When
  const field = byTag(container, "input")[0];
  // Then
  assert.equal(byTag(container, "label")[0].getAttribute("for"), field.id);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(field.getAttribute("aria-describedby"), "name-error");
  assert.equal(byTag(container, "span").find(node => node.id === "name-error").textContent, "Required");
});

test("search submits the current field value on Enter", async t => {
  // Given
  let submitted;
  const { container } = await mount(t, SearchInput, { label: "Search", value: "before", onChange() {}, onSubmit(value) { submitted = value; } });
  const field = byTag(container, "input")[0];
  field.value = "after";
  // When
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  // Then
  assert.equal(submitted, "after");
});

test("search does not submit an IME composition confirmation", async t => {
  // Given
  let submitted = false;
  const { container } = await mount(t, SearchInput, { label: "Search", value: "", onChange() {}, onSubmit() { submitted = true; } });
  const event = new FakeEvent("keydown", { key: "Enter" });
  event.isComposing = true;
  // When
  await act(() => byTag(container, "input")[0].dispatchEvent(event));
  // Then
  assert.equal(submitted, false);
});

test("search clear empties the controlled value and restores field focus", async t => {
  // Given
  function Search() {
    const [value, setValue] = useState("query");
    return h(SearchInput, { label: "Search", value, onChange: setValue, onSubmit() {} });
  }
  const { container, dom } = await mount(t, Search, {});
  // When
  await act(() => byTag(container, "button")[1].click());
  // Then
  assert.equal(byTag(container, "input")[0].value, "");
  assert.equal(dom.activeElement, byTag(container, "input")[0]);
  assert.equal(byTag(container, "button").length, 1);
});

test("select reports native changes and retains disabled options", async t => {
  // Given
  let chosen;
  const { container } = await mount(t, Select, { label: "Item", value: "a",
    options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma", disabled: true }],
    onChange(event) { chosen = event.currentTarget.value; } });
  // When
  await input(byTag(container, "select")[0], "b", "change");
  // Then
  assert.equal(chosen, "b");
  assert.equal(byTag(container, "option")[3].getAttribute("disabled"), "true");
});

test("checkbox exposes indeterminate state through its native control", async t => {
  // Given
  const { container } = await mount(t, Checkbox, { label: "Select", mixed: true, name: "selection" });
  // When
  const field = byTag(container, "input")[0];
  // Then
  assert.equal(field.type, "checkbox");
  assert.equal(field.indeterminate, true);
  assert.equal(field.getAttribute("aria-checked"), null);
  assert.equal(field.name, "selection");
});

test("uncontrolled select paints the selected native option after a change", async t => {
  // Given
  const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];
  const { container } = await mount(t, Select, { label: "Item", defaultValue: "a", options });
  assert.equal(byTag(container, "span")[0].textContent, options[0].label);
  // When
  await input(byTag(container, "select")[0], "b", "change");
  // Then
  assert.equal(byTag(container, "span")[0].textContent, options[1].label);
  assert.equal(byTag(container, "span")[0].getAttribute("aria-hidden"), "true");
});

test("tag removal does not activate its enclosing row", async t => {
  // Given
  let removed = 0;
  let rowActivated = 0;
  function Row() {
    return h("div", { onClick() { rowActivated++; } },
      h(Tag, { text: "filter", remove: { onRemove() { removed++; } } }));
  }
  const { container } = await mount(t, Row, {});
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(removed, 1);
  assert.equal(rowActivated, 0);
});

test("dismissible badge invokes its removal action as a button", async t => {
  // Given
  let removed = 0;
  const { container } = await mount(t, Badge, { text: "filter", onDismiss() { removed++; } });
  // When
  await act(() => byTag(container, "button")[0].click());
  // Then
  assert.equal(removed, 1);
  assert.equal(byTag(container, "button")[0].type, "button");
});

test("external link preserves browser navigation with opener isolation", async t => {
  // Given
  const { container } = await mount(t, Link, { text: "Visit", href: "https://example.test/path", external: true });
  // When
  const link = byTag(container, "a")[0];
  // Then
  assert.equal(link.getAttribute("href"), "https://example.test/path");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
});

test("shortcut resolves Mod according to the selected platform", async t => {
  // Given
  const { container, show } = await mount(t, KeyboardShortcut, { keys: ["Mod", "K"], platform: "other" });
  assert.equal(byTag(container, "kbd")[0].textContent, "CtrlK");
  // When
  await show({ keys: ["Mod", "K"], platform: "mac" });
  // Then
  assert.equal(byTag(container, "kbd")[0].textContent, "\u2318K");
});

function clipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText } } });
  t.after(() => original ? Object.defineProperty(globalThis, "navigator", original) : Reflect.deleteProperty(globalThis, "navigator"));
}

test("copy writes the unabridged value and exposes successful completion", async t => {
  // Given
  let copied;
  clipboard(t, async value => { copied = value; });
  const { container } = await mount(t, CopyButton, { value: "full-original-value", label: "ID" });
  // When
  await act(async () => { byTag(container, "button")[0].click(); });
  // Then
  assert.equal(copied, "full-original-value");
  assert.equal(byTag(container, "button")[0].getAttribute("aria-label"), "ID 복사됨");
});

test("copy exposes rejection inline instead of reporting success", async t => {
  // Given
  clipboard(t, async () => { throw new Error("Permission denied"); });
  const { container } = await mount(t, CopyButton, { value: "full-original-value", label: "ID" });
  // When
  await act(async () => { byTag(container, "button")[0].click(); });
  // Then
  assert.equal(byTag(container, "button")[0].getAttribute("aria-label"), "ID 복사");
  assert.equal(byTag(container, "span").find(node => node.getAttribute("role") === "status").textContent.length > 0, true);
});

test("stale clipboard completion cannot mark a changed value as copied", async t => {
  // Given
  let complete;
  clipboard(t, () => new Promise(resolve => { complete = resolve; }));
  const { container, show } = await mount(t, CopyButton, { value: "old", label: "ID" });
  await act(() => byTag(container, "button")[0].click());
  await show({ value: "new", label: "ID" });
  // When
  await act(async () => { complete(); });
  // Then
  assert.equal(byTag(container, "button")[0].getAttribute("aria-label"), "ID 복사");
  assert.equal(byTag(container, "button")[0].disabled, false);
});
