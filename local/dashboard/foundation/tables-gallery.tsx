import { useState } from "preact/hooks";
import { DataTable } from "./table/data-table";
import { TableFacet } from "./table/facets";
import { TablePagination } from "./table/pagination";
import { Button } from "./controls/buttons";
import { SearchInput } from "./controls/fields";

const records = Array.from({ length: 23 }, (_, index) => ({
  id: `example-${index + 1}`, name: `세션 ${index + 1}`, started: `2026-11-10 17:${String(index).padStart(2, "0")}:44`,
  runtime: index % 2 ? "Claude Code" : "Codex",
}));
const columns = [
  { id: "started", label: "Start Time", hideable: false, value: (row: typeof records[number]) => row.started },
  { id: "name", label: "Name", value: (row: typeof records[number]) => row.name },
  { id: "runtime", label: "Runtime", value: (row: typeof records[number]) => row.runtime },
] as const;

export function TablesGallery() {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [facets, setFacets] = useState<readonly string[]>([]);
  const [page, setPage] = useState({ index: 0, size: 10 });
  const [opened, setOpened] = useState("");
  const rows = records.filter(row => row.name.includes(filter) && (!facets.length || facets.includes(row.runtime)));
  return <section data-component="Tables" aria-labelledby="tables-title">
    <h2 id="tables-title">데이터 표</h2>
    <p>수신 범위 정렬, 선택, 밀도, 열 표시, 필터와 페이지. 변경은 이 예시에만 적용됩니다.</p>
    <div class="lf-tables-gallery">
      <aside class="lf-facet-panel" data-component="FacetPanel" aria-label="예시 필터">
        <TableFacet label="실행 환경" choices={[
          { value: "Codex", label: "Codex", count: 12 }, { value: "Claude Code", label: "Claude Code", count: 11 },
          { value: "Gemini", label: "Gemini", count: 0 },
        ]} selected={facets} change={next => { setFacets(next ?? []); setPage({ ...page, index: 0 }); }} />
      </aside>
      <div data-component="DataTable">
        <DataTable caption="예시 세션 · 받은 범위" rows={rows} columns={columns} rowId={row => row.id}
          initialSort={{ column: "started", direction: "descending" }}
          selection={{ ids, onChange: setIds }} onRowOpen={row => setOpened(row.id)}
          selectedId={opened} page={{ ...page, total: rows.length, onChange: setPage }}
          toolbar={<>
            <SearchInput label="예시 세션 검색" value={query} onChange={setQuery}
              onSubmit={value => { setFilter(value); setPage({ ...page, index: 0 }); }} />
            <Button text="필터 해제" variant="outline" onClick={() => { setQuery(""); setFilter(""); setFacets([]); }} />
          </>} />
        <output aria-live="polite">{ids.length}개 선택{opened ? ` · ${opened} 열림` : ""}</output>
      </div>
    </div>
    <div data-component="EmptyTable"><DataTable caption="빈 범위" rows={[]} columns={columns} rowId={row => row.id} /></div>
    <div data-component="LoadingTable"><DataTable caption="범위 읽기" rows={[]} columns={columns} rowId={row => row.id} busy controls={false} /></div>
    <div data-component="LoadingPagination"><TablePagination index={0} size={10} total={23} busy onChange={() => {}} /></div>
    <div data-component="EmptyPagination"><TablePagination index={0} size={10} total={0} onChange={() => {}} /></div>
  </section>;
}
