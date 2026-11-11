import { CHECK_COPY, describeOutcome, nextActions, resultEntries, summarizeOperation } from "./commands";
import type { Submission } from "./commands";

type ItemProps = {
  readonly submission: Submission;
  readonly busy: boolean;
  readonly journalThrough: number;
  readonly sourcesBusy: boolean;
  readonly sourcesLoad: number;
  readonly onRetry: () => void;
  readonly onCheck: () => void;
  readonly onRefresh: () => void;
  readonly onResubmit: () => void;
  readonly onEdit: () => void;
};

export function CommandItem({ submission, busy, journalThrough, sourcesBusy, sourcesLoad, onRetry, onCheck, onRefresh, onResubmit, onEdit }: ItemProps) {
  const copy = describeOutcome(submission);
  const actions = nextActions(submission, journalThrough, sourcesLoad);
  const outcome = submission.outcome;
  const status = outcome.kind === "tracked" ? outcome.status : null;
  const technical = outcome.kind === "refused" ? outcome.technical : outcome.kind === "tracked" ? outcome.status.error ?? outcome.technical : null;
  const checkNote = outcome.kind === "tracked" && outcome.check !== "ok" ? CHECK_COPY[outcome.check] : "";
  const waitingForUpload = actions.refresh && !actions.resubmit && submission.operation !== null && sourcesLoad > submission.sourcesLoad;
  const results = resultEntries(status);
  const titleId = `command-${submission.commandId}`;
  return (
    <li class="command-item" aria-labelledby={titleId}>
      <div class="command-item__head">
        <h4 id={titleId}>{summarizeOperation(submission.operation)}</h4>
        <span class="source__state">{copy.label}</span>
      </div>
      <dl class="account-status command__facts">
        <div><dt>명령 ID</dt><dd><code>{submission.commandId}</code></dd></div>
        <div><dt>기준 리비전</dt><dd>저널 {submission.baseRevision}</dd></div>
        <div data-tone={copy.tone}><dt>상태</dt><dd>{copy.explanation}</dd></div>
        {status !== null && status.sourceRevision !== null && <div><dt>출처 리비전</dt><dd>{status.sourceRevision}</dd></div>}
        {results.map(entry => <div key={entry.key}><dt>결과: {entry.label}</dt><dd><code>{entry.value}</code></dd></div>)}
      </dl>
      {copy.next !== null && <p class="note">{copy.next}</p>}
      {waitingForUpload && (
        <p class="note">출처를 새로 고쳤지만 여기 표시된 리비전은 아직 저널 {journalThrough}입니다. 기기의 다음 업로드를 기다린 뒤 다시 새로 고치세요.</p>
      )}
      {(technical !== null || results.length > 0) && (
        <details class="command-item__technical"><summary>기술 정보</summary>
          {technical !== null && <p><code>{technical}</code></p>}
          {results.length > 0 && <dl class="account-status command__facts">
            {results.map(entry => <div key={entry.key}><dt><code>{entry.key}</code></dt><dd><code>{entry.value}</code></dd></div>)}
          </dl>}
        </details>
      )}
      <div class="cluster command-item__actions">
        {actions.retry && <button class="button secondary" type="button" disabled={busy} onClick={onRetry}>같은 ID로 다시 시도</button>}
        {actions.check && <button class="button secondary" type="button" disabled={busy} onClick={onCheck}>상태 확인</button>}
        {actions.refresh && <button class="button secondary" type="button" disabled={sourcesBusy} onClick={onRefresh}>출처 새로 고침</button>}
        {actions.resubmit && (
          <button class="button secondary" type="button" disabled={busy} onClick={onResubmit}>저널 {journalThrough} 기준으로 다시 제출</button>
        )}
        {actions.edit && <button class="button secondary" type="button" onClick={onEdit}>입력란에서 편집</button>}
        <span class="note" role="status" aria-live="polite">{busy ? "처리 중\u2026" : checkNote}</span>
      </div>
    </li>
  );
}
