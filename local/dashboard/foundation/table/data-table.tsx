import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { ColumnVisibility, TableDensity } from "./controls";
import { RowCheckbox, SortButton, TableRow, TableToolbar } from "./parts";
import { TablePagination, type TablePage } from "./pagination";
import { sortRows, type TableColumn, type TableSelection, type TableSort } from "./model";
import { tableStyles } from "./styles";

export function DataTable<Row>({ caption, rows, columns, rowId, initialSort, onSort,
  sort: controlledSort, hidden: controlledHidden, density: controlledDensity, onHiddenChange, onDensityChange,
  toolbar, onRowOpen, selectedId, controls = true, selection, page, busy = false }: {
  readonly caption: string; readonly rows: readonly Row[]; readonly columns: readonly TableColumn<Row>[];
  readonly rowId: (row: Row) => string; readonly initialSort?: TableSort; readonly sort?: TableSort;
  readonly onSort?: (sort: TableSort) => void; readonly controls?: boolean; readonly hidden?: readonly string[];
  readonly density?: string; readonly onHiddenChange?: (hidden: readonly string[]) => void;
  readonly onDensityChange?: (density: string) => void; readonly toolbar?: ComponentChildren;
  readonly onRowOpen?: (row: Row, target: HTMLElement) => void; readonly selectedId?: string | null;
  readonly selection?: TableSelection; readonly page?: TablePage;
  readonly busy?: boolean;
}) {
  tableStyles();
  const [localSort, setSort] = useState<TableSort | undefined>(initialSort);
  const [localHidden, setHidden] = useState<readonly string[]>([]);
  const [localDensity, setDensity] = useState("compact");
  const sort = controlledSort ?? localSort;
  const hidden = [...new Set(controlledHidden ?? localHidden)].filter(id =>
    columns.some(column => column.id === id && column.hideable !== false));
  const density = controlledDensity ?? localDensity;
  const visible = columns.filter(column => !hidden.includes(column.id));
  const sortColumn = columns.find(column => column.id === sort?.column);
  const ordered = sort && sortColumn ? sortRows(rows, sortColumn, sort.direction) : rows;
  const pageCount = page ? Math.max(1, Math.ceil(ordered.length / page.size)) : 1;
  const index = page ? Math.min(Math.max(0, page.index), pageCount - 1) : 0;
  const shown = page ? ordered.slice(index * page.size, (index + 1) * page.size) : ordered;
  const ids = shown.map(rowId);
  const chosen = ids.filter(id => selection?.ids.includes(id));
  const chooseSort = (column: string) => {
    const next: TableSort = { column,
      direction: sort?.column === column && sort.direction === "ascending" ? "descending" : "ascending" };
    setSort(next); onSort?.(next);
  };
  return <section class="ui-table lf-table-surface" data-density={density} aria-busy={busy}>
    {controls && <TableToolbar>
      {toolbar}
      <ColumnVisibility columns={columns} hidden={hidden} onChange={next => { setHidden(next); onHiddenChange?.(next); }} />
      <TableDensity value={density} onChange={next => { setDensity(next); onDensityChange?.(next); }} />
    </TableToolbar>}
    <div class="ui-table-scroll lf-table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table><caption>{caption}</caption>
        <thead><tr>
          {selection && <th scope="col" class="lf-table-select"><RowCheckbox label="현재 페이지 전체 선택"
            checked={ids.length > 0 && chosen.length === ids.length} mixed={chosen.length > 0 && chosen.length < ids.length}
            disabled={ids.length === 0} onChange={checked => selection.onChange(checked
              ? [...new Set([...selection.ids, ...ids])] : selection.ids.filter(id => !ids.includes(id)))} /></th>}
          {visible.map(column => <th key={column.id} scope="col" data-column={column.id}
            aria-sort={column.sortable === false ? undefined : sort?.column === column.id ? sort.direction : "none"}>
            {column.sortable === false ? column.label : <SortButton label={column.label}
              {...(sort?.column === column.id ? { direction: sort.direction } : {})} onSort={() => chooseSort(column.id)} />}
          </th>)}
        </tr></thead>
        <tbody>{busy && !rows.length ? Array.from({ length: 5 }, (_, index) => <tr key={index} aria-hidden="true">
          {Array.from({ length: visible.length + (selection ? 1 : 0) }, (_, cell) =>
            <td key={cell}><span class="lf-table-placeholder" /></td>)}
        </tr>) : !shown.length ? <tr><td class="ui-empty lf-table-empty" role="status"
          colSpan={Math.max(1, visible.length + (selection ? 1 : 0))}>조건에 맞는 항목이 없습니다.</td></tr> : shown.map(row => {
          const id = rowId(row), checked = selection?.ids.includes(id) ?? false;
          return <TableRow key={id} id={id} selected={selectedId === id || checked}
            aria-selected={selection ? checked : undefined}
            {...(onRowOpen ? { onOpen: (target: HTMLTableRowElement) => onRowOpen(row, target) } : {})}>
            {selection && <td class="lf-table-select"><RowCheckbox label={`${id} 선택`} checked={checked}
              onChange={next => selection.onChange(next ? [...selection.ids, id] : selection.ids.filter(value => value !== id))} /></td>}
            {visible.map(column => <td key={column.id} data-column={column.id}>
              {column.render ? column.render(row) : column.value(row) ?? "미측정"}
            </td>)}
          </TableRow>;
        })}</tbody>
      </table>
    </div>
    {busy && <p class="lf-table-loading" role="status">받은 범위를 불러오는 중입니다.</p>}
    {page && <TablePagination {...page} index={index} total={rows.length} busy={busy} />}
  </section>;
}
