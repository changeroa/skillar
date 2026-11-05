import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

export type TableColumn<Row> = {
  readonly id: string;
  readonly label: string;
  readonly value: (row: Row) => string | number | null;
  readonly render?: (row: Row) => ComponentChildren;
  readonly sortable?: boolean;
};
export type TableSort = { readonly column: string; readonly direction: "ascending" | "descending" };

/** Sorts the supplied range only; does not imply server-wide ordering. */
export function sortRows<Row>(rows: readonly Row[], column: TableColumn<Row>, direction: TableSort["direction"]): Row[] {
  return [...rows].sort((a, b) => {
    const left = column.value(a), right = column.value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const order = typeof left === "number" && typeof right === "number"
      ? left - right : String(left).localeCompare(String(right), "ko", { numeric: true });
    return direction === "ascending" ? order : -order;
  });
}

export function DataTable<Row>({ caption, rows, columns, rowId, initialSort, onSort, controls = true }: {
  readonly caption: string;
  readonly rows: readonly Row[];
  readonly columns: readonly TableColumn<Row>[];
  readonly rowId: (row: Row) => string;
  readonly initialSort?: TableSort;
  readonly onSort?: (sort: TableSort) => void;
  readonly controls?: boolean;
}) {
  const [sort, setSort] = useState<TableSort | undefined>(initialSort);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [density, setDensity] = useState("compact");
  const visible = columns.filter(column => !hidden.includes(column.id));
  const sortColumn = columns.find(column => column.id === sort?.column);
  const ordered = sort && sortColumn ? sortRows(rows, sortColumn, sort.direction) : rows;
  const chooseSort = (column: string) => {
    const next: TableSort = {
      column, direction: sort?.column === column && sort.direction === "ascending" ? "descending" : "ascending",
    };
    setSort(next);
    onSort?.(next);
  };
  return h("section", { class: "ui-table", "data-density": density },
    controls && h("div", { class: "ui-toolbar" },
      h("details", { class: "ui-columns" },
        h("summary", null, `열 표시 ${visible.length}/${columns.length}`),
        h("div", null, columns.map(column => h("label", { class: "ui-choice", key: column.id },
          h("input", {
            type: "checkbox", checked: !hidden.includes(column.id),
            disabled: visible.length === 1 && visible[0]?.id === column.id,
            onChange: () => setHidden(previous => previous.includes(column.id)
              ? previous.filter(id => id !== column.id) : [...previous, column.id]),
          }), column.label)))),
      h("label", { class: "ui-density" }, "행 밀도",
        h("select", { value: density, onChange: (event: JSX.TargetedEvent<HTMLSelectElement>) => setDensity(event.currentTarget.value) },
          h("option", { value: "compact" }, "조밀"), h("option", { value: "normal" }, "보통"),
          h("option", { value: "spacious" }, "여유")))),
    h("div", { class: "ui-table-scroll", tabIndex: 0, role: "region", "aria-label": caption },
      h("table", null, h("caption", null, caption),
        h("thead", null, h("tr", null, visible.map(column => h("th", {
          key: column.id, scope: "col",
          "aria-sort": column.sortable === false ? undefined : sort?.column === column.id ? sort.direction : "none",
        }, column.sortable === false ? column.label : h("button", {
          type: "button", onClick: () => chooseSort(column.id),
        }, column.label, h("span", { "aria-hidden": "true" },
          sort?.column === column.id ? sort.direction === "ascending" ? " ↑" : " ↓" : " ↕")))))),
        h("tbody", null, ordered.map(row => h("tr", { key: rowId(row) },
          visible.map(column => h("td", { key: column.id },
            column.render ? column.render(row) : column.value(row) ?? "미측정"))))))),
    rows.length === 0 && h("p", { class: "ui-empty" }, "조건에 맞는 항목이 없습니다."));
}
