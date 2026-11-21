import {createElement as h} from "react";
import { useEffect, useState } from "react";
import { dashboardPaths, dashboardSkillReadsResultSchema } from "../../../shared/dist/activity-dashboard.js";
import type { DashboardSource } from "../../../shared/dist/activity-dashboard.js";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { describeFailure, isUnauthorized, readProfiles } from "../dashboard/api";
import { shortKstDate } from "../time.ts";
import { versionLabel } from "./version-label.ts";
import { isMetricsUnauthorized, postDashboard } from "./version-metrics.ts";

import { mergeDigestReads } from "./skill-digest-reads-core.ts";
import type { DigestReads } from "./skill-digest-reads-core.ts";

export async function readDigestReads(
  sources: readonly DashboardSource[], skillId: string, fromMs: number, signal: AbortSignal,
): Promise<DigestReads> {
  const results = await Promise.all(sources.map(async source => dashboardSkillReadsResultSchema.parse(
    await postDashboard(dashboardPaths.skillReads, {
      profile: source, requestId: crypto.randomUUID(), skillId, firstReadFromMs: fromMs,
    }, signal))));
  return mergeDigestReads(results);
}

type State =
  | { readonly kind: "loading" } | { readonly kind: "no-sources" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly data: DigestReads };
const PERIODS = [7, 30, 90] as const;

/** 버전(digest)별 "처음 읽은 세션" 수. 저장된 값은 처음 읽은 시각과 세션별 누적 읽기 수뿐이라
 *  기간은 "기간 안에 처음 읽은 세션"이고, 읽기 수는 그 세션들의 누적(기간 밖 읽기 포함)이다. */
export function DigestReadsPanel({ detail, signal, onUnauthorized, active = true, period: fixedPeriod }: {
  /** 주어지면 부모의 기간 선택기를 따른다(이 패널은 버튼을 그리지 않는다). */
  readonly period?: number;
  readonly detail: PrivateSkillDetail; readonly signal: AbortSignal; readonly onUnauthorized: () => void; readonly active?: boolean;
}) {
  const [ownPeriod, setPeriod] = useState<number>(30);
  const period = fixedPeriod ?? ownPeriod;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    if (!active) return;
    let live = true;
    setState({ kind: "loading" });
    (async () => {
      const data = await readProfiles(signal);
      const ready = data.profiles.filter(profile => profile.availability === "ready")
        .map(profile => ({ deviceId: profile.deviceId, sourceDomain: profile.sourceDomain }));
      if (!live) return;
      if (ready.length === 0) { setState({ kind: "no-sources" }); return; }
      const merged = await readDigestReads(ready, detail.skill.skillId, Date.now() - period * 24 * 3600000, signal);
      if (live) setState({ kind: "ready", data: merged });
    })().catch((error: unknown) => {
      if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
      if (isUnauthorized(error) || isMetricsUnauthorized(error)) { onUnauthorized(); return; }
      setState({ kind: "failed", message: describeFailure(error, "버전별 읽힘") });
    });
    return () => { live = false; };
  }, [active, period, retry, detail.skill.skillId]);
  if (!active) return null;
  const label = (digest: string | null) => digest === null ? "digest 알 수 없음" :
    detail.versions.some(version => version.digest === digest) ? versionLabel(detail, digest, true) : `${digest.slice(0, 8)} · 보관 밖`;
  return h("section", { className: "digest-reads", "aria-labelledby": "digest-reads-title" },
    h("h3", { id: "digest-reads-title", className: "panel__subtitle" }, "버전별 읽힘 (digest 기준)"),
    fixedPeriod === undefined && h("div", { className: "version-metrics__period", role: "group", "aria-label": "처음 읽은 기간" },
      PERIODS.map(days => h("button", { key: days, type: "button", className: `button ${period === days ? "primary" : "secondary"}`,
        "aria-pressed": period === days, onClick: () => setPeriod(days) }, `최근 ${days}일`))),
    state.kind === "loading" ? h("p", { className: "note", role: "status" }, "불러오는 중…") :
    state.kind === "no-sources" ? h("p", { className: "note", role: "status" }, "준비된 활동 출처가 없어 집계하지 않았습니다.") :
    state.kind === "failed" ? h("div", null, h("p", { className: "note", role: "alert" }, state.message),
      h("button", { className: "button secondary", type: "button", onClick: () => setRetry(value => value + 1) }, "다시 시도")) :
    state.data.rows.length === 0 ? h("p", { className: "note", role: "status" }, `최근 ${period}일 안에 처음 읽힌 기록이 없습니다.`) :
    h("div", null,
      h("table", { className: "version-metrics__table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "버전"), h("th", { scope: "col" }, "최근 첫 읽음"),
          h("th", { scope: "col", title: "그 버전을 읽은 서로 다른 세션 수" }, "세션"),
          h("th", { scope: "col", title: "그 세션들의 누적 읽기 수(기간 밖 읽기 포함)" }, "읽기"))),
        h("tbody", null, state.data.rows.map(row => h("tr", { key: row.digest ?? "unknown" },
          h("td", null, label(row.digest)), h("td", null, shortKstDate(row.lastFirstReadMs)),
          h("td", null, `${row.sessions}`), h("td", null, `${row.reads}`))))),
      h("p", { className: "note digest-reads__summary" }, `세션 ${state.data.totalSessions}개 · 출처 ${state.data.sources}개`,
        h("details", { className: "digest-reads__basis" }, h("summary", null, "집계 기준"),
          h("p", { className: "note" }, `최근 ${period}일 안에 처음 읽힌 세션 기준입니다. 한 세션이 여러 버전을 읽으면 버전마다 한 번씩 세므로 표의 세션 합과 다를 수 있습니다. 세션 화면은 같은 ${period}일을 "최근 활동" 기준으로 거르므로 세션 집합이 다를 수 있습니다. 날짜는 KST입니다.`))),
      h("a", { className: "button secondary", href: sessionsHref(detail.skill.skillId, period) }, "읽은 세션 보기 (최근 활동 기준)")));
}

/** 호스팅 세션 화면(스킬 필터 + 기간 + 활동 기간은 최근 활동 기준). 본문은 열지 않는다. */
export function sessionsHref(skillId: string, period: number): string {
  const p = `&period=${period}`;
  return `/dashboard/#/sessions?skill=${encodeURIComponent(skillId)}${p}`;
}
