import { useState } from "preact/hooks";
import type { OperationSummary, RequestSummary } from "../../src/request-status.js";
import { requestRecords } from "../../src/request-status.js";
import type { TraceStep } from "../../src/types.js";

export function OperationCounts({ summary }: { summary?: OperationSummary }) {
  if (!summary) return <span class="dim">unknown</span>;
  if (!summary.total) return <span class="dim" title="No request observed in the captured history">not_attempted</span>;
  return <span class="request-counts">
    {Object.entries(summary.counts).filter(([, count]) => count > 0).map(([status, count]) =>
      <span class={`badge badge--${status}`} key={status}>{status} {count}</span>)}
    {Object.entries(summary.results).filter(([, count]) => count > 0).map(([result, count]) =>
      <span class="dim" key={result}>{result} {count}</span>)}
  </span>;
}

export function RequestCounts({ summary }: { summary?: RequestSummary }) {
  return <div class="request-summary">
    <div><strong>Search</strong> <OperationCounts summary={summary?.search} /></div>
    <div><strong>Load</strong> <OperationCounts summary={summary?.load} /></div>
  </div>;
}

export function RequestDetails({ steps }: { steps: TraceStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const active = new Set(steps.filter((s) => s.detail.currentStatus === "in_progress").map((s) => String(s.detail.requestId)));
  const records = requestRecords(steps.map((step, i) => ({ id: `trace-${i}`, ts: step.ts, kind: step.kind, data: step.detail,
    ...(typeof step.detail.uri === "string" ? { skillUri: step.detail.uri } : {}) })), active);
  if (!records.length) return null;
  return <section class="card request-details" aria-label="Search and load requests">
    <h2>Search and load requests</h2>
    <p class="dim">Each row is one request. Retries count separately. unknown means the outcome was not observed; it does not mean failure.</p>
    <table><thead><tr><th scope="col">Operation</th><th scope="col">Status</th><th scope="col">Result / reason</th><th scope="col">Skill</th></tr></thead>
      <tbody>{(expanded ? records : records.slice(0, 20)).map((r) => <tr key={r.id}>
        <td data-label="Operation">{r.operation}</td><td data-label="Status"><span class={`badge badge--${r.status}`}>{r.status}</span></td>
        <td data-label="Result / reason">{[r.result, r.reason, r.errorCode].filter(Boolean).join(" · ") || "—"}</td><td data-label="Skill">{r.uri ?? "—"}</td>
      </tr>)}</tbody></table>
    {records.length > 20 && <button type="button" class="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer requests" : `Show all ${records.length} requests`}</button>}
  </section>;
}
