import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const BODY_HEAD_MAX = 600;
const recordSchema = z.record(z.string(), z.unknown());
export type SkillFields = {
  readonly name: string; readonly description: string; readonly tags: string[];
  readonly whenToUse?: string; readonly examples: string[]; readonly aliasesKo: string[];
  readonly group?: { readonly id: string; readonly stage?: string };
  readonly invocation: "automatic" | "explicit"; readonly bodyHead: string;
};

/** Local parsing retains its alias policy; untrusted private uploads may refuse aliases. */
export function splitSkillMarkdown(
  input: string, options: { readonly rejectAliases?: boolean } = {},
): { readonly frontmatter: Record<string, unknown> | null; readonly body: string } {
  const markdown = input.replace(/\r\n/g, "\n");
  if (!markdown.startsWith("---\n")) return { frontmatter: null, body: markdown };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: null, body: markdown };
  const afterDelimiter = markdown.slice(end + 4, end + 5);
  if (afterDelimiter !== "" && afterDelimiter !== "\n") return { frontmatter: null, body: markdown };
  const body = markdown.slice(end + 5);
  let parsed: unknown;
  try {
    parsed = parseYaml(markdown.slice(4, end), options.rejectAliases ? { maxAliasCount: 0 } : {});
  } catch (error) {
    if (error instanceof Error) return { frontmatter: null, body };
    throw error;
  }
  const result = recordSchema.safeParse(parsed);
  return { frontmatter: result.success ? result.data : null, body };
}

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
    .map(item => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(item => item.trim()).filter(Boolean);
  return [];
}
function explicitGroup(value: unknown): SkillFields["group"] {
  if (typeof value === "string" && value.trim()) return { id: value.trim() };
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  if (typeof record.id !== "string" || !record.id.trim()) return undefined;
  const stage = typeof record.stage === "string" && record.stage.trim() ? record.stage.trim() :
    typeof record.stage === "number" ? String(record.stage) : undefined;
  return stage === undefined ? { id: record.id.trim() } : { id: record.id.trim(), stage };
}
export function bodyHead(body: string): string {
  let inFence = false;
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (current.length) { paragraphs.push(current.join(" ")); current = []; }
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) {
      if (current.length) { paragraphs.push(current.join(" ")); current = []; }
      continue;
    }
    if (/^\s{0,3}#/.test(line)) {
      if (current.length) { paragraphs.push(current.join(" ")); current = []; }
      continue;
    }
    current.push(line.trim());
    if (current.join(" ").length > BODY_HEAD_MAX) break;
  }
  if (current.length) paragraphs.push(current.join(" "));
  return (paragraphs.find(paragraph => paragraph.trim()) ?? "")
    .replace(/\s+/g, " ").trim().slice(0, BODY_HEAD_MAX);
}

/** Same routing-field semantics for local scanning and private publication. */
export function extractFields(frontmatter: Record<string, unknown>, body: string): SkillFields | null {
  const { name, description, compatibility, metadata, license } = frontmatter;
  if (typeof name !== "string" || [...name].length < 1 || [...name].length > 64 ||
      name !== name.toLowerCase() || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(name)) return null;
  if (typeof description !== "string" || !description.trim() || [...description].length > 1024) return null;
  if (compatibility !== undefined && (typeof compatibility !== "string" ||
      !compatibility.trim() || [...compatibility].length > 500)) return null;
  if (license !== undefined && typeof license !== "string") return null;
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") return null;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.values(metadata).some(value => typeof value !== "string"))) return null;
  const whenRaw = frontmatter.when_to_use ?? frontmatter["when-to-use"];
  const group = explicitGroup(frontmatter.group);
  return {
    name, description, tags: stringList(frontmatter.tags),
    examples: stringList(frontmatter.examples), aliasesKo: stringList(frontmatter.aliases_ko),
    invocation: frontmatter["disable-model-invocation"] === true ||
      frontmatter["disable-model-invocation"] === "true" ? "explicit" : "automatic",
    bodyHead: bodyHead(body),
    ...(typeof whenRaw === "string" && whenRaw.trim() ? { whenToUse: whenRaw.trim() } : {}),
    ...(group === undefined ? {} : { group }),
  };
}
export function familyPrefix(name: string): string {
  const index = name.indexOf("-");
  return index === -1 ? name : name.slice(0, index);
}
