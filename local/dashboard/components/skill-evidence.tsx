import type { SkillSpanUsage } from "../../src/analysis/usage.js";
import type { AssignedTreeEvent, TurnFindingDto, UnattributedLoads } from "../../src/types.js";

export function UnresolvedLoadNotice({ loads }: { loads: UnattributedLoads }) {
  if (loads.count === 0) return null;
  return (
    <aside class="callout" role="note" data-load-attribution="unresolved">
      <strong>세션 연결이 확정되지 않은 스킬 읽기 <span data-unattributed-count={loads.count}>{loads.count}</span>건</strong>
      <span>이 읽기 기록은 이 보고서에 속할 수 있습니다. 연결된 사용 기록이 없다고 해서 사용하지 않았다는 증거는 아닙니다.</span>
      <ul>{loads.uris.map((uri) => <li key={uri}><code data-unattributed-uri={uri}>{uri}</code></li>)}</ul>
    </aside>
  );
}

/** A later use remains navigable even when its turn starts folded. */
function openTurn(id: string): void {
  const target = document.getElementById(`turn-${id}`);
  if (!(target instanceof HTMLDetailsElement)) return;
  target.open = true;
  target.querySelector("summary")?.focus();
}

export function FindingEvidence({ finding }: { finding: TurnFindingDto }) {
  return (
    <details class="evidence" data-evidence="finding">
      <summary>판정 증거 보기 <span class="tag">기록된 이벤트</span></summary>
      <div class="evidence__body">
        <p>검색 기록: <strong data-searched={finding.searched}>{finding.searched ? "있음" : "없음"}</strong></p>
        <ol aria-label="검색어">{finding.queries.map((query, i) => <li key={i}><q>{query || "검색어가 수집되지 않음"}</q></li>)}</ol>
        <h3>모든 검색의 후보</h3>
        <p class="dim">후보별 가장 최근 순위입니다. 순위는 동일한 복사본을 하나로 묶습니다.</p>
        {finding.candidates.length === 0 ? <p>기록된 후보가 없습니다.</p> : (
          <ul aria-label="검색 후보">{finding.candidates.map((candidate) => (
            <li key={candidate.uri} data-candidate={candidate.uri} data-rank={candidate.rank} data-raw-rank={candidate.rawRank} data-copies={candidate.copies}>
              <strong>{candidate.name}</strong> - 순위 {candidate.rank}, 원래 순위 {candidate.rawRank}, 복사본 {candidate.copies}개
              <code>{candidate.uri}</code>
            </li>
          ))}</ul>
        )}
        <h3>읽은 스킬과 사용한 내장 스킬</h3>
        {finding.usedSkills.length === 0 ? <p>기록된 스킬 사용이 없습니다.</p> : (
          <ul aria-label="사용한 스킬">{finding.usedSkills.map((skill, i) => (
            <li key={i} data-used-skill={skill.name} data-rank={skill.rankInSearch ?? "not_in_results"} data-via={skill.via}>
              <strong>{skill.name}</strong> - {skill.via === "load" ? "읽음" : "내장 스킬 사용"}; {skill.rankInSearch === null ? "검색 결과에 없음(또는 앞선 검색 없음)" : `앞선 검색에서 순위 ${skill.rankInSearch}`}
              {skill.uri && <code>{skill.uri}</code>}
            </li>
          ))}</ul>
        )}
        <p>앞선 검색 없이 내장 스킬 사용: <strong data-native-without-search={finding.nativeWithoutSearch}>{finding.nativeWithoutSearch ? "있음" : "없음"}</strong></p>
        <h3>검색 보류</h3>
        {finding.abstentions.length === 0 ? <p>기록된 검색 보류가 없습니다.</p> : (
          <ul>{finding.abstentions.map((abstention, i) => <li key={i} data-abstention={abstention.reason}>{abstention.reason}{abstention.hint && ` - ${abstention.hint}`}</li>)}</ul>
        )}
        <h3>나중에 사용했지만 이 검색들에는 없던 스킬</h3>
        {finding.missedLater.length === 0 ? <p>나중에 놓친 스킬 기록이 없습니다.</p> : (
          <ul>{finding.missedLater.map((skill, i) => (
            <li key={i} data-missed-skill={skill.name}>
              <a href={`#turn-${skill.turnId}`} onClick={(event) => { event.preventDefault(); openTurn(skill.turnId); }}>{skill.name} - 나중 대화 차례 열기</a>
              {skill.uri && <code>{skill.uri}</code>}
            </li>
          ))}</ul>
        )}
      </div>
    </details>
  );
}

const CORRECTION_LABEL = { correction: "수정 요청으로 보임", no_correction: "수정 표현 없음", unknown: "알 수 없음" } as const;
const CORRECTION_REASON = { no_next_prompt: "다음 요청문이 관찰되지 않음", text_not_captured: "다음 요청문 본문이 수집되지 않음" } as const;

export function UsageEvidence({ events, usage }: { events: readonly AssignedTreeEvent[]; usage: SkillSpanUsage }) {
  const correction = usage.nextPromptCorrection;
  return (
    <details class="evidence" data-evidence="usage">
      <summary>사용 증거 보기 <span class="tag">기록 / 추정</span></summary>
      <div class="evidence__body">
        <p data-correction={correction.status} data-basis={correction.label} data-correction-reason={correction.reason ?? "none"}>
          다음 요청문 수정 여부: <strong>{CORRECTION_LABEL[correction.status]}</strong> <span class="tag">{correction.label}</span>
          {correction.reason && ` - ${CORRECTION_REASON[correction.reason]}`}
          {correction.matched.length > 0 && ` - 일치 표현: ${correction.matched.join(", ")}`}
        </p>
        <h3>뒷받침하는 읽기</h3>
        {usage.supportingReads.length === 0 ? <p>기록된 뒷받침 읽기가 없습니다.</p> : (
          <ul>{usage.supportingReads.map((read) => {
            const event = events.find((item) => item.id === read.eventId);
            const path = typeof event?.data.uri === "string" ? event.data.uri : typeof event?.data.path === "string" ? event.data.path : null;
            return (
              <li key={read.eventId} data-read={read.eventId} data-basis={read.label}>
                <span class="tag">{read.label}</span> {read.kind === "read_file" ? "리소스 읽기" : "도구 인자 경로"}
                <code>{path ?? event?.text ?? "파일 경로가 수집되지 않음"}</code>
                {read.uri && <code>스킬: {read.uri}</code>}
                <span>이벤트: <code>{read.eventId}</code></span>
              </li>
            );
          })}</ul>
        )}
      </div>
    </details>
  );
}
