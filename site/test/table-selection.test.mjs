import assert from "node:assert/strict";
import test from "node:test";
import { act, byTag, FakeEvent, h, loadViews, mount } from "./helpers/t10-dom.mjs";

const { DataTable } = await loadViews('export { DataTable } from "./site/src/ui/table.ts";');
const { LibraryPanel } = await loadViews('export { LibraryPanel } from "./site/src/skills/library.ts";');
const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
const columns = [{ id: "id", label: "이름", value: row => row.id }];
const tableProps = { caption: "현재 범위", columns, rows, rowId: row => row.id };
const libraryProps = { skills: [], notice: "", message: "", selectedId: null,
  signal: new AbortController().signal, onReload() {}, onOpen() {}, onUnauthorized() {} };

test("hosted cold library load propagates busy to the real table", async t => {
  // Given a library with no previously received rows.
  const { container, show } = await mount(t, LibraryPanel, { ...libraryProps, status: "ready" });
  // When the catalog read is pending.
  await show({ ...libraryProps, status: "loading" });
  // Then the table exposes loading placeholders, not an empty-result status.
  const table = byTag(container, "section").find(node => (node.getAttribute("class") ?? "").includes("lf-table-surface"));
  assert.equal(table.getAttribute("aria-busy"), "true");
  assert.equal(byTag(table, "tbody")[0].children.every(row => row.getAttribute("aria-hidden") === "true"), true);
});

test("hosted failed cold library read does not expose an empty table", async t => {
  // Given a mounted library without a received catalog.
  const { container, show } = await mount(t, LibraryPanel, { ...libraryProps, status: "loading" });
  // When its first read fails.
  await show({ ...libraryProps, status: "failed", message: "fixture-unavailable" });
  // Then the preserved table is hidden until there are confirmed rows.
  const table = byTag(container, "section").find(node => (node.getAttribute("class") ?? "").includes("lf-table-surface"));
  assert.equal(table.parentNode.hidden, true);
});

test("select all adds only the current page while preserving other selected rows", async t => {
  // Given
  let selected;
  const { container } = await mount(t, DataTable, { ...tableProps,
    selection: { ids: ["outside", "a"], onChange: ids => { selected = ids; } },
    page: { index: 0, size: 2, total: rows.length, onChange() {} },
  });
  const checkbox = byTag(byTag(container, "thead")[0], "input")[0];
  // When
  await act(() => { checkbox.checked = true; checkbox.dispatchEvent(new FakeEvent("change")); });
  // Then
  assert.deepEqual(selected, ["outside", "a", "b"]);
});

test("out of range page restores the last received page after filtering", async t => {
  // Given
  const { container } = await mount(t, DataTable, { ...tableProps,
    page: { index: 9, size: 2, total: rows.length, onChange() {} },
  });
  // When
  const rendered = byTag(container, "tbody")[0].children;
  // Then
  assert.deepEqual(rendered.map(row => row.id), ["c"]);
});

test("nested row controls activate without also opening the row", async t => {
  // Given
  let opens = 0, actions = 0;
  const { container } = await mount(t, DataTable, { ...tableProps, controls: false,
    onRowOpen: () => { opens++; },
    columns: [{ ...columns[0], render: () => h("button", { onClick: () => { actions++; } }, "선택") }],
  });
  const button = byTag(byTag(container, "tbody")[0], "button")[0];
  // When
  await act(() => button.click());
  // Then
  assert.deepEqual({ opens, actions }, { opens: 0, actions: 1 });
});

test("cold table load announces busy without announcing an empty result", async t => {
  // Given
  const { container, show } = await mount(t, DataTable, { ...tableProps, rows: [] });
  // When
  await show({ ...tableProps, rows: [], busy: true });
  // Then
  assert.equal(byTag(container, "section")[0].getAttribute("aria-busy"), "true");
  assert.equal(byTag(container, "tbody")[0].children.every(row => row.getAttribute("aria-hidden") === "true"), true);
  assert.equal(byTag(container, "p").some(node => (node.getAttribute("class") ?? "").includes("ui-empty")), false);
});

test("empty results span all visible columns including selection", async t => {
  // Given
  const { container, show } = await mount(t, DataTable, { ...tableProps, selection: { ids: [], onChange() {} } });
  // When
  await show({ ...tableProps, rows: [], selection: { ids: [], onChange() {} } });
  // Then
  const cell = byTag(byTag(container, "tbody")[0], "td")[0];
  assert.equal(cell.getAttribute("colspan"), "2");
  assert.equal(cell.getAttribute("role"), "status");
});
