import { useState } from "preact/hooks";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import type { ContentKind } from "../../../shared/dist/activity-schema.js";
import { describeFailure, isUnauthorized, writeConsent } from "./api";
import type { ConsentState } from "./api";
import {
  CONTENT_KINDS, CONTENT_KIND_COPY, DEFAULT_RETENTION_DAYS, MAX_BACKUP_DAYS, buildConsent, draftFromConsent, isExactMilliseconds, projectIdFor,
} from "./consent";
import type { BackfillDraft, ConsentDraft, ConsentMode } from "./consent";
import { Radio } from "../../../local/dashboard/foundation/controls/choices";
import { DateRangeFields } from "../../../local/dashboard/foundation/controls/date-range";

type Props = {
  readonly deviceId: string;
  readonly version: number;
  readonly consent: Consent;
  readonly signal: AbortSignal;
  readonly onSaved: (next: ConsentState) => void;
  readonly onUnauthorized: () => void;
};

const MODES: readonly { readonly value: ConsentMode; readonly label: string; readonly detail: string }[] = [
  { value: "local-only", label: "로컬 전용", detail: "기본값입니다. 활동은 기기에 남고 아무것도 업로드하지 않습니다." },
  { value: "metadata", label: "메타데이터만", detail: "세션 시각, 실행 환경 이름, 이벤트 종류만 업로드합니다. 프롬프트, 검색어, 인자, 경로, 스킬 본문은 포함하지 않습니다." },
  { value: "managed-content", label: "메타데이터와 선택한 내용", detail: "아래에서 체크한 내용 범주만 추가합니다. 이 페이지의 보고서에는 일곱 가지가 모두 필요합니다." },
];

function NumberField({ label, value, min, max, disabled = false, onInput }: {
  readonly label: string; readonly value: string; readonly min: number; readonly max?: number;
  readonly disabled?: boolean;
  readonly onInput: (next: string) => void;
}) {
  return (
    <label class="field-label">{label}
      <input class="text-field" type="number" disabled={disabled} inputMode="numeric" min={min} {...(max === undefined ? {} : { max })}
        value={value} onInput={event => onInput(event.currentTarget.value)} />
    </label>
  );
}

