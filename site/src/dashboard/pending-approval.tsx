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
        <div><dt>요청 권한</dt><dd>{summary.scopes.join(", ")}</dd></div>
        <div><dt>요청 만료</dt><dd>{formatExpires(summary.expiresAt)}까지</dd></div>
      </dl>
      <form className="consent" onSubmit={submit}>
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
        <button className="button button--primary" type="submit" disabled={busy || managedBlocked}>
          {busy ? "승인하는 중…" : "연결 승인"}
        </button>
      </form>
    </section>
  );
}
