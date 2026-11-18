import type { Operation, OperationSummary, RequestRecord, RequestSummary, SearchResult } from "../../src/request-status.js";
import { STATE_LABEL } from "../state";

const OPERATION_LABEL: Record<Operation, string> = { search: "검색", load: "읽기" };
const RESULT_LABEL: Record<SearchResult, string> = { candidates_found: "후보 있음", no_candidates: "후보 없음" };

export function OperationCounts({ summary }: { summary?: OperationSummary }) {
  if (!summary) return <span className="dim">{STATE_LABEL.unknown}</span>;
  if (!summary.total) return <span className="dim" title="수집된 기록에서 관찰된 요청이 없습니다">{STATE_LABEL.not_attempted}</span>;
  return <span className="request-counts">
    {(Object.entries(summary.counts) as [RequestRecord["status"], number][]).filter(([, count]) => count > 0).map(([status, count]) =>
      <span className={`badge badge--${status}`} key={status}>{STATE_LABEL[status]} {count}</span>)}
    {(Object.entries(summary.results) as [SearchResult, number][]).filter(([, count]) => count > 0).map(([result, count]) =>
      <span className="dim" key={result}>{RESULT_LABEL[result]} {count}</span>)}
  </span>;
}

export function RequestCounts({ summary }: { summary?: RequestSummary }) {
  return <div className="request-summary">
    <div><strong>{OPERATION_LABEL.search}</strong> <OperationCounts summary={summary?.search} /></div>
    <div><strong>{OPERATION_LABEL.load}</strong> <OperationCounts summary={summary?.load} /></div>
  </div>;
}
