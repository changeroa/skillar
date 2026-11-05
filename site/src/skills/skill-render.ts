import { h } from "preact";
import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import type { PrivateSkillDetail, PrivateSkillDigest } from "../../../shared/dist/private-skills.js";
import { deleteVersion, setHead, setPinned } from "./api.ts";
import { DraftEditor } from "./editor.ts";
import { when } from "./library.ts";
import { triggerId } from "./skill-delete.ts";
import { NoteLine, isDirty } from "./skill-notes.ts";
import type { Version } from "./skill-state.ts";
import type { useSkillController } from "./skill.ts";
import { VersionDiff } from "./diff-panel.ts";
import { KeyValueGrid, Pill, SegmentedTabs } from "../ui/index.ts";
import { UnmeasuredReads, VersionDocument, VersionFiles } from "./document.ts";

function VersionBreadcrumb({ detail, digest, onSelect }: {
  readonly detail: PrivateSkillDetail; readonly digest: PrivateSkillDigest; readonly onSelect: (digest: string) => void;
}) {
  const target = document.getElementById("skill-breadcrumb")?.parentElement;
  if (!target) return null;
  return createPortal(h("span", { class: "skills-breadcrumb-controls" },
    h("span", { "aria-hidden": "true" }, "›"),
    h("span", { class: "skills-breadcrumb-name", title: detail.skill.name }, detail.skill.name),
    h("label", { class: "skills-version-label" }, "버전",
      h("select", { "aria-label": "스킬 버전", value: digest,
        onChange: (event: JSX.TargetedEvent<HTMLSelectElement>) => onSelect(event.currentTarget.value) },
      detail.versions.map(version => h("option", { value: version.digest, key: version.digest },
        `${version.digest === detail.skill.head.digest ? `r${detail.skill.head.revision} · 현재` : "보관"} · ${version.digest.slice(0, 8)}`))))), target);
}

