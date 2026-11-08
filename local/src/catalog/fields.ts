import type { SkillEntry } from "../types.js";
import { familyPrefix } from "../../../shared/dist/skill-fields.js";
export { BODY_HEAD_MAX, splitSkillMarkdown, stringList, bodyHead, extractFields, familyPrefix } from "../../../shared/dist/skill-fields.js";
export type { SkillFields } from "../../../shared/dist/skill-fields.js";

/**
 * Assigns derived groups (prefix families with >= 2 distinct names) to entries lacking an explicit group,
 * and returns every family: explicit groups plus derived prefix families, uris sorted.
 */
export function applyFamilies(entries: SkillEntry[], explicit: Map<string, { id: string; stage?: string } | undefined>): { id: string; uris: string[] }[] {
  const namesByPrefix = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (explicit.get(entry.uri)) continue;
    const prefix = familyPrefix(entry.name);
    if (!namesByPrefix.has(prefix)) namesByPrefix.set(prefix, new Set());
    namesByPrefix.get(prefix)!.add(entry.name);
  }
  const families = new Map<string, string[]>();
  for (const entry of entries) {
    const group = explicit.get(entry.uri);
    if (group) {
      entry.group = group;
    } else {
      const prefix = familyPrefix(entry.name);
      if ((namesByPrefix.get(prefix)?.size ?? 0) >= 2) entry.group = { id: prefix };
      else delete entry.group;
    }
    if (entry.group) {
      if (!families.has(entry.group.id)) families.set(entry.group.id, []);
      families.get(entry.group.id)!.push(entry.uri);
    }
  }
  return [...families.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, uris]) => ({ id, uris: uris.sort() }));
}
