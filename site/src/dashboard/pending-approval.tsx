import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { approvePending, describeFailure, readPending } from "./api";
import type { PendingConsentChoice, PendingSummary } from "./api";
import { CONTENT_KINDS, CONTENT_KIND_COPY } from "./consent";
import { Radio } from "../../../local/dashboard/foundation/controls/choices";

const sessionSchema = z.object({ user: z.object({ name: z.string(), email: z.string() }) });

type Mode = "local-only" | "metadata" | "managed-content";
type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly summary: PendingSummary; readonly account: string }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string };

const MODES: readonly { readonly value: Mode; readonly label: string; readonly detail: string }[] = [
  { value: "local-only", label: "로컬 전용", detail: "기본값입니다. 활동은 기기에 남고 아무것도 업로드하지 않습니다." },
  { value: "metadata", label: "메타데이터만", detail: "세션 시각, 실행 환경 이름, 이벤트 종류만 업로드합니다. 프롬프트, 검색어, 인자, 경로, 스킬 본문은 포함하지 않습니다." },
  { value: "managed-content", label: "메타데이터와 전체 내용", detail: "아래 일곱 가지 범주를 모두 업로드합니다. 사이트의 보고서 전체를 쓰려면 필요하지만, 업로드 자체는 선택 사항입니다." },
];

/** 요청 권한을 사람이 읽는 말로. 업로드 동의(아래 라디오)와는 별개의 기기 권한이다. */
const SCOPE_COPY: Readonly<Record<string, { readonly label: string; readonly detail: (upgrade: boolean) => string }>> = {
  "activity:read": { label: "활동 기록 읽기", detail: () => "이 기기가 내 활동 기록과 대시보드 데이터를 읽습니다." },
  // upgrade에는 동의 선택이 없으므로(기존 동의 유지) 안내도 그 상태에 맞춘다.
  "activity:ingest": { label: "활동 기록 보내기", detail: upgrade => upgrade
    ? "이 기기의 기존 업로드 동의가 그대로 적용됩니다."
    : "이 기기가 활동 기록을 보낼 수 있는 경로입니다. 실제 업로드는 아래 동의를 켤 때만 시작됩니다." },
  "skills:read": { label: "비공개 스킬 읽기", detail: () => "이 기기가 내 비공개 스킬을 내려받습니다." },
  "skills:write": { label: "비공개 스킬 게시", detail: () => "이 기기가 내 비공개 스킬을 올립니다. 게시할 때마다 CLI에서 명시적으로 확인합니다." },
};

