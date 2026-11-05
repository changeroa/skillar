import { z } from "zod";
import {
  privateSkillCatalogSchema, privateSkillDetailSchema, privateSkillExportSchema,
} from "../../../shared/dist/private-skills.js";
import type {
  PrivateSkillCatalog, PrivateSkillDetail, PrivateSkillDigest, PrivateSkillExport, PrivateSkillHead, PrivateSkillId,
  PrivateSkillPackage,
} from "../../../shared/dist/private-skills.js";
import type { SearchMode } from "../../../shared/dist/private-search.js";

export { readSession } from "../dashboard/api.ts";
export type { SessionState } from "../dashboard/api.ts";

/** Same-origin browser routes from the P10 contract. The Google session cookie is the only credential. */
export const routes = {
  catalog: "/api/skills",
  search: "/api/skills/search",
  skill: (skillId: string) => `/api/skills/${encodeURIComponent(skillId)}`,
  versions: (skillId: string) => `${routes.skill(skillId)}/versions`,
  version: (skillId: string, digest: string) => `${routes.skill(skillId)}/versions/${encodeURIComponent(digest)}`,
  head: (skillId: string) => `${routes.skill(skillId)}/head`,
  pins: (skillId: string) => `${routes.skill(skillId)}/pins`,
} as const;

const deletedSchema = z.object({ deleted: z.literal(true) });
const errorSchema = z.object({ error: z.string().min(1).max(100) });
const candidateSchema = z.object({
  uri: z.string(), name: z.string(), description: z.string(), score: z.number(), rank: z.number(),
  invocation: z.enum(["automatic", "explicit"]), digest: z.string(), matched: z.array(z.string()),
});
/** Mirrors the shared SearchOutcome type, which ships without a runtime schema. */
const searchOutcomeSchema = z.object({
  traceId: z.string(), query: z.string(), mode: z.enum(["discovery", "automatic", "explicit"]),
  candidates: z.array(candidateSchema), elapsedMs: z.number(),
  abstained: z.object({
    reason: z.enum(["empty_query", "no_overlap", "below_threshold", "explicit_only"]), hint: z.string(),
  }).optional(),
});
export type SearchResult = z.output<typeof searchOutcomeSchema>;
export type SearchCandidate = SearchResult["candidates"][number];

export class SkillsRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`${code} (${status})`);
    this.name = "SkillsRequestError";
    this.status = status;
    this.code = code;
  }
}

export type FailureKind =
  | "cancelled" | "unauthorized" | "forbidden" | "gone" | "conflict" | "protected" | "deleting"
  | "invalid-skill" | "invalid" | "too-large" | "rate-limited" | "unavailable" | "unreachable" | "unexpected" | "other";

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (error instanceof SkillsRequestError) {
    if (error.status === 401) return "unauthorized";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "gone";
    if (error.status === 429) return "rate-limited";
    if (error.status === 413) return "too-large";
    if (error.status >= 500) return "unavailable";
    switch (error.code) {
      case "head_conflict": return "conflict";
      case "version_protected": return "protected";
      case "skill_tombstoned": case "purge_pending": return "deleting";
      case "invalid_skill": return "invalid-skill";
      case "invalid_resource": case "invalid_request": case "archive_not_supported": case "package_integrity":
      case "resource_integrity": case "resource_missing": return "invalid";
      default: return "other";
    }
  }
  if (error instanceof TypeError) return "unreachable";
  if (error instanceof Error && /ZodError$/.test(error.name)) return "unexpected";
  return "other";
}

export function isUnauthorized(error: unknown): boolean {
  return classifyFailure(error) === "unauthorized";
}

