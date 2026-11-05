import type { PrivateSkillDetail, PrivateSkillPackage } from "../../../shared/dist/private-skills.js";
import { publishVersion } from "./api.ts";
import { buildPackage } from "./model.ts";
import type { Draft } from "./model.ts";

type Publication =
  | { readonly ok: false; readonly problems: readonly string[] }
  | { readonly ok: true; readonly detail: PrivateSkillDetail; readonly package: PrivateSkillPackage };

/** The caller owns the busy lock for the entire preparation and transfer. */
export async function publishDraft(draft: Draft, signal: AbortSignal): Promise<Publication> {
  const built = await buildPackage(draft);
  if (!built.ok) return built;
  const detail = await publishVersion(draft.skillId, draft.base, built.package, signal);
  return { ok: true, detail, package: built.package };
}
