import type { Operation, OperationSummary, RequestRecord, RequestSummary, SearchResult } from "../../src/request-status.js";
import { STATE_LABEL } from "../state";
import { Icon } from "./icons";

const OPERATION_LABEL: Record<Operation, string> = { search: "검색", load: "읽기" };
const RESULT_LABEL: Record<SearchResult, string> = { candidates_found: "후보 있음", no_candidates: "후보 없음" };

// 아이콘만 남는 상태는 aria-label과 같은 문구의 툴팁을 함께 둔다(inbox85). 상태는 색과
// 모양을 함께 쓴다: 성공=circle-check 초록, 요청 없음=minus 회색. 기존 색 점(badge::before)은
// 이 두 상태에서 제거한다.
export function OperationCounts({ summary }: { summary?: OperationSummary }) {
  if (!summary) return <span className="dim">{STATE_LABEL.unknown}</span>;
  if (!summary.total) return <span className="state-icon dim" role="img" aria-label={STATE_LABEL.not_attempted}
    title={STATE_LABEL.not_attempted}><Icon name="minus" size={16} /></span>;
  return <span className="request-counts">
    {(Object.entries(summary.counts) as [RequestRecord["status"], number][]).filter(([, count]) => count > 0).map(([status, count]) =>
      status === "succeeded"
        ? <span className="state-pill state-pill--succeeded" key={status} role="img"
            aria-label={`${STATE_LABEL[status]} ${count}`} title={`${STATE_LABEL[status]} ${count}`}>
            <Icon name="circle-check" size={16} />{count}</span>
        : <span className={`badge badge--${status}`} key={status}>{STATE_LABEL[status]} {count}</span>)}
    {(Object.entries(summary.results) as [SearchResult, number][]).filter(([, count]) => count > 0).map(([result, count]) =>
      result === "candidates_found"
        ? <span className="state-pill state-pill--candidates" key={result} role="img"
            aria-label={`${RESULT_LABEL[result]} ${count}`} title={`${RESULT_LABEL[result]} ${count}`}>
            <Icon name="list" size={16} />{count}</span>
        : <span className="dim" key={result}>{RESULT_LABEL[result]} {count}</span>)}
  </span>;
}

export function RequestCounts({ summary }: { summary?: RequestSummary }) {
  return <div className="request-summary">
    <div><strong>{OPERATION_LABEL.search}</strong> <OperationCounts summary={summary?.search} /></div>
    <div><strong>{OPERATION_LABEL.load}</strong> <OperationCounts summary={summary?.load} /></div>
  </div>;
}
