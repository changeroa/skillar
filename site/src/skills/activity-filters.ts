import { useEffect, useState } from "react";
import { z } from "zod";
import type { PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import type { DashboardProfile, DashboardSource } from "../../../shared/dist/activity-dashboard.js";
import { readProfiles } from "../dashboard/api";
import { isMetricsUnauthorized, runQuery } from "./version-metrics.ts";
import { aggregateSkillActivity } from "./activity-filters-core.ts";
import type { SkillActivity } from "./activity-filters-core.ts";

/**
 * 스킬 탭 활동 필터 데이터. 준비된 활동 출처 전부에서 최근 30일 sessions 리포트를
 * 읽어 스킬별 읽힘/검색 노출/읽은 에이전트로 접는다. 출처가 없거나 기간 내 기록이
 * 없으면 필터는 비활성 + 한 줄 안내로 표시한다(데이터를 0으로 지어내지 않는다).
 */

export const ACTIVITY_WINDOW_MS = 30 * 86400000;

const sessionRowSchema = z.looseObject({
  id: z.string(), runtime: z.string(), state: z.string(),
  skills: z.array(z.string()).default([]),
  exposed: z.array(z.string()).optional(),
  clientName: z.string().optional(),
});
const sessionsPayloadSchema = z.array(sessionRowSchema);

/** 비활성 사유: empty=수집된 기록 0건(또는 준비된 출처 없음), incompatible=응답 형식 불일치(구 Worker), unavailable=조회 불가. */
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
  const to = Date.now(), from = to - ACTIVITY_WINDOW_MS;
  const skillIds = new Set(skills.map(skill => skill.skillId));
  const rows = (await Promise.all(ready.map(async profile => {
    const source: DashboardSource = { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain };
    const payload = await runQuery(source, { kind: "sessions", filter: { from, to } }, signal);
    return sessionsPayloadSchema.parse(payload);
  }))).flat();
  // 선택 기간에 기록이 0건이면 게이트대로 필터는 비활성(데이터 없음을 0 값으로 지어내지 않는다).
  if (rows.length === 0) return { kind: "unavailable", reason: "empty" };
  // 구 Worker 응답에는 exposed 필드가 없다. 노출 기록 유무를 알 수 없는 행이 섞여 있으면
  // '검색만 기록됨'을 '읽힘 기록 없음'으로 오분류하게 되므로, 구분 불가 데이터로는 필터를 열지 않는다(추정 금지).
  // 이 사유는 기록 0건과 다르므로 reason을 incompatible로 구분한다(안내 문구도 달라야 한다).
  if (rows.some(row => row.exposed === undefined)) return { kind: "unavailable", reason: "incompatible" };
  return { kind: "ready", bySkill: aggregateSkillActivity(rows, skillIds) };
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
