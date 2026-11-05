import {
  PRIVATE_SKILL_MAX_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES, PRIVATE_SKILL_MAX_RESOURCES,
  PrivateSkillContractError, privateSkillIdSchema, privateSkillPathSchema,
} from "../../../shared/dist/private-skills.js";
import type {
  PrivateSkillCatalog, PrivateSkillExport, PrivateSkillHead, PrivateSkillId, PrivateSkillPackage, PrivateSkillSummary,
} from "../../../shared/dist/private-skills.js";
import { createPrivateSkillPackage, verifyPrivateSkillPackage } from "../../../shared/dist/private-skill-package.js";
import { privateSkillMediaType as mediaTypeFor } from "../../../shared/dist/private-skill-media.js";
import { splitSkillMarkdown } from "../../../shared/dist/skill-fields.js";
export { mediaTypeFor };

export const ENTRYPOINT = "SKILL.md";
export const ENTRYPOINT_MAX_BYTES = PRIVATE_SKILL_MAX_RESOURCE_BYTES;
export const ENTRYPOINT_MEDIA_TYPE = "text/markdown";

const encoder = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type Picked = { readonly name: string; readonly relativePath: string };

/** Folder picks arrive as `<folder>/<path>`; the folder's own name is stripped, nested paths are kept, plain file picks keep their names. */
export function relativePaths(picked: readonly Picked[]): readonly string[] {
  const paths = picked.map(entry => (entry.relativePath === "" ? entry.name : entry.relativePath).split("/").filter(segment => segment !== ""));
  const root = paths[0]?.[0];
  const sharedRoot = root !== undefined && paths.every(segments => segments.length > 1 && segments[0] === root);
  return paths.map(segments => (sharedRoot ? segments.slice(1) : segments).join("/"));
}

export type FrontMatter = { readonly name: string | null; readonly description: string | null };

export function readFrontMatter(text: string): FrontMatter {
  // Match the server's metadata decode without changing the stored document.
  const { frontmatter } = splitSkillMarkdown(text.replace(/^\uFEFF/, ""), { rejectAliases: true });
  const field = (key: string): string | null => {
    const value = frontmatter?.[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  return { name: field("name"), description: field("description") };
}

export type DraftFile = { readonly path: string; readonly mediaType: string; readonly bytes: Uint8Array };
export type Draft = {
  readonly skillId: PrivateSkillId;
  readonly base: PrivateSkillHead | null;
  readonly document: string;
  readonly files: readonly DraftFile[];
  readonly acknowledged: boolean;
};

export function newSkillId(): PrivateSkillId {
  return privateSkillIdSchema.parse(crypto.randomUUID());
}

export function emptyDraft(skillId: PrivateSkillId = newSkillId()): Draft {
  return { skillId, base: null, document: "", files: [], acknowledged: false };
}

export type SkillDraftErrorCode = "document_not_text" | "document_missing";

export class SkillDraftError extends Error {
  readonly name = "SkillDraftError";
  readonly code: SkillDraftErrorCode;
  constructor(code: SkillDraftErrorCode) {
    super(code);
    this.code = code;
  }
}

/** The export is verified byte-for-byte before anything is shown or edited. */
export async function draftFromExport(exported: PrivateSkillExport, base: PrivateSkillHead): Promise<Draft> {
  const verified = await verifyPrivateSkillPackage(exported.package);
  const files: DraftFile[] = [];
  let document: string | null = null;
  for (const resource of verified.package.manifest.resources) {
    const bytes = verified.files.get(resource.path);
    if (bytes === undefined) throw new SkillDraftError("document_missing");
    if (resource.path === ENTRYPOINT) document = decodeDocument(bytes);
    else files.push({ path: resource.path, mediaType: resource.mediaType, bytes });
  }
  if (document === null) throw new SkillDraftError("document_missing");
  return { skillId: exported.skillId, base, document, files, acknowledged: false };
}

export function decodeDocument(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new SkillDraftError("document_not_text");
    throw error;
  }
}

export type Merge = { readonly draft: Draft; readonly notes: readonly string[] };

export function mergePickedFiles(draft: Draft, picked: readonly DraftFile[]): Merge {
  const notes: string[] = [];
  let document = draft.document;
  const files = new Map(draft.files.map(file => [file.path.toLowerCase(), file] as const));
  for (const file of picked) {
    if (file.path === ENTRYPOINT) {
      try {
        document = decodeDocument(file.bytes);
        if (draft.document !== "") notes.push("선택한 파일로 SKILL.md 텍스트를 바꿨습니다.");
      } catch (error) {
        if (!(error instanceof SkillDraftError)) throw error;
        notes.push("선택한 SKILL.md는 UTF-8 텍스트가 아니어서 사용하지 않았습니다.");
      }
      continue;
    }
    if (files.has(file.path.toLowerCase())) notes.push(`${file.path}로 같은 경로의 기존 파일을 바꿨습니다.`);
    files.set(file.path.toLowerCase(), file);
  }
  return { draft: { ...draft, document, files: [...files.values()] }, notes };
}

export function removeFile(draft: Draft, path: string): Draft {
  return { ...draft, files: draft.files.filter(file => file.path !== path) };
}

export function draftProblems(draft: Draft): readonly string[] {
  const problems: string[] = [];
  const document = encoder.encode(draft.document);
  if (draft.document.trim() === "") problems.push("SKILL.md가 있는 폴더나 파일을 선택하거나 문서를 직접 입력하세요.");
  else {
    const front = readFrontMatter(draft.document);
    if (front.name === null) problems.push("SKILL.md 맨 위 메타데이터에 name: 항목이 필요합니다. 보관함에 표시할 이름입니다.");
    if (front.description === null) problems.push("SKILL.md 맨 위 메타데이터에 description: 항목이 필요합니다. 보관함에 표시할 설명입니다.");
    if (document.length > ENTRYPOINT_MAX_BYTES) problems.push(`SKILL.md는 ${formatBytes(ENTRYPOINT_MAX_BYTES)} 이하여야 합니다. 현재 크기는 ${formatBytes(document.length)}입니다.`);
  }
  if (draft.files.length + 1 > PRIVATE_SKILL_MAX_RESOURCES) problems.push(`스킬 하나에는 SKILL.md를 포함해 파일을 최대 ${PRIVATE_SKILL_MAX_RESOURCES}개 담을 수 있습니다.`);
  for (const file of draft.files) {
    if (file.path === ENTRYPOINT) problems.push("SKILL.md는 추가 파일이 아니라 문서 입력란에 넣어야 합니다.");
    else if (!privateSkillPathSchema.safeParse(file.path).success) {
      problems.push(`${file.path}는 지원하는 경로 형식이 아닙니다. 문자·숫자·공백·점·하이픈·밑줄을 사용하고 압축 파일 확장자는 제외하세요.`);
    }
    if (file.bytes.length > PRIVATE_SKILL_MAX_RESOURCE_BYTES) {
      problems.push(`${file.path}의 크기는 ${formatBytes(file.bytes.length)}입니다. 파일 하나는 ${formatBytes(PRIVATE_SKILL_MAX_RESOURCE_BYTES)} 이하여야 합니다.`);
    }
  }
  const total = document.length + draft.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > PRIVATE_SKILL_MAX_BYTES) problems.push(`전체 파일 크기는 ${formatBytes(total)}입니다. 최대 ${formatBytes(PRIVATE_SKILL_MAX_BYTES)}까지 보낼 수 있습니다.`);
  if (!draft.acknowledged) problems.push("게시하려면 체크박스로 업로드에 동의하세요.");
  return problems;
}

