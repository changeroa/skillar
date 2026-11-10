import { IconButton } from "../controls/buttons";
import { Select } from "../controls/fields";
import { tableStyles } from "./styles";

export type TablePage = {
  readonly index: number;
  readonly size: number;
  readonly total: number;
  readonly onChange: (page: { readonly index: number; readonly size: number }) => void;
};

/** Pagination covers the caller's supplied range, not an unrequested server total. */
export function TablePagination({ index, size, total, onChange, busy = false }: TablePage & { readonly busy?: boolean }) {
  tableStyles();
  const count = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, index), count - 1);
  const options = [...new Set([10, 20, 30, 40, 50, size])].sort((a, b) => a - b);
  return <nav class="lf-table-pagination" aria-label="표 페이지" aria-busy={busy}>
    <span class="lf-table-total" role="status">받은 범위 {total}개</span>
    <Select label="페이지당 행" value={String(size)} disabled={busy}
      options={options.map(value => ({ value: String(value), label: String(value) }))}
      onChange={event => onChange({ index: 0, size: Number(event.currentTarget.value) })} />
    <span class="lf-table-page" aria-live="polite">{current + 1} / {count} 페이지</span>
    <span class="lf-table-page-actions">
      <IconButton label="처음" icon="chevronsLeft" variant="outline" disabled={busy || current === 0} onClick={() => onChange({ index: 0, size })} />
      <IconButton label="이전" icon="chevronLeft" variant="outline" disabled={busy || current === 0} onClick={() => onChange({ index: current - 1, size })} />
      <IconButton label="다음" icon="chevronRight" variant="outline" disabled={busy || current === count - 1} onClick={() => onChange({ index: current + 1, size })} />
      <IconButton label="마지막" icon="chevronsRight" variant="outline" disabled={busy || current === count - 1} onClick={() => onChange({ index: count - 1, size })} />
    </span>
  </nav>;
}
