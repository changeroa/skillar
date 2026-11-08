import type { SkillSpanUsage } from "../../../src/analysis/usage.js";
import type { FlowReportDto, FlowTree, SessionTree, SkillSpan, TreePaneLink, TurnFindingDto, TurnTree, AssignedTreeEvent } from "../../../src/types.js";
import { CallList, Tokens, callRows, isCall, tokenParts } from "../../components/calls";
import { Facts } from "../../components/facts";
import { FindingEvidence, UsageEvidence } from "../../components/skill-evidence";
import { BASIS_LABEL, BASIS_TITLE, FINDING_LABEL, FINDING_TITLE, buildHash, type Route } from "../../state";

import { Chevron, Runtime } from "./row-parts";
import { attributionParts, spanFacts, turnsOpen, sessionInWindow, formatStarted, clockFmt } from "./model";
export function Span({ span, usage, events = span.events }: { span: SkillSpan; usage: SkillSpanUsage | undefined; events?: readonly AssignedTreeEvent[] }) {
  const rows = callRows(span.events);
  const attribution = usage ? attributionParts(usage.attribution) : [];
  return (
    <li class="span" data-span={span.id} data-skill={span.skill}>
      <div class="span__head">
        <span class="span__name" title={span.uri ?? "보고된 스킬 URI 없음"}>{span.name}</span>
        {attribution.length === 0
          ? <span class="tag tag--dim">연결된 호출 없음</span>
          : attribution.map((part) => <span key={part.key} class="tag" title={part.title}>{part.label} {part.value}</span>)}
      </div>
      <Facts facts={spanFacts(span, usage, rows.length).filter(fact => fact.key !== "active")} className="facts span__facts" />
      <p class="pe-muted">스킬 구간 미측정 · 활성 구간의 경계는 실제 스킬 수행 시간을 측정한 값이 아닙니다.</p>
      {usage && usage.attribution.coActive > 0 && <p class="dim" data-shared-cost="true">비용은 공유 관측값입니다. 동시에 활성화된 스킬들이 같은 호출을 함께 보므로, 스킬별 비용을 더해도 청구액이 되지 않습니다.</p>}
      <p class="span__tokens"><Tokens parts={tokenParts(usage?.tokens ?? [])} /></p>
      {usage && <UsageEvidence events={events.length ? events : span.events} usage={usage} />}
      <CallList rows={rows} />
    </li>
  );
}

export function Turn({ turn, index, finding, usageBySpan, open }: {
  turn: TurnTree; index: number; finding: TurnFindingDto | undefined; usageBySpan: Map<string, SkillSpanUsage>; open: boolean;
}) {
  const calls = turn.events.filter(isCall).length;
  return (
    <li>
      <details class="turn" id={`turn-${turn.id}`} open={open} data-turn={turn.id}>
        <summary class="turn__sum">
          <Chevron />
          <span class="turn__n">대화 차례 {index + 1}</span>
          <time class="turn__time" dateTime={new Date(turn.startedAt).toISOString()}>{clockFmt.format(turn.startedAt)}</time>
          <span class="tag" title={BASIS_TITLE[turn.basis]}>{BASIS_LABEL[turn.basis]}</span>
          {finding && <span class="tag" title={FINDING_TITLE[finding.label]} data-finding={finding.label}>{FINDING_LABEL[finding.label]}</span>}
          <span class="turn__meta">스킬 구간 {turn.skillSpans.length}개</span>
        </summary>
        {finding && <FindingEvidence finding={finding} />}
        {turn.skillSpans.length === 0 ? (
          <p class="dim turn__none">이 대화 차례에서는 활성화된 스킬이 없습니다.{calls > 0 ? ` 호출 ${calls}건이 스킬 없이 실행되었습니다.` : ""}</p>
        ) : (
          <ul class="spans">
            {turn.skillSpans.map((span) => <Span key={span.id} span={span} usage={usageBySpan.get(span.id)} events={turn.events} />)}
          </ul>
        )}
      </details>
    </li>
  );
}