export type Built = { readonly ok: true; readonly package: PrivateSkillPackage } | { readonly ok: false; readonly problems: readonly string[] };

export async function buildPackage(draft: Draft): Promise<Built> {
  const problems = draftProblems(draft);
  if (problems.length > 0) return { ok: false, problems };
  const entry: DraftFile = { path: ENTRYPOINT, mediaType: ENTRYPOINT_MEDIA_TYPE, bytes: encoder.encode(draft.document) };
  try {
    return { ok: true, package: await createPrivateSkillPackage([entry, ...draft.files]) };
  } catch (error) {
    if (!(error instanceof PrivateSkillContractError)) throw error;
    if (error.code === "archive_not_supported") {
      const archive = await findArchive(entry, draft.files);
      return { ok: false, problems: [archive === null
        ? "압축 파일이 포함되어 있습니다. 압축 파일은 지원하지 않으므로 압축을 푼 파일을 추가하세요."
        : `${archive}는 압축 파일입니다. 압축 파일은 지원하지 않으므로 압축을 푼 파일을 추가하세요.`] };
    }
    return { ok: false, problems: ["스킬 패키지를 만들 수 없습니다. 대소문자만 다른 경로나 파일과 폴더가 같은 경로를 쓰는지 확인하세요."] };
  }
}

async function findArchive(entry: DraftFile, files: readonly DraftFile[]): Promise<string | null> {
  for (const file of files) {
    try {
      await createPrivateSkillPackage([entry, file]);
    } catch (error) {
      if (error instanceof PrivateSkillContractError && error.code === "archive_not_supported") return file.path;
      if (!(error instanceof PrivateSkillContractError)) throw error;
    }
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function exportFileName(name: string, digest: string): string {
  const slug = name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `skill-${slug === "" ? "skill" : slug}-${digest.slice(0, 8)}.json`;
}

export function skillHash(skillId: string): string {
  return `#skill/${skillId}`;
}

export function skillIdFromHash(hash: string): PrivateSkillId | null {
  const candidate = /^#skill\/([0-9a-f-]{36})$/i.exec(hash)?.[1];
  const parsed = candidate === undefined ? null : privateSkillIdSchema.safeParse(candidate.toLowerCase());
  return parsed?.success ? parsed.data : null;
}

export function sortByUpdated(catalog: PrivateSkillCatalog): readonly PrivateSkillSummary[] {
  return [...catalog.skills].sort((a, b) => b.updatedAt - a.updatedAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
