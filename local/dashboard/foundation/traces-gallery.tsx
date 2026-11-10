import { useState } from "preact/hooks";
import type { TraceStep } from "../../src/types.js";
import type { Route } from "../state";
import { EventConsole } from "../views/trace/event-console";
import { TRACE_CSS } from "../views/trace/styles";
import { traceConsoleStyles } from "../views/trace/console-style";
import { installStyles } from "../charts/sankey";
import { createTimelineKeys } from "../views/trace/plan";

const startedAt = Date.UTC(2026, 10, 5, 5);
const steps: readonly TraceStep[] = [
  { kind: "session_start", ts: startedAt, summary: "세션 시작", detail: { kind: "session_start" } },
  { kind: "prompt", ts: startedAt + 1000, summary: "마이그레이션 계획", detail: { kind: "prompt", text: "인덱스를 추가하고 검증합니다." } },
  { kind: "tool_call", ts: startedAt + 2000, summary: "Edit", detail: { kind: "tool_call", startedAt: startedAt + 2000, endedAt: startedAt + 3500, toolName: "Edit", args: JSON.stringify({ file: "schema.sql", changes: { index: true, columns: ["status"] } }) } },
];
const source = createTimelineKeys("gallery-session")(steps);

export function TracesGallery() {
  installStyles("pr7-trace-specimen", TRACE_CSS);
  traceConsoleStyles();
  const [route, navigate] = useState<Route>({ view: "trace", filter: {} });
  return <main id="gallery" class="lf-gallery" data-ready="true">
    <h1>세션 이벤트 컴포넌트</h1>
    <p>합성 데이터 · 트리, 타임라인, 원본 JSON · 방향키로 이벤트 이동</p>
    <div class="trace pe-console" data-specimen="trace">
      <EventConsole source={source} bounds={{ startedAt, endedAt: startedAt + 4000 }}
        route={route} navigate={navigate} embedded />
    </div>
    <div class="trace pe-console" data-specimen="empty-trace">
      <EventConsole source={[]} bounds={{}} route={{ view: "trace", filter: {} }} navigate={() => undefined} prefix="empty" embedded />
    </div>
  </main>;
}