export function SkillView(controller: ReturnType<typeof useSkillController>) {
  const { detailState, draftState, detail, name, head, heading, busy, dirty, pending, notes, problems, conflict, publishNote,
    versionsNote, deleteNote, setRetry, setDraftState, setNotes, loadDraft, run, review, publish, exportVersion, removeSkill,
    openConfirmation, confirmation, onBack, skillId, signal, onUnauthorized, summary, workspace, digest, versionPreview } = controller;
  const peek = workspace.view !== undefined && !workspace.view.full;
  const orderedVersions = [...(detail?.versions ?? [])].sort((a, b) =>
    Number(b.digest === head?.digest) - Number(a.digest === head?.digest) || b.createdAt - a.createdAt);
  const selectVersion = (next: string) => {
    if (workspace.view) workspace.onViewChange?.({ ...workspace.view, digest: next });
  };
  const panelHead = h("div", { class: "panel__head skill-title-row" },
    h("h2", { id: "skill-title", ref: heading, tabIndex: -1 }, name || "스킬"),
    !peek && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => {
      if (workspace.view || !dirty || confirm("저장하지 않은 수정 내용이 사라집니다. 보관함으로 돌아갈까요?")) onBack();
    } }, "보관함으로 돌아가기"));
  if (detailState.status === "gone") return h("section", { class: "skill", "aria-labelledby": "skill-title" },
    panelHead, h("p", { class: "note", role: "status" }, detailState.message),
    draftState.status === "ready" && h("textarea", { class: "document-field", rows: 12, readOnly: true,
      "aria-label": "SKILL.md 수정 내용", value: draftState.draft.document }));

  const versionRow = (version: Version) => {
    const current = head !== null && version.digest === head.digest;
    const reason = current ? "현재 버전입니다. 삭제하려면 먼저 다른 버전을 현재 버전으로 선택하세요."
      : version.pinned ? "고정한 버전입니다. 삭제하려면 먼저 고정을 해제하세요." : null;
    const confirming = pending?.kind === "version" && pending.digest === version.digest;
    return h("li", { key: version.digest, class: "version", "data-current": current ? "true" : undefined },
      h("div", { class: "version__meta" },
        h("p", { class: "version__flags" }, current ? "현재 버전" : "이전 버전", version.pinned && " · 고정됨"),
        h("p", { class: "note" }, "생성 ", when(version.createdAt)),
        h("code", { class: "version__digest", title: version.digest }, peek ? version.digest.slice(0, 8) : version.digest)),
      h(peek ? "details" : "div", { class: "cluster version__actions" },
        peek && h("summary", null, "작업"),
        workspace.view && h("button", { class: "button secondary", type: "button", onClick: () => selectVersion(version.digest) }, "문서 선택"),
        !current && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => run("현재 버전 변경", () => setHead(skillId, head, version.digest, signal)) }, "현재 버전으로 선택"),
        head !== null && h("button", { class: "button secondary", type: "button", disabled: busy, "aria-pressed": version.pinned,
          onClick: () => run(version.pinned ? "버전 고정 해제" : "버전 고정", () => setPinned(skillId, head, version.digest, !version.pinned, signal)) }, version.pinned ? "고정 해제" : "고정"),
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => exportVersion(version.digest) }, h("code", null, "JSON"), " 내보내기"),
        reason === null && head !== null && (confirming
          ? confirmation({ kind: "version", digest: version.digest }, "내 계정에서 이 버전의 파일을 삭제합니다. 되돌릴 수 없습니다.", "버전 유지",
            () => run("버전 삭제", () => deleteVersion(skillId, head, version.digest, signal)))
          : h("button", { id: triggerId({ kind: "version", digest: version.digest }), class: "button secondary danger-quiet",
            type: "button", disabled: busy, onClick: () => openConfirmation({ kind: "version", digest: version.digest }) }, "버전 삭제…")),
        reason !== null && h("span", { class: "note version__protected" }, reason)));
  };
  const editor = draftState.status === "ready" && detail !== null && h("details", { class: "skill-editor-disclosure" },
    h("summary", null, "현재 버전 편집·게시"),
    h("form", { class: "publish", onSubmit: publish, "aria-labelledby": "edit-title" },
      h("h3", { id: "edit-title", class: "panel__subtitle" }, "새 버전 편집·게시"),
      draftState.draft.base !== null && h("p", { class: "note" }, `리비전 ${draftState.draft.base.revision}에서 시작한 수정본입니다. 선택한 과거 버전의 미리보기와 별개입니다. 게시 전에는 이 화면에만 보관합니다.`),
      h(DraftEditor, { draft: draftState.draft, idPrefix: "edit-skill", busy, notes, showErrors: problems.length > 0,
        onChange: (next, newNotes) => {
          setDraftState(current => {
            switch (current.status) {
              case "ready": return { ...current, draft: typeof next === "function" ? next(current.draft) : next };
              case "loading": case "failed": return current;
              default: { const exhaustive: never = current; return exhaustive; }
            }
          });
          if (newNotes.length > 0) setNotes(newNotes);
        } }),
      isDirty(draftState) && h("p", { class: "note", role: "status" }, "저장하지 않은 수정 내용이 있습니다."),
      problems.length > 0 && h("div", { role: "alert" }, h("ul", { class: "problems" }, problems.map(problem => h("li", { key: problem }, problem)))),
      h("div", { class: "cluster publish__actions" },
        h("button", { class: "button primary", type: "submit", disabled: busy }, "새 버전 게시"),
        conflict && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: review }, "현재 버전 확인"),
        isDirty(draftState) && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => loadDraft(head) }, "수정 내용 버리고 현재 버전 불러오기"),
        h(NoteLine, { note: publishNote }))));
  const versions = detail !== null && h("section", { "aria-labelledby": "versions-title" },
    h("h3", { id: "versions-title", class: "panel__subtitle", tabIndex: -1 }, "버전"),
    h("p", { class: "note" }, "현재 버전은 에이전트가 받는 버전입니다. 고정한 버전은 삭제할 수 없습니다."),
    h("div", { class: "cluster versions__note" }, h(NoteLine, { note: versionsNote })),
    h("ul", { class: "version-list" }, orderedVersions.map(versionRow)));
  const rail = detail !== null && h("aside", { class: "skill-version-rail", "aria-label": "버전 인덱스" },
    h("h3", { class: "panel__subtitle" }, "버전 인덱스"),
    orderedVersions.map(version => h("button", { class: "skill-version-choice", type: "button", key: version.digest,
      "aria-pressed": digest === version.digest, onClick: () => selectVersion(version.digest) },
      h(Pill, null, version.digest === head?.digest ? `r${head.revision} · 현재` : "보관"), h("code", null, version.digest.slice(0, 8)))),
    h("p", { class: "note" }, "현재 head · 불변 digest"), h("code", { class: "version__digest" }, head?.digest));
  const documentTab = h("div", { class: "skill-document-layout" }, rail,
    h("div", { class: "skill__document" }, h(VersionDocument, { ...versionPreview, digest: digest ?? "" }),
      draftState.status === "failed" && head !== null && h("div", null,
        h("p", { class: "note", role: "status" }, draftState.message),
        h("button", { class: "button secondary", type: "button", onClick: () => loadDraft(head) }, "다시 시도")),
      detail !== null && h(UnmeasuredReads, { detail }), editor));
  return h("section", { class: peek ? "skill skill--peek" : "skill skill--full", "aria-labelledby": "skill-title" },
    detail && digest && h(VersionBreadcrumb, { detail, digest, onSelect: selectVersion }),
    panelHead,
    h("p", { class: "note skill-description" }, detail?.skill.description ?? summary?.description),
    h("p", { class: "note skill__status", role: "status", "aria-live": "polite" },
      detailState.status === "loading" ? "스킬 불러오는 중…" : detailState.status === "failed" ? detailState.message : ""),
    detailState.status === "failed" && h("button", { class: "button secondary", type: "button", onClick: () => setRetry(current => current + 1) }, "다시 시도"),
    detail !== null && h("div", { class: "skill-summary" }, h(KeyValueGrid, { entries: [
      { label: "현재 리비전", value: `r${detail.skill.head.revision}` },
      { label: "보관 버전 수", value: detail.versions.length },
      { label: "선택 digest", value: h("code", { title: digest ?? "" }, digest?.slice(0, 8)) },
      { label: "최근 변경", value: when(detail.skill.updatedAt) }, { label: "읽기 기록", value: "미측정 · IG-14" },
    ] })),
    peek && detail !== null && h(KeyValueGrid, { entries: [
      { label: "스킬 ID", value: h("code", null, skillId) },
      { label: "head digest", value: h("code", null, head?.digest) },
      { label: "선택 버전과 head", value: digest === head?.digest ? "같은 버전" : "다른 버전" },
    ] }),
    detail !== null && h(SegmentedTabs, { key: peek ? "peek" : "full", id: "skill-detail", label: "스킬 상세",
      initialId: workspace.view?.tab === "document" && peek ? "versions" : workspace.view?.tab ?? "document",
      onChange: tab => { if (workspace.view) workspace.onViewChange?.({ ...workspace.view, tab }); },
      tabs: [
        { id: "document", label: "문서", content: documentTab }, { id: "versions", label: "버전", content: versions },
        { id: "compare", label: "비교", content: h(VersionDiff, { detail, signal, onUnauthorized }) },
        { id: "files", label: "파일", content: h(VersionFiles, versionPreview) },
      ] }),
    detail !== null && h("details", { class: "skill__danger" }, h("summary", { id: "delete-title" }, "스킬 삭제"),
      h("p", { class: "note" }, "내 계정에서 이 스킬의 모든 버전을 삭제합니다. 보관할 내용은 먼저 내보내세요."),
      h("div", { class: "cluster" }, pending?.kind === "skill"
        ? confirmation({ kind: "skill", name }, `버전 ${detail.versions.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`, "스킬 유지", removeSkill)
        : h("button", { id: triggerId({ kind: "skill" }), class: "button secondary danger-quiet", type: "button", disabled: busy,
          onClick: () => openConfirmation({ kind: "skill" }) }, "스킬 삭제…"),
      h(NoteLine, { note: deleteNote }))));
}
