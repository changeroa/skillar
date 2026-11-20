import { useEffect, useState } from "react";
import {
  dashboardPaths, dashboardSkillUsageResultSchema,
} from "../../../shared/dist/activity-dashboard.js";
import type { DashboardProfile, DashboardSource } from "../../../shared/dist/activity-dashboard.js";
import type { PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { readProfiles } from "../dashboard/api";
import { isMetricsUnauthorized, postDashboard } from "./version-metrics.ts";
import { aggregateSkillUsage } from "./activity-filters-core.ts";
import type { SkillActivity } from "./activity-filters-core.ts";

/**
 * 스킬 탭 활동 필터 데이터. 준비된 활동 출처 전부에서 서버의 평문 일별 집계(스킬 URI·KST 일자별
 * 읽힘/검색 노출 횟수·읽은 에이전트만)를 한 번의 SQL 조회로 읽는다. 조회 창(최근 30개 KST 일자)은
 * 서버가 계산한다. 폴링/보고서 파이프라인을 타지 않는다. 출처가 없거나 기간 내 기록이 없으면 필터는
 * 비활성 + 한 줄 안내로 표시한다(데이터를 0으로 지어내지 않는다).
 */

/** 비활성 사유: empty=수집된 기록 0건(또는 준비된 출처 없음), unavailable=조회 불가 또는 백필 대기.
    incompatible은 구 Worker의 sessions 리포트 형식과의 구분용으로 남겨 두지만 현재 경로에서는 나오지 않는다. */
export type ActivityUnavailableReason = "empty" | "incompatible" | "unavailable";

export type LibraryActivity =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly reason: ActivityUnavailableReason }
  | { readonly kind: "ready"; readonly bySkill: ReadonlyMap<string, SkillActivity> };

export async function readLibraryActivity(
  profiles: readonly DashboardProfile[], skills: readonly PrivateSkillSummary[], signal: AbortSignal,
): Promise<LibraryActivity> {
  const ready = profiles.filter(profile => profile.availability === "ready");
  if (ready.length === 0) return { kind: "unavailable", reason: "empty" };
  // 조회 창(최근 30개 KST 일자)은 서버가 KST 일자 경계로 계산한다.
  const skillIds = new Set(skills.map(skill => skill.skillId));
  const results = await Promise.all(ready.map(async profile => {
    const source: DashboardSource = { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain };
    return dashboardSkillUsageResultSchema.parse(await postDashboard(dashboardPaths.skillUsage, {
      profile: source, requestId: crypto.randomUUID(),
    }, signal));
  }));
  // 백필이 아직 끝나지 않은 출처가 섞여 있으면 집계가 과소계산되므로 필터를 열지 않는다(추정 금지).
  if (results.some(result => result.coverage === "pending_backfill")) {
    return { kind: "unavailable", reason: "unavailable" };
  }
  if (results.every(result => result.rows.length === 0)) return { kind: "unavailable", reason: "empty" };
  return { kind: "ready", bySkill: aggregateSkillUsage(results.flatMap(result => result.rows), skillIds) };
}

/** 스킬 보관함 화면의 활동 필터 상태. 실패는 필터만 비활성으로 두고 목록은 그대로 둔다. */
export function useLibraryActivity(
  skills: readonly PrivateSkillSummary[], enabled: boolean, signal: AbortSignal, onUnauthorized: () => void,
): LibraryActivity {
  const [state, setState] = useState<LibraryActivity>({ kind: "loading" });
  const ids = skills.map(skill => skill.skillId).join(",");
  useEffect(() => {
    if (!enabled) { setState({ kind: "unavailable", reason: "unavailable" }); return; }
    let live = true;
    setState({ kind: "loading" });
    readProfiles(signal)
      .then(data => readLibraryActivity(data.profiles, skills, signal))
      .then(next => { if (live) setState(next); })
      .catch((error: unknown) => {
        if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
        if (isMetricsUnauthorized(error)) { onUnauthorized(); return; }
        setState({ kind: "unavailable", reason: "unavailable" });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 스킬 ID 집합이 바뀔 때만 다시 읽는다.
  }, [ids, enabled]);
  return state;
}
