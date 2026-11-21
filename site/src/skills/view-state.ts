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
  readonly readStates: readonly string[];
  readonly agents: readonly string[];
  readonly days: readonly string[];
  readonly hidden: readonly string[];
  readonly density: "compact" | "normal" | "spacious";
  readonly digest: string;
  readonly tab: string;
  /** 활동 열·필터의 조회 창(KST 일자 수). */
  readonly period: 7 | 30 | 90;
};

export function readSkillsView(href: string): SkillsView {
  const url = new URL(href);
  const sort = url.searchParams.get("sort");
  const parsed = privateSkillIdSchema.safeParse(url.searchParams.get("skill"));
  const legacy = skillIdFromHash(url.hash);
  const selected = parsed.success ? parsed.data : legacy;
  const full = url.searchParams.get("view") === "full" || legacy !== null;
  const defaultTab = selected !== null && !full ? "versions" : "document";
  const tab = url.searchParams.get("tab") ?? defaultTab;
  return {
    q: url.searchParams.get("q") ?? "",
    sort: sort === "name" || sort === "revision" || sort === "digest" ? sort : "updated",
    descending: url.searchParams.get("order") !== "asc",
    selected,
    full,
    readStates: url.searchParams.getAll("read"),
    agents: url.searchParams.getAll("agent"),
    days: url.searchParams.getAll("day"),
    hidden: [...new Set(url.searchParams.getAll("hide").filter(id => ["revision", "updated", "digest", "usage", "agents"].includes(id)))],
    density: url.searchParams.get("density") === "normal" ? "normal" : url.searchParams.get("density") === "spacious" ? "spacious" : "compact",
    digest: url.searchParams.get("version") ?? "",
    period: url.searchParams.get("period") === "7" ? 7 : url.searchParams.get("period") === "90" ? 90 : 30,
    tab: ["document", "versions", "reads", "compare", "files"].includes(tab) ? tab : defaultTab,
  };
}

export function skillsViewUrl(view: SkillsView): string {
  const query = new URLSearchParams();
  if (view.q !== "") query.set("q", view.q);
  query.set("sort", view.sort);
  query.set("order", view.descending ? "desc" : "asc");
  if (view.selected !== null) query.set("skill", view.selected);
  if (view.full && view.selected !== null) query.set("view", "full");
  for (const state of view.readStates) query.append("read", state);
  for (const agent of view.agents) query.append("agent", agent);
  for (const day of view.days) query.append("day", day);
  for (const column of view.hidden) query.append("hide", column);
  query.set("density", view.density);
  if (view.period !== 30) query.set("period", String(view.period));
  if (view.digest !== "") query.set("version", view.digest);
  if (view.selected !== null || view.tab !== "document") query.set("tab", view.tab);
  return `/skills/?${query}`;
}
