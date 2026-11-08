import { z } from "zod";
import type { ContentRow } from "../activity-content.js";
import type { SkillEntry } from "./types.js";
import { compareSql } from "./base.js";

const skillSchema = z.object({
  uri: z.string(), root_id: z.string(), name: z.string(), description: z.string(),
  tags_json: z.string(), when_to_use: z.string().nullable(), examples_json: z.string(),
  aliases_ko_json: z.string(), group_id: z.string().nullable(), group_stage: z.string().nullable(),
  invocation: z.enum(["automatic", "explicit"]), body_head: z.string(), digest: z.string(),
  manifest_digest: z.string(), resources_json: z.string(), mtime_ms: z.number(),
  removed_at: z.number().nullable(),
});
const strings = z.array(z.string());
const resources = z.array(z.object({ uri: z.string(), digest: z.string(), size: z.number() }));

/** Catalog fields retained in source facts; optional raw YAML frontmatter is not in the snapshot. */
export function catalogSkills(rows: readonly ContentRow[]): SkillEntry[] {
  return rows.filter(row => row.table === "skills").map(row => skillSchema.parse(row.values))
    .filter(row => row.removed_at === null).sort((a, b) => compareSql(a.uri, b.uri)).map(row => ({
      uri: row.uri, rootId: row.root_id,
      dir: new URL(row.uri).pathname.split("/").slice(2, -1).map(decodeURIComponent).join("/"),
      name: row.name, description: row.description, tags: strings.parse(JSON.parse(row.tags_json)),
      ...(row.when_to_use === null ? {} : { whenToUse: row.when_to_use }),
      examples: strings.parse(JSON.parse(row.examples_json)), aliasesKo: strings.parse(JSON.parse(row.aliases_ko_json)),
      ...(row.group_id === null ? {} : { group: {
        id: row.group_id, ...(row.group_stage === null ? {} : { stage: row.group_stage }),
      } }),
      invocation: row.invocation, bodyHead: row.body_head, digest: row.digest, manifestDigest: row.manifest_digest,
      resources: resources.parse(JSON.parse(row.resources_json)), mtimeMs: row.mtime_ms,
    }));
}
