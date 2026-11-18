import { useState } from "react";
import { CodeBlock } from "../../foundation/viewers";
import type { TraceStep } from "../../../src/types.js";
import { api } from "../../api";
import { RankedCandidates } from "../../components/ranked-candidates";
import { skillName } from "../../state";
import { foldText, evalCasePayload, formatBytes, formatCost, formatDuration, formatMs, resourcePath, searchDetail, sessionBounds, shortDigest, toolArgsPreview, MODE_LABEL, ABSTAIN_LABEL, type SearchDetail, type PromptDetail, type LoadDetail, type ReadDetail, type NativeDetail, type LlmDetail, type ToolDetail, type ErrorDetail } from "./model";

function PromptBody({ detail }: { detail: PromptDetail }) {
  const [open, setOpen] = useState(false);
  if (!detail.text) {
    return <p className="tl__dim">(요청문 기록 없음{detail.textLength !== undefined ? `, ${detail.textLength}자` : ""})</p>;
  }
  const { head, folded } = foldText(detail.text);
  return (
    <div>
      <p className="tl__text">{open || !folded ? detail.text : `${head}\u2026`}</p>
      {folded && (
        <button type="button" className="foldbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : `더 보기 (${Array.from(detail.text).length}자)`}
        </button>
      )}
    </div>
  );
}

type SaveState = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

function SaveEvalButton({ detail }: { detail: SearchDetail }) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const save = () => {
    setState({ status: "saving" });
    api.addEvalCase(evalCasePayload(detail))
      .then(() => setState({ status: "saved" }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  };
  const saved = state.status === "saved";
  return (
    <div className="tl__save">
      <button type="button" className="btn" data-save-eval={state.status} disabled={state.status === "saving" || saved} onClick={save}>
        {saved && <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>}
        {saved ? "평가 사례로 저장됨" : state.status === "saving" ? "저장 중\u2026" : "평가 사례로 저장"}
      </button>
      {api.mode === "fixtures" && <span className="tl__meta">예시: 저장되지 않음</span>}
      {state.status === "error" && <span className="tl__err" role="alert">저장하지 못했습니다: {state.message}</span>}
    </div>
  );
}

function SearchBody({ detail }: { detail: SearchDetail }) {
  const shown = detail.candidates.length;
  const countText = detail.abstained
    ? "추천 보류"
    : detail.total > shown ? `전체 ${detail.total}개 중 상위 ${shown}개` : `후보 ${shown}개`;
  return (
    <div>
      <p className="tl__meta tl__meta--row">
        <span className="tl__mode" title={`검색 모드: ${detail.mode}`}>{MODE_LABEL[detail.mode] ?? detail.mode}</span>
      <span>{detail.elapsedMs === undefined ? "측정 안 됨" : formatMs(detail.elapsedMs)}</span>
        <span>{countText}</span>
      </p>
      <blockquote className="tl__query">{detail.query || <span className="tl__dim">(검색어 없음)</span>}</blockquote>
      {detail.abstained ? (
        <div className="tl__abstain" data-abstained={detail.abstained.reason}>
          <div className="tl__abstain-head">
            <span className="badge badge--succeeded">후보 없음 {"\u00b7"} {ABSTAIN_LABEL[detail.abstained.reason] ?? detail.abstained.reason}</span>
          </div>
          <p className="tl__hint">{detail.abstained.hint}</p>
          <SaveEvalButton detail={detail} />
        </div>
      ) : (
        <RankedCandidates candidates={detail.candidates} chosen={detail.chosen} query={detail.query} />
      )}
    </div>
  );
}

function LoadBody({ detail }: { detail: LoadDetail }) {
  return (
    <p className="tl__line">
      <span className="tl__name">{skillName(detail.uri)}</span>
      <span className="tl__uri">{detail.uri}</span>
      {detail.manifestDigest && <span className="tl__digest" title={`명세 해시 ${detail.manifestDigest}`}>@{shortDigest(detail.manifestDigest)}</span>}
    </p>
  );
}

function ReadBody({ detail }: { detail: ReadDetail }) {
  return (
    <p className="tl__line">
      <span className="tl__name tl__name--mono">{resourcePath(detail.skillUri, detail.uri)}</span>
      <span className="tl__meta">{formatBytes(detail.bytes)}</span>
      {detail.skillUri && <span className="tl__meta">출처 {skillName(detail.skillUri)}</span>}
    </p>
  );
}

function NativeBody({ detail }: { detail: NativeDetail }) {
  return (
    <p className="tl__line">
      <span className="tl__name">{detail.name}</span>
      <span className="tl__meta">활성 경로: {detail.via}</span>
    </p>
  );
}

function LlmBody({ step, detail }: { step: TraceStep; detail: LlmDetail }) {
  return (
    <p className="tl__line">
      <span className="tl__name">{step.summary}</span>
      <span className="tl__meta">{formatCost(detail.costUsd)}</span>
      {detail.durationMs !== undefined && <span className="tl__meta">{formatMs(detail.durationMs)}</span>}
      {detail.ttftMs !== undefined && <span className="tl__meta">첫 토큰 {formatMs(detail.ttftMs)}</span>}
    </p>
  );
}

export function ToolArguments({ detail, name }: { readonly detail: ToolDetail; readonly name?: string }) {
  const args = toolArgsPreview(detail);
  if (args === undefined) return null;
  switch (args.captured) {
    case true: return <details className="tl__args"><summary>{name && <span className="tl__name--mono">{name} </span>}도구 인자 전체 보기</summary><CodeBlock value={detail.args ?? ""} language="json" label="도구 인자" /></details>;
    case false: return <span className="tl__name tl__name--mono">{args.length}자 기록 생략</span>;
    default: { const exhaustive: never = args; return exhaustive; }
  }
}

function ToolBody({ step, detail }: { step: TraceStep; detail: ToolDetail }) {
  return (
    <div className="tl__line">
      <span className="tl__name">{step.summary}</span>
      <ToolArguments detail={detail} />
      {detail.resultBytes !== undefined && <span className="tl__meta">결과 {formatBytes(detail.resultBytes)}</span>}
    </div>
  );
}

function ErrorBody({ detail }: { detail: ErrorDetail }) {
  return (
    <p className="tl__line">
      <span className="tl__code">{detail.code}</span>
      <span className="tl__errmsg">{detail.message}</span>
    </p>
  );
}

export function StepBody({ step, bounds }: { step: TraceStep; bounds: ReturnType<typeof sessionBounds> }) {
  switch (step.kind) {
    case "prompt": return <PromptBody detail={step.detail as PromptDetail} />;
    case "search": return <SearchBody detail={searchDetail(step)} />;
    case "load": return <LoadBody detail={step.detail as LoadDetail} />;
    case "read_file": return <ReadBody detail={step.detail as ReadDetail} />;
    case "native_skill": return <NativeBody detail={step.detail as NativeDetail} />;
    case "llm_call": return <LlmBody step={step} detail={step.detail as LlmDetail} />;
    case "tool_call": return <ToolBody step={step} detail={step.detail as ToolDetail} />;
    case "error": return <ErrorBody detail={step.detail as ErrorDetail} />;
    case "session_end":
      return bounds.startedAt !== undefined ? <p className="tl__meta">{formatDuration(step.ts - bounds.startedAt)} 후</p> : null;
    case "session_start":
      return null;
    default:
      return <p className="tl__meta">{step.summary}</p>;
  }
}
