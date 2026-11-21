import { kstDay } from "../time.ts";

/**
 * 스킬 탭 활동 필터의 순수 코어. 기기 업로드 facts와 호스팅 MCP 활동이 같은
 * sessions 리포트 형태로 오므로 출처를 가르지 않고 기록된 값만 집계한다.
 * 추정 금지: 없는 값은 만들지 않고, 에이전트 이름도 기록된 문자열을 그대로 쓴다.
 */

export const READ_STATE_IDS = ["read", "searched", "unread"] as const;
export type ReadState = (typeof READ_STATE_IDS)[number];
/** 최근 30일 창 안의 수집 기록만으로 판정하므로 라벨도 그 범위를 벗어나지 않는다(추정 금지).
    '읽힘 기록 없음'은 실제 미사용이 아니라 수집된 기록에 읽음이 없다는 뜻이다. */
export const READ_STATE_LABEL: Record<ReadState, string> = {
  read: "읽힘",
  searched: "검색만 기록됨",
  unread: "읽힘 기록 없음",
};

export const CHANGED_BUCKET_IDS = ["7d", "30d", "older"] as const;
export type ChangedBucket = (typeof CHANGED_BUCKET_IDS)[number];
export const CHANGED_BUCKET_LABEL: Record<ChangedBucket, string> = {
  "7d": "최근 7일",
  "30d": "최근 30일",
  older: "그 이전",
};

/** skill://private/<skillId>/<digest>/<path> 와 skillar://private/… 저장소 형태 둘 다. */
const PRIVATE_URI = /\/private\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//;

export function skillIdFromUri(uri: string): string | null {
  return PRIVATE_URI.exec(uri)?.[1] ?? null;
}

/** 최근 변경 기간 세 칸. KST 날짜 경계 기준으로 오늘을 포함해 7일/30일을 자른다. */
export function changedBucket(updatedAt: number, now: number): ChangedBucket {
  const today = Date.parse(kstDay(now));
  const day = Date.parse(kstDay(updatedAt));
  const diffDays = Math.floor((today - day) / 86400000);
  if (diffDays < 7) return "7d";
  if (diffDays < 30) return "30d";
  return "older";
}

export type LibrarySession = {
  readonly runtime: string;
  readonly state: string;
  readonly skills: readonly string[];
  readonly exposed?: readonly string[] | undefined;
  readonly clientName?: string | undefined;
};

/** 기록된 runtime 값 우선, MCP처럼 runtime이 없으면 연결의 client_name, 둘 다 없으면 "알 수 없음". */
export function agentLabelOf(session: LibrarySession): string {
  if (session.runtime !== "unknown") return session.runtime;
  return session.clientName ?? "알 수 없음";
}

export type SkillActivity = {
  readonly read: boolean;
  readonly searched: boolean;
  readonly agents: ReadonlyMap<string, number>;
  /** 조회 창 안의 읽힘·검색 노출 합계(서버 평문 일별 집계). 세션 집계 경로에서는 모르므로 0이다. */
  readonly reads?: number;
  readonly exposures?: number;
};

/** 세션 목록을 보관함 스킬별로 접는다. read는 load 관측, searched는 검색 노출만 있는 경우다. */
export function aggregateSkillActivity(
  sessions: readonly LibrarySession[], skillIds: ReadonlySet<string>,
): ReadonlyMap<string, SkillActivity> {
  const bySkill = new Map<string, { read: boolean; searched: boolean; agents: Map<string, number> }>();
  const entry = (skillId: string) => {
    const existing = bySkill.get(skillId);
    if (existing !== undefined) return existing;
    const created = { read: false, searched: false, agents: new Map<string, number>() };
    bySkill.set(skillId, created);
    return created;
  };
  for (const session of sessions) {
    const agent = agentLabelOf(session);
    const seen = new Set<string>();
    const loaded = session.state === "loaded" ? session.skills : [];
    const exposed = session.exposed ?? (session.state === "loaded" ? [] : session.skills);
    for (const uri of loaded) {
      const skillId = skillIdFromUri(uri);
      if (skillId === null || !skillIds.has(skillId) || seen.has(skillId)) continue;
      seen.add(skillId);
      const acc = entry(skillId);
      acc.read = true;
      acc.agents.set(agent, (acc.agents.get(agent) ?? 0) + 1);
    }
    for (const uri of exposed) {
      const skillId = skillIdFromUri(uri);
      if (skillId === null || !skillIds.has(skillId) || seen.has(skillId)) continue;
      seen.add(skillId);
      entry(skillId).searched = true;
    }
  }
  return bySkill;
}

export function readStateOf(activity: SkillActivity | undefined): ReadState {
  if (activity === undefined) return "unread";
  if (activity.read) return "read";
  if (activity.searched) return "searched";
  return "unread";
}

/** 서버 평문 집계(스킬 URI·읽힘/검색 노출·읽은 에이전트) 한 행. */
export type SkillUsageRow = {
  readonly skillUri: string;
  readonly agent: string | null;
  readonly reads: number;
  readonly exposures: number;
};

/** 서버 집계 행을 보관함 스킬별로 접는다. read는 읽힘 1건 이상, searched는 노출 1건 이상.
    에이전트 수는 읽힘만 센다(기존 세션 집계와 같은 기준). */
export function aggregateSkillUsage(
  rows: readonly SkillUsageRow[], skillIds: ReadonlySet<string>,
): ReadonlyMap<string, SkillActivity> {
  const bySkill = new Map<string, { read: boolean; searched: boolean; agents: Map<string, number>; reads: number; exposures: number }>();
  const entry = (skillId: string) => {
    const existing = bySkill.get(skillId);
    if (existing !== undefined) return existing;
    const created = { read: false, searched: false, agents: new Map<string, number>(), reads: 0, exposures: 0 };
    bySkill.set(skillId, created);
    return created;
  };
  for (const row of rows) {
    const skillId = skillIdFromUri(row.skillUri);
    if (skillId === null || !skillIds.has(skillId)) continue;
    const acc = entry(skillId);
    acc.reads += row.reads; acc.exposures += row.exposures;
    if (row.exposures > 0) acc.searched = true;
    if (row.reads > 0) {
      acc.read = true;
      const agent = row.agent ?? "알 수 없음";
      acc.agents.set(agent, (acc.agents.get(agent) ?? 0) + row.reads);
    }
  }
  return bySkill;
}