export function ConsentForm({ deviceId, version, consent, signal, onSaved, onUnauthorized }: Props) {
  const [draft, setDraft] = useState<ConsentDraft>(() => draftFromConsent(consent));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<ConsentDraft>) => setDraft(current => ({ ...current, ...next }));
  const patchBackfill = (next: Partial<BackfillDraft>) =>
    setDraft(current => ({ ...current, backfill: { ...current.backfill, ...next } }));
  const toggleKind = (kind: ContentKind, checked: boolean) => setDraft(current => ({
    ...current, kinds: checked ? [...current.kinds.filter(k => k !== kind), kind] : current.kinds.filter(k => k !== kind),
  }));
  const id = (name: string) => `consent-${deviceId}-${name}`;
  const uploads = draft.mode !== "local-only";

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    const built = buildConsent(draft, deviceId, version, Date.now());
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    setMessage("동의를 저장하는 중\u2026");
    try {
      const saved = await writeConsent(deviceId, version, built.consent, signal);
      setMessage(`동의를 저장했습니다 (버전 ${saved.version}).`);
      onSaved(saved);
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setMessage(describeFailure(error, "동의 저장"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="consent" onSubmit={submit} aria-describedby={id("scope")}>
      <fieldset class="consent__group" disabled={busy}>
        <legend>이 기기가 업로드할 수 있는 것</legend>
        {MODES.map(mode => (
          <div key={mode.value}>
            <Radio label={mode.label} name={id("mode")} value={mode.value} checked={draft.mode === mode.value}
              aria-describedby={id(`mode-${mode.value}-detail`)} onChange={() => patch({ mode: mode.value })} />
            <p class="choice__detail" id={id(`mode-${mode.value}-detail`)}>{mode.detail}</p>
          </div>
        ))}
      </fieldset>
      {draft.mode === "managed-content" && (
        <fieldset class="consent__group" disabled={busy}>
          <legend>내용 범주</legend>
          <p class="note">여기에서 체크한 범주만 업로드됩니다. 저장된 동의가 있으면 해당 선택을 표시합니다.</p>
          {CONTENT_KINDS.map(kind => (
            <label class="choice" key={kind}>
              <input type="checkbox" checked={draft.kinds.includes(kind)}
                onChange={event => toggleKind(kind, event.currentTarget.checked)} />
              <span><strong>{CONTENT_KIND_COPY[kind].label}</strong><span class="choice__detail">{CONTENT_KIND_COPY[kind].detail}</span></span>
            </label>
          ))}
          <label class="choice choice--ack">
            <input type="checkbox" checked={draft.serverProcessing}
              onChange={event => patch({ serverProcessing: event.currentTarget.checked })} />
            <span>
              <strong>skillar 서버가 체크한 내용을 읽고 처리해 보고서를 만들 수 있습니다.</strong>
              <span class="choice__detail">내용을 업로드하려면 반드시 필요합니다. 내용은 외부 모델로 전송되지 않습니다.</span>
            </span>
          </label>
        </fieldset>
      )}
      {uploads && (
        <fieldset class="consent__group" disabled={busy}>
          <legend>보존 기간</legend>
          <div class="consent__fields">
            <NumberField label="내용 보존 기간(일)" value={draft.contentDays} min={1} onInput={contentDays => patch({ contentDays })} />
            <NumberField label="보고서 보존 기간(일)" value={draft.projectionDays} min={1} onInput={projectionDays => patch({ projectionDays })} />
            <NumberField label={`백업 사본 보존 기간(일, 최대 ${MAX_BACKUP_DAYS})`} value={draft.backupDays} min={0} max={MAX_BACKUP_DAYS}
              onInput={backupDays => patch({ backupDays })} />
          </div>
          <p class="note">기본값은 {DEFAULT_RETENTION_DAYS}일입니다. 보존 기간이 길수록 데이터가 서버에 더 오래 남으며, 백업은 {MAX_BACKUP_DAYS}일을 넘지 않습니다.</p>
        </fieldset>
      )}
      {uploads && (
        <details class="consent__history" open={draft.backfill.enabled}>
          <summary>준비된 과거 스냅샷 포함(선택 사항)</summary>
          <p class="note">기기에서 <code>skillar sync prepare</code>를 실행하고 출력된 스냅샷 ID와 저널 컷을 복사하세요. 정확히 그 스냅샷, 컷, 범위만 과거 기록으로 업로드할 수 있습니다.</p>
          <label class="choice">
            <input type="checkbox" disabled={busy} checked={draft.backfill.enabled} onChange={event => patchBackfill({ enabled: event.currentTarget.checked })} />
            <span><strong>준비된 스냅샷 하나 허용</strong></span>
          </label>
          {draft.backfill.enabled && (
            <>
              <div class="consent__fields">
              <label class="field-label">스냅샷 ID
                <input class="text-field" type="text" disabled={busy} autocomplete="off" spellcheck={false} value={draft.backfill.snapshotId}
                  onInput={event => patchBackfill({ snapshotId: event.currentTarget.value })} />
              </label>
              <NumberField label="저널 컷" disabled={busy} value={draft.backfill.journalCut} min={0} onInput={journalCut => patchBackfill({ journalCut })} />
              <NumberField label="매니페스트 버전" disabled={busy} value={draft.backfill.version} min={1} onInput={backfillVersion => patchBackfill({ version: backfillVersion })} />
              </div>
              <label class="choice">
                <input type="checkbox" disabled={busy} checked={draft.backfill.allHistory}
                  onChange={event => patchBackfill({ allHistory: event.currentTarget.checked })} />
                <span><strong>이 준비된 스냅샷의 모든 과거 기록 허용</strong>
                  <span class="choice__detail">바로 이 스냅샷에 기록된 모든 날짜를 포함합니다. 날짜 범위를 직접 고르려면 체크하지 마세요.</span>
                </span>
              </label>
              {!draft.backfill.allHistory && <div class="consent__fields">
              <DateRangeFields value={{ from: draft.backfill.from, to: draft.backfill.to }} onChange={patchBackfill}
                disabled={busy} fromLabel="과거 기록 시작" toLabel="과거 기록 끝"
                fromType={isExactMilliseconds(draft.backfill.from) ? "text" : "datetime-local"}
                toType={isExactMilliseconds(draft.backfill.to) ? "text" : "datetime-local"} />
              </div>}
            </>
          )}
          {draft.backfill.enabled && !draft.backfill.allHistory && (isExactMilliseconds(draft.backfill.from) || isExactMilliseconds(draft.backfill.to)) && (
            <p class="note">달력 선택기로 정확히 나타낼 수 없는 경계는 1970년 기준 밀리초 값으로 표시되며 그대로 저장됩니다.</p>
          )}
        </details>
      )}
      <p class="note" id={id("scope")}>
        범위: 이 기기만({projectIdFor(deviceId)}), 모든 프로젝트, 루트 제한 없음. 저장하면 버전 {version} 대신 버전 {version + 1} 동의가 기록됩니다.
      </p>
      {problems.length > 0 && (
        <ul class="problems" role="alert">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
      )}
      <div class="cluster">
        <button class="button primary" type="submit" disabled={busy}>동의 저장</button>
        <span class="note" role="status" aria-live="polite">{message}</span>
      </div>
    </form>
  );
}
