import type { ComponentChildren } from "preact";

export type TableColumn<Row> = {
  readonly id: string;
  readonly label: string;
  readonly hideable?: boolean;
  readonly value: (row: Row) => string | number | null;
  readonly render?: (row: Row) => ComponentChildren;
  readonly sortable?: boolean;
};
export type TableSort = { readonly column: string; readonly direction: "ascending" | "descending" };
export type TableSelection = {
  readonly ids: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
};

/** Sorts the supplied range only; missing values stay last in either direction. */
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