function formatExpires(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * 승인 페이지: CLI가 띄운 연결 요청을 이 브라우저 세션으로 승인한다.
 * 업로드 동의는 항상 기본 해제이며, 실제 동의 기록은 이 페이지의 명시적 제출로만 생긴다.
 * 토큰 등 비밀 값은 화면에 표시하지 않는다(CLI의 폴링이 가져간다).
 */
export function PendingApproval({ code }: { readonly code: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [mode, setMode] = useState<Mode>("local-only");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    const session = fetch("/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        const parsed = sessionSchema.safeParse(body);
        const user = parsed.success ? parsed.data.user : null;
        return user === null ? "확인할 수 없음" :
          user.name === "" ? user.email : `${user.name} (${user.email})`;
      })
      .catch(() => "확인할 수 없음");
    Promise.all([readPending(code), session])
      .then(([summary, account]) => { if (!cancelled.current) setPhase({ kind: "ready", summary, account }); })
      .catch(() => { if (!cancelled.current) setPhase({ kind: "missing" }); });
    return () => { cancelled.current = true; };
  }, [code]);

  if (phase.kind === "loading") {
    return <section className="panel" aria-label="CLI 연결 요청"><h2>CLI 연결 요청</h2><p className="note">요청을 확인하는 중…</p></section>;
  }
  if (phase.kind === "missing") {
    return (
      <section className="panel" aria-label="CLI 연결 요청">
        <h2>CLI 연결 요청</h2>
        <p className="note">이 연결 요청을 찾을 수 없거나 이미 만료됐습니다. CLI에서 다시 시작해 새 코드를 받으세요.</p>
      </section>
    );
  }
  if (phase.kind === "done") {
    return (
      <section className="panel" aria-label="CLI 연결 요청">
        <h2>CLI 연결 요청</h2>
        <p>연결이 완료됐습니다. CLI로 돌아가세요. 이 페이지는 닫아도 됩니다.</p>
      </section>
    );
  }
  if (phase.kind === "failed") {
    return (
      <section className="panel" aria-label="CLI 연결 요청">
        <h2>CLI 연결 요청</h2>
        <p className="note" role="alert">{phase.message} 목록을 새로고침해 상태를 확인하세요.</p>
      </section>
    );
  }

  const { summary, account } = phase;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const consent: PendingConsentChoice | undefined =
        mode === "local-only" ? undefined :
        mode === "metadata" ? { mode: "metadata" } :
        { mode: "managed-content", contentKinds: [...CONTENT_KINDS], serverProcessingAcknowledged: true };
      if (mode === "managed-content" && !acknowledged) return;
      await approvePending(code, consent);
      if (!cancelled.current) setPhase({ kind: "done" });
    } catch (error) {
      if (!cancelled.current) setPhase({ kind: "failed", message: describeFailure(error, "연결 승인") });
    } finally {
      setBusy(false);
    }
  };
  const managedBlocked = mode === "managed-content" && !acknowledged;
  return (
    <section className="panel" aria-label="CLI 연결 요청">
      <h2>CLI 연결 요청</h2>
      <p className="note">지금 로그인한 계정에 이 기기가 연결됩니다. 아래 정보가 CLI 화면에 표시된 내용과 같은지 확인하세요.</p>
      <dl className="pending-summary">
        <div><dt>연결 계정</dt><dd>{account}</dd></div>
        <div><dt>기기</dt><dd>{summary.deviceLabel}</dd></div>
        <div><dt>요청 권한</dt><dd>
          <ul className="pending-scopes">
            {summary.scopes.map(scope => (
              <li key={scope}>
                <strong>{SCOPE_COPY[scope]?.label ?? scope}</strong>
                {SCOPE_COPY[scope] !== undefined &&
                  <span className="choice__detail">{" — "}{SCOPE_COPY[scope].detail(summary.upgrade === true)}</span>}
              </li>
            ))}
          </ul>
        </dd></div>
        <div><dt>요청 만료</dt><dd>{formatExpires(summary.expiresAtMs)}까지</dd></div>
      </dl>
      {summary.upgrade === true && (
        <p className="note">이미 연결된 기기입니다. 목록은 승인 후 이 기기가 가지는 전체 권한이며, 아직 없는 권한만 추가됩니다. 업로드 동의는 바뀌지 않습니다.</p>
      )}
      <form className="consent" onSubmit={submit}>
        {summary.upgrade !== true && summary.scopes.includes("activity:ingest") && (
        <fieldset className="consent__group" disabled={busy}>
          <legend>이 기기가 업로드할 수 있는 것</legend>
          {MODES.map(choice => (
            <div key={choice.value}>
              <Radio label={choice.label} name="pending-consent-mode" value={choice.value} checked={mode === choice.value}
                aria-describedby={`pending-mode-${choice.value}-detail`} onChange={() => setMode(choice.value)} />
              <p className="choice__detail" id={`pending-mode-${choice.value}-detail`}>{choice.detail}</p>
            </div>
          ))}
          {mode === "managed-content" && (
            <ul className="consent__kinds">
              {CONTENT_KINDS.map(kind => (
                <li key={kind}><strong>{CONTENT_KIND_COPY[kind].label}</strong>{" — "}
                  <span className="choice__detail">{CONTENT_KIND_COPY[kind].detail}</span></li>
              ))}
            </ul>
          )}
          {mode === "managed-content" && (
            <label className="choice choice--ack">
              <input type="checkbox" checked={acknowledged}
                onChange={event => setAcknowledged(event.currentTarget.checked)} />
              <span>
                <strong>skillar 서버가 체크한 내용을 읽고 처리해 보고서를 만들 수 있습니다.</strong>
                <span className="choice__detail">내용을 업로드하려면 반드시 필요합니다. 내용은 외부 모델로 전송되지 않습니다.</span>
              </span>
            </label>
          )}
        </fieldset>
        )}
        <button className="button button--primary" type="submit" disabled={busy || managedBlocked}>
          {busy ? "승인하는 중…" : summary.upgrade === true ? "권한 추가 승인" : "연결 승인"}
        </button>
      </form>
    </section>
  );
}
