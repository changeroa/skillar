import { useLayoutEffect, useRef } from "react";
import type { TraceStep } from "../../../src/types.js";
import type { SessionListRow } from "../../api";
import { firstPromptOf, traceCounts, sessionBounds } from "./model";
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function Header({ sessionId, row, steps, embedded }: { readonly sessionId: string; row?: SessionListRow; steps: TraceStep[]; readonly embedded: boolean }) {
  const Title = embedded ? "h2" : "h1";
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = heading.current;
    if (embedded && node && node.closest(".page") === document.activeElement) node.focus({ preventScroll: true });
  }, [embedded]);
  const counts = traceCounts(steps);
  const title = firstPromptOf(steps, row);
  const bounds = sessionBounds(steps, row);
  // 2차 declutter: 검색 수·오류 수는 제거(이벤트 목록이 같은 정보를 보여준다).
  const parts = [
    `이벤트 ${counts.steps}개`,
    `읽기 ${counts.loads}회`,
  ];
  if (counts.reads) parts.push(`파일 읽기 ${counts.reads}회`);
  if (counts.natives) parts.push(`내장 스킬 ${counts.natives}개`);
  return (
    <header className="trace__head page-title">
      <Title ref={heading} tabIndex={embedded ? -1 : undefined} className="trace__title">{sessionId}</Title>
      {bounds.startedAt !== undefined && <time dateTime={new Date(bounds.startedAt).toISOString()}>{dateTimeFmt.format(bounds.startedAt)}</time>}
      <p className="trace__counts">{parts.join(" \u00b7 ")}</p>
    </header>
  );
}
