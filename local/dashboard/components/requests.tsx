import { useState } from "preact/hooks";
import type { Operation, OperationSummary, RequestRecord, RequestSummary, SearchResult } from "../../src/request-status.js";
import { requestRecords } from "../../src/request-status.js";
import type { TraceStep } from "../../src/types.js";
import { STATE_LABEL } from "../state";

const OPERATION_LABEL: Record<Operation, string> = { search: "검색", load: "읽기" };
const RESULT_LABEL: Record<SearchResult, string> = { candidates_found: "후보 있음", no_candidates: "후보 없음" };

export function OperationCounts({ summary }: { summary?: OperationSummary }) {
  if (!summary) return <span class="dim">{STATE_LABEL.unknown}</span>;
  if (!summary.total) return <span class="dim" title="수집된 기록에서 관찰된 요청이 없습니다">{STATE_LABEL.not_attempted}</span>;
  return <span class="request-counts">
    {(Object.entries(summary.counts) as [RequestRecord["status"], number][]).filter(([, count]) => count > 0).map(([status, count]) =>
      <span class={`badge badge--${status}`} key={status}>{STATE_LABEL[status]} {count}</span>)}
    {(Object.entries(summary.results) as [SearchResult, number][]).filter(([, count]) => count > 0).map(([result, count]) =>
      <span class="dim" key={result}>{RESULT_LABEL[result]} {count}</span>)}
  </span>;
}

export function RequestCounts({ summary }: { summary?: RequestSummary }) {
  return <div class="request-summary">
    <div><strong>{OPERATION_LABEL.search}</strong> <OperationCounts summary={summary?.search} /></div>
    <div><strong>{OPERATION_LABEL.load}</strong> <OperationCounts summary={summary?.load} /></div>
  </div>;
}

export function RequestDetails({ steps }: { steps: TraceStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const active = new Set(steps.filter((s) => s.detail.currentStatus === "in_progress").map((s) => String(s.detail.requestId)));
  const records = requestRecords(steps.map((step, i) => ({ id: `trace-${i}`, ts: step.ts, kind: step.kind, data: step.detail,
    ...(typeof step.detail.uri === "string" ? { skillUri: step.detail.uri } : {}) })), active);
  if (!records.length) return null;
  return <section class="card request-details" aria-label="검색 및 읽기 요청">
    <h2>검색 및 읽기 요청</h2>
    <p class="dim">한 줄이 요청 하나입니다. 재시도는 따로 셉니다. '알 수 없음'은 결과가 관찰되지 않았다는 뜻이며, 실패를 뜻하지 않습니다.</p>
    <table><thead><tr><th scope="col">작업</th><th scope="col">상태</th><th scope="col">결과 / 사유</th><th scope="col">스킬</th></tr></thead>
      <tbody>{(expanded ? records : records.slice(0, 20)).map((r) => <tr key={r.id}>
        <td data-label="작업">{OPERATION_LABEL[r.operation]}</td><td data-label="상태"><span class={`badge badge--${r.status}`}>{STATE_LABEL[r.status]}</span></td>
        <td data-label="결과 / 사유">{[r.result && RESULT_LABEL[r.result], r.reason, r.errorCode].filter(Boolean).join(" · ") || "—"}</td><td data-label="스킬">{r.uri ?? "—"}</td>
      </tr>)}</tbody></table>
    {records.length > 20 && <button type="button" class="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "요청 접기" : `요청 ${records.length}건 모두 보기`}</button>}
  </section>;
}
