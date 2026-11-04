import type { FindingLabel } from "../../src/types.js";
import { FINDING_LABEL, FINDING_TITLE } from "../state";
import { UNKNOWN, formatCostUsd, formatLapse } from "./calls";

// One line of reported facts, as the Workspaces view and the session trace both print them.
// A fact is the measurement, not its sentence: the builders return keys and numbers, this module turns them into
// words. Wording can change here without touching a caller or a test, and a count of null stays "unknown".

export type Fact =
  | { key: "workspace" | "tab"; value: string }
  | { key: "panes" | "sessions" | "inferred" | "unlinked" | "turns" | "found" | "abstained"; value: number }
  | { key: "calls" | "callsAfter" | "commands" | "unresolvedExec" | "skillarCalls" | "failed" | "reads"; value: number }
  | { key: "spans"; withCalls: number; total: number }
  /** A measurement the runtime never reported is null here and reads "unknown", never 0. */
  | { key: "cost" | "active"; value: number | null }
  | { key: "finding"; value: FindingLabel };

export type FactKey = Fact["key"];

export function factText(fact: Fact): string {
  switch (fact.key) {
    case "workspace": return fact.value;
    case "tab": return `탭 ${fact.value}`;
    case "panes": return `패널 ${fact.value}개`;
    case "sessions": return `세션 ${fact.value}개`;
    case "inferred": return `추론으로 연결 ${fact.value}개`;
    case "unlinked": return `미연결 ${fact.value}개`;
    case "turns": return `대화 차례 ${fact.value}개`;
    case "found": return `검색으로 찾음 ${fact.value}건`;
    case "abstained": return `검색 보류 ${fact.value}건`;
    case "calls": return `호출 ${fact.value}건`;
    case "callsAfter": return `활성화 후 호출 ${fact.value}건`;
    case "commands": return `셸 명령 ${fact.value}건`;
    case "unresolvedExec": return `exec 래퍼 ${fact.value}개, 역할 알 수 없음`;
    case "skillarCalls": return `skillar 호출 ${fact.value}건`;
    case "failed": return `실패 ${fact.value}건`;
    case "reads": return `스킬 리소스 읽기 ${fact.value}건`;
    case "spans": return `활성화 후 호출이 있는 구간 ${fact.withCalls}/${fact.total}`;
    case "cost": return `비용 ${fact.value === null ? UNKNOWN : formatCostUsd(fact.value)}`;
    case "active": return `활성 시간 ${formatLapse(fact.value)}`;
    case "finding": return FINDING_LABEL[fact.value];
    default: {
      const exhaustive: never = fact;
      return String(exhaustive);
    }
  }
}

export function factTitle(fact: Fact): string | undefined {
  switch (fact.key) {
    case "finding": return FINDING_TITLE[fact.value];
    case "spans": return "skillar가 아닌 도구 호출이 한 번 이상 뒤따른 구간입니다. 활동이 있었다는 뜻일 뿐, 스킬이 적용되었거나 도움이 되었다는 증거는 아닙니다.";
    case "unresolvedExec": return "Codex exec가 실행하는 코드는 다른 호출을 넘기기만 할 수도 있고 자체 작업을 할 수도 있어서, 정확한 작업 수는 알 수 없습니다.";
    default: return undefined;
  }
}

export function Facts({ facts, className = "facts" }: { facts: Fact[]; className?: string }) {
  return (
    <p class={className}>
      {facts.map((fact, index) => (
        <span key={`${fact.key}-${index}`} class="facts__item" data-fact={fact.key} title={factTitle(fact)}>
          {factText(fact)}
        </span>
      ))}
    </p>
  );
}
