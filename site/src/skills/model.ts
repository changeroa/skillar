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
        if (draft.document !== "") notes.push("SKILL.md text was replaced by the picked file.");
      } catch (error) {
        if (!(error instanceof SkillDraftError)) throw error;
        notes.push("The picked SKILL.md isn't UTF-8 text, so it was not used.");
      }
      continue;
    }
    if (files.has(file.path.toLowerCase())) notes.push(`${file.path} replaced the earlier file with that path.`);
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
  if (draft.document.trim() === "") problems.push("Add a SKILL.md: pick a folder or files that contain one, or type the document.");
  else {
    const front = readFrontMatter(draft.document);
    if (front.name === null) problems.push("SKILL.md front matter needs a name: line; the library shows that name.");
    if (front.description === null) problems.push("SKILL.md front matter needs a description: line; the library shows that description.");
    if (document.length > ENTRYPOINT_MAX_BYTES) problems.push(`SKILL.md must be at most ${formatBytes(ENTRYPOINT_MAX_BYTES)}; it is ${formatBytes(document.length)}.`);
  }
  if (draft.files.length + 1 > PRIVATE_SKILL_MAX_RESOURCES) problems.push(`A skill can hold at most ${PRIVATE_SKILL_MAX_RESOURCES} files including SKILL.md.`);
  for (const file of draft.files) {
    if (file.path === ENTRYPOINT) problems.push("SKILL.md belongs in the document field, not in the supporting files.");
    else if (!privateSkillPathSchema.safeParse(file.path).success) {
      problems.push(`${file.path} isn't a portable path. Use letters, numbers, spaces, dots, dashes and underscores, and no archive extension.`);
    }
    if (file.bytes.length > PRIVATE_SKILL_MAX_RESOURCE_BYTES) {
      problems.push(`${file.path} is ${formatBytes(file.bytes.length)}; each file must be at most ${formatBytes(PRIVATE_SKILL_MAX_RESOURCE_BYTES)}.`);
    }
  }
  const total = document.length + draft.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > PRIVATE_SKILL_MAX_BYTES) problems.push(`All files together are ${formatBytes(total)}; the limit is ${formatBytes(PRIVATE_SKILL_MAX_BYTES)}.`);
  if (!draft.acknowledged) problems.push("Confirm the upload with the checkbox before publishing.");
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
        ? "One file is a compressed archive. Archives aren't supported; add the extracted files instead."
        : `${archive} is a compressed archive. Archives aren't supported; add the extracted files instead.`] };
    }
    return { ok: false, problems: ["The files can't form one skill package. Check for paths that differ only by case or a file that is also a folder."] };
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
