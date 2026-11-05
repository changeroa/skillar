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
  };
}

export function skillsViewUrl(view: SkillsView): string {
  const query = new URLSearchParams();
  if (view.q !== "") query.set("q", view.q);
  query.set("sort", view.sort);
  query.set("order", view.descending ? "desc" : "asc");
  if (view.selected !== null) query.set("skill", view.selected);
  if (view.full && view.selected !== null) query.set("view", "full");
  return `/skills/?${query}`;
}
