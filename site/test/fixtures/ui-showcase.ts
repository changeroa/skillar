import "../../src/style.css";
import "../../src/ui/ui.css";
import { h, render } from "preact";
import { useRef, useState } from "preact/hooks";
import { BarChart, LineChart, DataTable, FacetPanel, KeyValueGrid, NumberTile, PeekPanel,
  Pill, SegmentedTabs, Skeleton, Toast, usePeekSelection } from "../../src/ui/index.ts";

function Showcase() {
  const [selected, select] = usePeekSelection();
  const opener = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState("");
  const [facets, setFacets] = useState<Readonly<Record<string, readonly string[]>>>({});
  const data = { labels: ["월", "화", "수"], series: [
    { label: "읽기", values: [0, 7, 3] }, { label: "검색", values: [3, 14, 2] }] };
  return h("main", { style: { padding: "24px", display: "grid", gap: "24px", maxWidth: "960px", margin: "auto" } },
    h("h1", { style: { fontSize: "28px" } }, "공유 컴포넌트"),
    h("p", { class: "note" }, "합성 데이터 · 시각 검증 전용"),
    h("div", { class: "cluster" },
      h(Pill, { children: "호스팅" }), h(Pill, { tone: "success", children: "완료" }),
      h("button", { id: "showcase-open", ref: opener, class: "button secondary", type: "button", onClick: () => select("fixture") }, "상세 열기")),
    h(NumberTile, { label: "세션", value: null, note: "기록을 받은 뒤 표시합니다." }),
    h(FacetPanel, { title: "리비전 필터", scope: "현재 표본 3개", groups: [
      { id: "revision", label: "리비전", values: [{ id: "1", label: "1개", count: 2 }, { id: "2", label: "2개", count: 1 }] }],
      selected: facets, onChange: (id, values) => setFacets(previous => ({ ...previous, [id]: values })) }),
    h(DataTable, { caption: "합성 스킬", rows: [{ id: "a", name: "구조 검토", revision: 2 },
      { id: "b", name: "코드 검토", revision: 1 }, { id: "c", name: "배포 점검", revision: 1 }],
      columns: [{ id: "name", label: "이름", value: (row: { name: string }) => row.name },
        { id: "revision", label: "리비전", value: (row: { revision: number }) => row.revision }],
      rowId: (row: { id: string }) => row.id }),
    h(KeyValueGrid, { entries: [{ label: "현재 리비전", value: "r2" },
      { label: "digest", value: "0123456789abcdef".repeat(4) }] }),
    h(SegmentedTabs, { id: "showcase", label: "표현", tabs: [
      { id: "preview", label: "요약", content: "같은 기록을 읽기 쉬운 형태로 표시합니다." },
      { id: "raw", label: "원문", content: h("code", null, '{"revision":2}') }] }),
    h(BarChart, { title: "요청 수 · 합성 데이터", data }),
    h(LineChart, { title: "요청 추이 · 합성 데이터", data }),
    h(BarChart, { title: "읽기 기록", data: { labels: [], series: [] } }),
    h(Skeleton, { rows: 3 }),
    h("button", { id: "showcase-toast", class: "button secondary", type: "button", onClick: () => setNotice("복사했습니다.") }, "피드백 표시"),
    h(Toast, { message: notice, onDismiss: () => setNotice("") }),
    h(PeekPanel, { id: "showcase-peek", selectedId: selected, title: "스킬 상세",
      fullPageHref: "/skills/", returnFocus: opener.current, onClose: () => select(null),
      children: h(KeyValueGrid, { entries: [{ label: "선택", value: selected }, { label: "리비전", value: "r2" }] }) }));
}

const root = document.getElementById("showcase");
if (root) render(h(Showcase, null), root);
