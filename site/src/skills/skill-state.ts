import type { PrivateSkillDetail, PrivateSkillDigest, PrivateSkillId, PrivateSkillManifest, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import type { Draft } from "./model.ts";
import type { SkillsView } from "./view-state.ts";
export type SkillProps = {
  readonly skillId: PrivateSkillId;
  readonly summary: PrivateSkillSummary | null;
  readonly signal: AbortSignal;
  readonly focusHeading: number;
  readonly onChanged: () => void;
  readonly onDeleted: (name: string) => void;
  readonly onBack: () => void;
  readonly onUnauthorized: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onResolved?: (skill: PrivateSkillSummary) => void;
  readonly view?: SkillsView;
  readonly onViewChange?: (view: SkillsView) => void;
  readonly returnFocus?: HTMLElement | null;
  readonly fullPageHref?: string;
  readonly onFullPage?: () => void;
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
};

export type Version = PrivateSkillDetail["versions"][number];
export type Resources = PrivateSkillManifest["resources"];
export type DetailState =
  | { readonly status: "loading"; readonly detail: PrivateSkillDetail | null }
  | { readonly status: "ready"; readonly detail: PrivateSkillDetail }
  | { readonly status: "failed"; readonly detail: PrivateSkillDetail | null; readonly message: string }
  | { readonly status: "gone"; readonly message: string };
export type DraftState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly draft: Draft; readonly baseline: Draft; readonly resources: Resources }
  | { readonly status: "failed"; readonly message: string };
export type Note = { readonly text: string; readonly technical: string | null };
export type Pending = { readonly kind: "skill" } | { readonly kind: "version"; readonly digest: PrivateSkillDigest };
export type DeleteTarget = { readonly kind: "skill"; readonly name: string } | { readonly kind: "version"; readonly digest: PrivateSkillDigest };