export function Session({ link, session, route, findings, usageBySpan, flow, paneClosed = false, newerSession = false }: {
  link?: TreePaneLink & { basis: "reported" | "inferred" }; session: SessionTree; route: Route;
  findings: Map<string, TurnFindingDto>; usageBySpan: Map<string, SkillSpanUsage>;
  flow?: FlowReportDto["flow"]; paneClosed?: boolean; newerSession?: boolean;
}) {
  const open = turnsOpen(session.turns.length);
  const outside = !sessionInWindow(session, flow ?? null);
  const lifecycle = session.endedAt !== null ? "ended" : paneClosed || newerSession || flow?.endedMs != null ? "end_not_observed" : "unknown";
  return (
    <article class="sess" data-session={session.id}>
      <header class="sess__head">
        <Runtime runtime={session.runtime} />
        <a class="sess__link" href={buildHash({ view: "trace", sessionId: session.id, filter: route.filter })}>추적 열기</a>
        <time class="sess__when" dateTime={new Date(session.startedAt).toISOString()}>{formatStarted(session.startedAt)}</time>
        <span class="tag" title={link ? link.basis === "reported" ? "herdr가 이 패널의 에이전트 세션을 보고했습니다" : "herdr가 보고하지 않아 skillar가 작업 디렉터리(cwd)와 시간으로 추정했습니다" : "이 세션에 연결된 herdr 패널이 없습니다"}>
          {link ? link.basis === "reported" ? "herdr 직접 기록" : "skillar 추정" : "herdr 외부"}
        </span>
        <span class="sess__meta">대화 차례 {session.turns.length}개</span>
        <span class="tag" data-session-status={lifecycle}>{lifecycle === "ended" ? "종료됨" : lifecycle === "end_not_observed" ? "종료 미확인" : "상태 미상"}</span>
        {outside && <span class="tag" data-session-window="outside" title="이 워크플로 실행 구간 밖의 패널 기록으로, 단계 결과에는 포함되지 않습니다">워크플로 구간 밖</span>}
      </header>
      {session.turns.length === 0
        ? <p class="dim">이 세션에는 기록된 대화 차례가 없습니다.</p>
        : (
          <ol class="turns">
            {session.turns.map((turn, index) => (
              <Turn key={turn.id} turn={turn} index={index} finding={findings.get(turn.id)} usageBySpan={usageBySpan} open={open} />
            ))}
          </ol>
        )}
    </article>
  );
}

export function Tree({ tree, route, findings, usageBySpan, filtered, flow }: {
  tree: FlowTree; route: Route; findings: Map<string, TurnFindingDto>; usageBySpan: Map<string, SkillSpanUsage>; filtered: boolean;
  flow: FlowReportDto["flow"];
}) {
  if (tree.sessions !== undefined) return (
    <section class="card ws__block" aria-labelledby="ws-sessions">
      <h2 class="ws__h" id="ws-sessions">세션</h2>
      {tree.sessions.length === 0 && <p class="dim">이 기간에는 herdr 외부 세션이 없습니다.</p>}
      {tree.sessions.map((session) => (
        <Session key={session.id} session={session} route={route} findings={findings} usageBySpan={usageBySpan} />
      ))}
    </section>
  );
  const panes = tree.tabs.reduce((n, tab) => n + tab.panes.length, 0);
  return (
    <section class="card ws__block" aria-labelledby="ws-panes">
      <h2 class="ws__h" id="ws-panes">패널</h2>
      {panes === 0 ? (
        <p class="dim">herdr가 이 작업 공간의 패널을 아직 보고하지 않았습니다.</p>
      ) : (
        <ul class="tabsets">
          {tree.tabs.map((tab) => (
            <li key={tab.id} class="tabset">
              <p class="tabset__head">
                <span class="tabset__name">{tab.label ?? tab.id}</span>
                <span class="dim">패널 {tab.panes.length}개</span>
              </p>
              <ul class="panes">
                {tab.panes.map((pane) => (
                  <li key={pane.id}>
                    <details class="pane" open data-pane={pane.id}>
                      <summary class="pane__sum">
                        <Chevron />
                        <span class="pane__name">{pane.label ?? pane.id}</span>
                        <span class="pane__meta">세션 {pane.sessions.length}개</span>
                      </summary>
                      <div class="pane__body">
                        {pane.sessions.length === 0 && (
                          <p class="dim">{filtered
                            ? "이 패널에 표시할 에이전트 세션이 없습니다. 자동화된 세션은 제외되었습니다."
                            : "이 패널에서 실행된 에이전트 세션이 없습니다."}</p>
                        )}
                        {pane.sessions.map((link) => (
                          link.session === null
                            ? (
                              <p key={link.agentSessionValue} class="dim" data-unlinked={link.agentSessionValue}>
                                에이전트 세션 <code class="cmd">{link.agentSessionValue}</code>에 연결된 skillar 세션이 아직 없습니다.
                              </p>
                            )
                            : <Session key={link.session.id} link={link} session={link.session} route={route} findings={findings} usageBySpan={usageBySpan}
                              flow={flow} paneClosed={pane.closedMs !== null}
                              newerSession={pane.sessions.some((other) => other.session !== null && other.session.startedAt > (link.session?.startedAt ?? Infinity))} />
                        ))}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
