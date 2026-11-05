import { privateSkillIdSchema } from "../../../shared/dist/private-skills.js";
import type { PrivateSkillId } from "../../../shared/dist/private-skills.js";
import { skillIdFromHash } from "./model.ts";

export type SkillSort = "name" | "revision" | "updated" | "digest";
export type SkillsView = {
  readonly q: string;
  readonly sort: SkillSort;
  readonly descending: boolean;
  readonly selected: PrivateSkillId | null;
  readonly full: boolean;
  readonly revisions: readonly string[];
  readonly days: readonly string[];
  readonly hidden: readonly string[];
  readonly density: "compact" | "normal" | "spacious";
  readonly digest: string;
  readonly tab: string;
};

export function readSkillsView(href: string): SkillsView {
  const url = new URL(href);
  const sort = url.searchParams.get("sort");
  const parsed = privateSkillIdSchema.safeParse(url.searchParams.get("skill"));
  const legacy = skillIdFromHash(url.hash);
  return {
    q: url.searchParams.get("q") ?? "",
    sort: sort === "name" || sort === "revision" || sort === "digest" ? sort : "updated",
    descending: url.searchParams.get("order") !== "asc",
    selected: parsed.success ? parsed.data : legacy,
    full: url.searchParams.get("view") === "full" || legacy !== null,
    revisions: url.searchParams.getAll("revision"),
    days: url.searchParams.getAll("day"),
    hidden: [...new Set(url.searchParams.getAll("hide").filter(id => ["revision", "updated", "digest"].includes(id)))],
    density: url.searchParams.get("density") === "normal" ? "normal" : url.searchParams.get("density") === "spacious" ? "spacious" : "compact",
    digest: url.searchParams.get("version") ?? "",
    tab: ["versions", "compare", "files"].includes(url.searchParams.get("tab") ?? "") ? url.searchParams.get("tab") ?? "document" : "document",
  };
}

export function skillsViewUrl(view: SkillsView): string {
  const query = new URLSearchParams();
  if (view.q !== "") query.set("q", view.q);
  query.set("sort", view.sort);
  query.set("order", view.descending ? "desc" : "asc");
  if (view.selected !== null) query.set("skill", view.selected);
  if (view.full && view.selected !== null) query.set("view", "full");
  for (const revision of view.revisions) query.append("revision", revision);
  for (const day of view.days) query.append("day", day);
  for (const column of view.hidden) query.append("hide", column);
  query.set("density", view.density);
  if (view.digest !== "") query.set("version", view.digest);
  if (view.tab !== "document") query.set("tab", view.tab);
  return `/skills/?${query}`;
}
