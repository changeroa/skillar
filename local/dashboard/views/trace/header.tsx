import { useLayoutEffect, useRef } from "preact/hooks";
import type { RuntimeId, TraceStep } from "../../../src/types.js";
import { api, type SessionListRow } from "../../api";
import { RequestCounts } from "../../components/requests";
import { ATTRIBUTION_LABEL, RUNTIME_LABEL, RUNTIME_MARK, type ViewProps } from "../../state";
import { firstPromptOf, traceCounts, sessionBounds, formatDuration } from "./model";
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function Runtime({ runtime }: { runtime: RuntimeId }) {
  return (
    <span class="rt">
      <span class="rt__mark" aria-hidden="true">{RUNTIME_MARK[runtime] ?? RUNTIME_MARK.unknown}</span>
      <span>{RUNTIME_LABEL[runtime] ?? RUNTIME_LABEL.unknown}</span>
    </span>
  );
}

export function Header({ sessionId, row, steps, backHref, embedded }: { readonly sessionId: string; row?: SessionListRow; steps: TraceStep[]; backHref: string; readonly embedded: boolean }) {
  const Title = embedded ? "h2" : "h1";
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = heading.current;
    if (embedded && node && node.closest(".page") === document.activeElement) node.focus({ preventScroll: true });
  }, [embedded]);
  const counts = traceCounts(steps);
  const title = firstPromptOf(steps, row);
  const bounds = sessionBounds(steps, row);
  const parts = [
    `이벤트 ${counts.steps}개`,
    `검색 ${counts.searches}회`,
    `읽기 ${counts.loads}회`,
  ];
  if (counts.reads) parts.push(`파일 읽기 ${counts.reads}회`);
  if (counts.natives) parts.push(`내장 스킬 ${counts.natives}개`);
  if (counts.errors) parts.push(`오류 ${counts.errors}건`);
  return (
    <header class="trace__head page-title">
      <a class="trace__back" href={backHref}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        세션
      </a>
      <Title ref={heading} tabIndex={embedded ? -1 : undefined} class="trace__title">{sessionId}</Title>
      {bounds.startedAt !== undefined && <time dateTime={new Date(bounds.startedAt).toISOString()}>{dateTimeFmt.format(bounds.startedAt)}</time>}
      {title && <details class="trace__prompt"><summary>첫 요청문 보기</summary><p class="tl__text">{title}</p></details>}
      <p class="trace__counts">{parts.join(" \u00b7 ")}</p>
    </header>
  );
}

/** The source and session facts beside the event sequence: the same measured values the header used to carry, no new claim. */
export function Inspector({ sessionId, row, steps, liveState, unresolvedLoads, embedded }: { sessionId: string; row?: SessionListRow; steps: TraceStep[]; liveState: ViewProps["live"]["state"]; unresolvedLoads: boolean; readonly embedded: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  const Sub = embedded ? "h4" : "h3";
  const bounds = sessionBounds(steps, row);
  const runtime = row?.runtime;
  let duration: string;
  if (bounds.startedAt === undefined) duration = "-";
  else if (bounds.endedAt !== undefined) duration = formatDuration(bounds.endedAt - bounds.startedAt);
  else if (api.mode !== "cloud" && liveState === "live") duration = `진행 중 \u00b7 ${formatDuration((bounds.lastTs ?? bounds.startedAt) - bounds.startedAt)} 경과`;
  else duration = `${formatDuration((bounds.lastTs ?? bounds.startedAt) - bounds.startedAt)} (종료 기록 없음)`;
  const attribution = row
    ? row.attribution === "none"
      ? `미연결 \u00b7 ${row.attributionReason ?? "사유 기록 없음"}`
      : ATTRIBUTION_LABEL[row.attribution] ?? row.attribution
    : "-";
  return (
    <aside class="trace__inspector" aria-labelledby="trace-inspector-title">
      <Heading id="trace-inspector-title" class="trace__subtitle">세션 정보</Heading>
      <dl class="trace__meta">
        <div>
          <dt>실행 환경</dt>
          <dd>{runtime ? <Runtime runtime={runtime} /> : <span class="trace__dim">알 수 없음</span>}</dd>
        </div>
        <div>
          <dt>시작</dt>
          <dd>{bounds.startedAt !== undefined ? <time dateTime={new Date(bounds.startedAt).toISOString()}>{dateTimeFmt.format(bounds.startedAt)}</time> : "-"}</dd>
        </div>
        <div>
          <dt>소요 시간</dt>
          <dd>{duration}</dd>
        </div>
        <div>
          <dt>세션 연결</dt>
          <dd class={row?.attribution === "none" ? "trace__dim" : undefined}>{attribution}</dd>
        </div>
        {row && (
          <div>
            <dt>요청</dt>
            <dd>{unresolvedLoads ? <span class="tag" data-adoption-status="uncertain">세션 연결 미확정</span>
              : <RequestCounts summary={row.requests} />}</dd>
          </div>
        )}
        <div>
          <dt>세션</dt>
          <dd class="trace__id">{sessionId}</dd>
        </div>
      </dl>
      <div class="trace__scope">
        <Sub class="trace__scope-title">확인 범위</Sub>
        <p class="trace__note">검색과 읽기 기록은 요청 단위로 확인됩니다. 실제 적용과 작업 성공은 이 기록으로 확인되지 않습니다.</p>
      </div>
    </aside>
  );
}
