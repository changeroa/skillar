import {createElement as h} from "react";
import type { ReactNode } from "react";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { useLibraryActivity } from "./activity-filters.ts";
import { DigestReadsPanel } from "./skill-digest-reads.ts";

const PERIODS = [7, 30, 90] as const;

/**
 * "읽힘" 탭: 위쪽은 평문 일별 집계(기간 안의 읽힘·검색 노출·읽은 에이전트), 아래쪽은 버전별 처음 읽은 세션이다.
 * 두 지표는 기준이 달라(일별 집계 vs 처음 읽은 시각) 제목에 기준을 적고 같은 기간 값으로 보이지 않게 따로 둔다.
 * 본문은 열지 않는다. 집계 전이거나 읽을 수 없으면 0이 아니라 "—"다.
 */
export function SkillReadsTab({ detail, signal, onUnauthorized, active, days, onDays }: {
  /** 목록 상단의 기간(주소의 period)을 그대로 따른다. onDays는 목록이 없는 전체 화면에서만 주어진다. */
  readonly days: 7 | 30 | 90; readonly onDays?: (days: 7 | 30 | 90) => void;
  readonly detail: PrivateSkillDetail; readonly signal: AbortSignal; readonly onUnauthorized: () => void; readonly active: boolean;
}) {
  const activity = useLibraryActivity([detail.skill], active, signal, onUnauthorized, days);
  if (!active) return null;
  const mine = activity.kind === "ready" ? activity.bySkill.get(detail.skill.skillId) : undefined;
  const dash = h("span", { className: "pe-muted" }, "—");
  const known = activity.kind === "ready";
  const agents = mine === undefined ? [] : [...mine.agents.keys()];
  const big = (label: string, value: ReactNode) => h("div", { className: "skill-reads-stat" },
    h("span", { className: "skill-reads-stat__value" }, value), h("span", { className: "skill-reads-stat__label" }, label));
  return h("div", { className: "skill-reads-tab" },
    onDays === undefined
      ? h("p", { className: "note skill-reads-period", role: "status" }, `기간 최근 ${days}일 · 목록의 기간 버튼으로 바꿉니다(좁은 화면에서는 패널을 닫은 뒤)`)
      : h("div", { className: "version-metrics__period", role: "group", "aria-label": "기간" },
        PERIODS.map(value => h("button", { key: value, type: "button", className: `button ${days === value ? "primary" : "secondary"}`,
          "aria-pressed": days === value, onClick: () => onDays(value) }, `최근 ${value}일`))),
    h("section", { className: "skill-reads-kpi", "aria-labelledby": "reads-kpi-title" },
      h("h3", { id: "reads-kpi-title", className: "panel__subtitle" }, "읽힘 · 노출 (일별 집계)"),
      activity.kind === "loading" ? h("p", { className: "note", role: "status" }, "읽힘을 집계하는 중…") :
        h("div", { className: "skill-reads-stats" },
          big("읽힘", known ? `${mine?.reads ?? 0}회` : dash),
          big("검색 노출", known ? `${mine?.exposures ?? 0}회` : dash),
          big("읽은 에이전트", !known || agents.length === 0 ? dash : `${agents.length}개`)),
      known && agents.length > 0 && h("p", { className: "note" }, agents.join(", ")),
      activity.kind === "unavailable" && h("p", { className: "note", role: "status" },
        activity.reason === "empty" ? "수집된 기록이 아직 없습니다." : "집계를 읽을 수 없거나 아직 준비 중입니다."),
      h("details", { className: "digest-reads__basis" }, h("summary", null, "집계 기준"),
        h("p", { className: "note" }, `최근 ${days}일 일별 집계의 읽힘·노출 횟수입니다. 동의한 보존 기간 안의 기록만 포함하며 90일 보기는 일부만 보일 수 있습니다. 기록이 없는 것이 읽히지 않았다는 뜻은 아닙니다. 본문은 열지 않습니다.`))),
    h(DigestReadsPanel, { detail, signal, onUnauthorized, active, period: days }));
}