export function describeFailure(error: unknown, action: string): string {
  switch (classifyFailure(error)) {
    case "cancelled": return `${action} 작업이 취소되었습니다.`;
    case "unauthorized": return "로그인이 만료되었습니다. 계속하려면 다시 로그인하세요.";
    case "forbidden": return `이 계정에서는 ${action} 작업을 할 수 없습니다.`;
    case "gone": return "보관함에서 이 스킬을 찾을 수 없습니다. 다른 곳에서 삭제했을 수 있습니다.";
    case "conflict": return "불러온 뒤 다른 곳에서 스킬이 바뀌었습니다. 수정 내용은 유지했습니다. 현재 버전을 확인한 뒤 다시 게시하세요.";
    case "protected": return "현재 버전과 고정한 버전은 삭제할 수 없습니다. 먼저 다른 버전을 현재 버전으로 선택하거나 고정을 해제하세요.";
    case "deleting": return "스킬을 삭제하는 중입니다. 보관함을 새로고침해 남은 내용을 확인하세요.";
    case "invalid-skill": return "SKILL.md를 처리하지 못했습니다. 맨 위 메타데이터에 name과 description이 필요합니다.";
    case "invalid": return `${action} 요청이 올바르지 않습니다. 파일을 확인하고 다시 시도하세요.`;
    case "too-large": return "패키지가 요청 한 번에 보낼 수 있는 크기를 넘었습니다. 파일을 줄이거나 제거한 뒤 다시 시도하세요.";
    case "rate-limited": return "요청이 너무 많습니다. 1분 후 다시 시도하세요.";
    case "unavailable": return "지금은 비공개 스킬을 이용할 수 없습니다. 나중에 다시 시도하세요.";
    case "unreachable": return `${action} 중 skillar에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.`;
    case "unexpected": return `${action} 응답의 형식을 확인할 수 없습니다. 이 화면의 상태는 바뀌지 않았습니다.`;
    case "other": return error instanceof SkillsRequestError ? `${action}에 실패했습니다 (${error.code}).` : `${action} 중 예상하지 못한 오류가 발생했습니다.`;
  }
}

export function technicalDetail(error: unknown): string | null {
  return error instanceof SkillsRequestError ? `${error.status} (${error.code})` : null;
}

async function errorCode(response: Response): Promise<string> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error : `http_${response.status}`;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return `http_${response.status}`;
    throw error;
  }
}

type CallInit = { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: object; readonly signal?: AbortSignal | undefined };

async function call<S extends z.ZodType>(path: string, schema: S, init: CallInit = {}): Promise<z.output<S>> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const response = await fetch(path, {
    method, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
  if (!response.ok) throw new SkillsRequestError(response.status, await errorCode(response));
  return schema.parse(await response.json());
}

export function readCatalog(signal?: AbortSignal): Promise<PrivateSkillCatalog> {
  return call(routes.catalog, privateSkillCatalogSchema, { signal });
}

export function readSkill(skillId: PrivateSkillId, signal?: AbortSignal): Promise<PrivateSkillDetail> {
  return call(routes.skill(skillId), privateSkillDetailSchema, { signal });
}

export function readExport(skillId: PrivateSkillId, digest: PrivateSkillDigest, signal?: AbortSignal): Promise<PrivateSkillExport> {
  return call(routes.version(skillId, digest), privateSkillExportSchema, { signal });
}

/** The acknowledgement literal is the person's explicit upload confirmation; the caller only sends it after the box is checked. */
export function publishVersion(
  skillId: PrivateSkillId, base: PrivateSkillHead | null, pkg: PrivateSkillPackage, signal?: AbortSignal,
): Promise<PrivateSkillDetail> {
  return call(routes.versions(skillId), privateSkillDetailSchema, {
    body: { base, acknowledgePrivateUpload: true, package: pkg }, signal,
  });
}

export function setHead(
  skillId: PrivateSkillId, base: PrivateSkillHead, targetDigest: PrivateSkillDigest, signal?: AbortSignal,
): Promise<PrivateSkillDetail> {
  return call(routes.head(skillId), privateSkillDetailSchema, { body: { base, targetDigest }, signal });
}

export function setPinned(
  skillId: PrivateSkillId, base: PrivateSkillHead, targetDigest: PrivateSkillDigest, pinned: boolean, signal?: AbortSignal,
): Promise<PrivateSkillDetail> {
  return call(routes.pins(skillId), privateSkillDetailSchema, { body: { base, targetDigest, pinned }, signal });
}

export async function deleteSkill(skillId: PrivateSkillId, base: PrivateSkillHead, signal?: AbortSignal): Promise<void> {
  await call(routes.skill(skillId), deletedSchema, { method: "DELETE", body: { base }, signal });
}

export function deleteVersion(
  skillId: PrivateSkillId, base: PrivateSkillHead, digest: PrivateSkillDigest, signal?: AbortSignal,
): Promise<PrivateSkillDetail> {
  return call(routes.version(skillId, digest), privateSkillDetailSchema, { method: "DELETE", body: { base }, signal });
}

export function searchSkills(query: string, mode: SearchMode, limit: number, signal?: AbortSignal): Promise<SearchResult> {
  return call(routes.search, searchOutcomeSchema, { body: { query, mode, limit }, signal });
}
