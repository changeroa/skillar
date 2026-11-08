import { h } from "preact";
import { describeFailure, technicalDetail } from "./api.ts";
import { SkillDraftError } from "./model.ts";
import type { DraftState, Note } from "./skill-state.ts";
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isDirty(state: DraftState): boolean {
  return state.status === "ready" && (state.draft.document !== state.baseline.document || state.draft.files !== state.baseline.files);
}

export function failureNote(error: unknown, action: string): Note {
  return { text: describeFailure(error, action), technical: technicalDetail(error) };
}

export function describeDraftFailure(error: unknown): string {
  if (error instanceof SkillDraftError) {
    return error.code === "document_not_text"
      ? "이 버전의 SKILL.md는 UTF-8 텍스트가 아니어서 여기서 편집할 수 없습니다. 이전 버전은 내보낼 수 있습니다."
      : "이 버전에는 SKILL.md가 없어 여기서 편집할 수 없습니다.";
  }
  return describeFailure(error, "현재 버전 불러오기");
}

export function NoteLine({ note }: { readonly note: Note }) {
  return [
    h("span", { key: "text", class: "note", role: "status", "aria-live": "polite" }, note.text),
    note.technical !== null && h("details", { key: "technical", class: "technical" }, h("summary", null, "기술 정보"), h("code", null, note.technical)),
  ];
}
