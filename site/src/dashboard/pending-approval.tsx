import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { approvePending, describeFailure, readPending } from "./api";
import type { PendingConsentChoice, PendingSummary } from "./api";
import { CONTENT_KINDS, CONTENT_KIND_COPY } from "./consent";
import type { ContentKind } from "../../../shared/dist/activity-schema.js";
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
  { value: "managed-content", label: "메타데이터와 선택한 내용", detail: "아래에서 체크한 내용 범주만 추가로 업로드합니다." },
];

/** 요청 권한을 사람이 읽는 말로. 업로드 동의(아래 체크박스)와는 별개의 기기 권한이다. */
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
 * 기본 보기는 계정·기기 요약 + "세션 기록 업로드" 체크박스 하나다. 체크는
 * managed-content 일곱 범주 전체 + 서버 처리 확인을 한 번에 뜻한다(체크 자체가
 * 확인). 메타데이터만·종류별 선택은 "자세히 설정" 안에 있다.
 * CLI가 ?upload=1로 열었으면 체크된 상태로 시작하지만, 실제 동의 기록은
 * 어느 경우든 이 페이지에서 내용을 보고 승인 버튼을 누르는 명시적 제출뿐이다.
 * 토큰 등 비밀 값은 화면에 표시하지 않는다(CLI의 폴링이 가져간다).
 */
export function PendingApproval({ code, uploadPreset = false }: { readonly code: string; readonly uploadPreset?: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [mode, setMode] = useState<Mode>(uploadPreset ? "managed-content" : "local-only");
  const [kinds, setKinds] = useState<readonly ContentKind[]>(CONTENT_KINDS);
  const [acknowledged, setAcknowledged] = useState(uploadPreset);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  // The master checkbox has three states: on (the whole grant: managed-content
  // with every content kind plus the server-processing acknowledgment), off
  // (local-only) and mixed (anything narrower, chosen under 자세히 설정).
  const uploadAll = mode === "managed-content" && kinds.length === CONTENT_KINDS.length && acknowledged;
  const partial = !uploadAll && mode !== "local-only";
  const masterRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (masterRef.current !== null) masterRef.current.indeterminate = partial; }, [partial]);
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
  // Master clicks only ever settle on or off: off→전체 켜기, 켜짐·부분→끄기.
  // A narrower scope is reachable only under 자세히 설정, never by master click.
  const toggleMaster = () => {
    if (uploadAll || partial) {
      setMode("local-only");
    } else {
      setMode("managed-content");
      setKinds(CONTENT_KINDS);
      setAcknowledged(true);
    }
  };
  const masterDetail = mode === "local-only"
    ? "켜면 프롬프트·검색어·도구 인자·오류·파일 경로·스팬 속성·스킬 본문이 올라갑니다. 외부 모델로 전송하지 않고 30일간 보관합니다."
    : uploadAll
      ? "모든 범주가 켜져 있습니다: 프롬프트·검색어·도구 인자·오류·파일 경로·스팬 속성·스킬 본문이 올라갑니다. 외부 모델로 전송하지 않고 30일간 보관합니다."
      : mode === "metadata"
        ? "메타데이터만 업로드합니다. 세션 시각·실행 환경 이름·이벤트 종류만 올라가고 프롬프트·검색어·인자·경로·스킬 본문은 올라가지 않습니다."
        : kinds.length === 0
          ? "자세히 설정에서 업로드할 내용 범주가 선택되지 않았습니다."
          : !acknowledged
            ? `자세히 설정에서 고른 ${kinds.length}종을 업로드하려면 서버 처리 확인을 켜야 합니다.`
            : `자세히 설정에서 고른 ${kinds.length}종의 내용만 업로드합니다.`;
  const toggleKind = (kind: ContentKind, checked: boolean) =>
    setKinds(current => checked ? [...current.filter(k => k !== kind), kind] : current.filter(k => k !== kind));
  const managedBlocked = mode === "managed-content" && (!acknowledged || kinds.length === 0);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // 재승인(upgrade)은 동의를 바꾸지 않는다. 서버도 동의 제출을 거절한다.
      const consent: PendingConsentChoice | undefined =
        summary.upgrade === true || mode === "local-only" ? undefined :
        mode === "metadata" ? { mode: "metadata" } :
        { mode: "managed-content", serverProcessingAcknowledged: true,
          contentKinds: CONTENT_KINDS.filter(kind => kinds.includes(kind)) };
      if (consent !== undefined && managedBlocked) return;
      await approvePending(code, consent);
      if (!cancelled.current) setPhase({ kind: "done" });
    } catch (error) {
      if (!cancelled.current) setPhase({ kind: "failed", message: describeFailure(error, "연결 승인") });
    } finally {
      setBusy(false);
    }
  };
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
          <label className="choice">
            <input type="checkbox" ref={masterRef} checked={uploadAll}
              onChange={() => toggleMaster()} />
            <span>
              <strong>세션 기록 업로드</strong>
              <span className="choice__detail">{masterDetail}</span>
            </span>
          </label>
          <details className="consent__advanced">
            <summary>자세히 설정</summary>
            {MODES.map(choice => (
              <div key={choice.value}>
                <Radio label={choice.label} name="pending-consent-mode" value={choice.value} checked={mode === choice.value}
                  aria-describedby={`pending-mode-${choice.value}-detail`} onChange={() => setMode(choice.value)} />
                <p className="choice__detail" id={`pending-mode-${choice.value}-detail`}>{choice.detail}</p>
              </div>
            ))}
            {mode === "managed-content" && (
              <>
                {CONTENT_KINDS.map(kind => (
                  <label className="choice" key={kind}>
                    <input type="checkbox" checked={kinds.includes(kind)}
                      onChange={event => toggleKind(kind, event.currentTarget.checked)} />
                    <span><strong>{CONTENT_KIND_COPY[kind].label}</strong><span className="choice__detail">{CONTENT_KIND_COPY[kind].detail}</span></span>
                  </label>
                ))}
                <label className="choice choice--ack">
                  <input type="checkbox" checked={acknowledged}
                    onChange={event => setAcknowledged(event.currentTarget.checked)} />
                  <span>
                    <strong>skillar 서버가 업로드된 내용을 읽고 처리할 수 있습니다.</strong>
                    <span className="choice__detail">내용을 업로드하려면 반드시 필요합니다. 내용은 외부 모델로 전송되지 않습니다.</span>
                  </span>
                </label>
                {mode === "managed-content" && kinds.length === 0 && (
                  <p className="note" role="alert">하나 이상의 내용 범주를 선택하거나 메타데이터만으로 바꾸세요.</p>
                )}
              </>
            )}
          </details>
        </fieldset>
        )}
        <button className="button button--primary" type="submit" disabled={busy || managedBlocked}>
          {busy ? "승인하는 중…" : summary.upgrade === true ? "권한 추가 승인" : "연결 승인"}
        </button>
      </form>
    </section>
  );
}
