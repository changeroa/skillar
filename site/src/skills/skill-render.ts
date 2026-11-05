import { h } from "preact";
import { deleteVersion, setHead, setPinned } from "./api.ts";
import { DraftEditor } from "./editor.ts";
import { formatBytes } from "./model.ts";
import { when } from "./library.ts";
import { triggerId } from "./skill-delete.ts";
import { NoteLine, isDirty } from "./skill-notes.ts";
import type { Version } from "./skill-state.ts";
import type { useSkillController } from "./skill.ts";
import { VersionDiff } from "./diff-panel.ts";
export function SkillView({ detailState, draftState, detail, name, head, heading, busy, dirty, pending, notes, problems, conflict, publishNote, versionsNote, deleteNote, setRetry, setDraftState, setNotes, loadDraft, run, review, publish, exportVersion, removeSkill, openConfirmation, confirmation, onBack, skillId, signal, onUnauthorized, summary }: ReturnType<typeof useSkillController>) {
  const title = name === "" ? "스킬" : name;
  const panelHead = h("div", { class: "panel__head" },
    h("h2", { id: "skill-title", ref: heading, tabIndex: -1 }, title),
    h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => {
      if (!dirty || confirm("저장하지 않은 수정 내용이 사라집니다. 보관함으로 돌아갈까요?")) onBack();
    } }, "스킬 목록으로"));

  if (detailState.status === "gone") {
    return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
      panelHead,
      h("p", { class: "note", role: "status", "aria-live": "polite" }, detailState.message),
      draftState.status === "ready" && h("p", null, "저장하지 않은 수정 내용을 복사할 수 있도록 아래에 남겨 두었습니다. 이 스킬에는 더 이상 게시할 수 없습니다."),
      draftState.status === "ready" && h("textarea", { class: "document-field", rows: 12, readOnly: true, "aria-label": "SKILL.md 수정 내용", value: draftState.draft.document }));
  }

  const versionRow = (version: Version) => {
    const current = head !== null && version.digest === head.digest;
    const protectedReason = current ? "현재 버전입니다. 삭제하려면 먼저 다른 버전을 현재 버전으로 선택하세요."
      : version.pinned ? "고정한 버전입니다. 삭제하려면 먼저 고정을 해제하세요." : null;
    const confirming = pending?.kind === "version" && pending.digest === version.digest;
    const rowId = `version-${version.digest.slice(0, 16)}`;
    return h("li", { key: version.digest, class: "version", "aria-labelledby": rowId, "data-current": current ? "true" : undefined },
      h("div", { class: "version__meta" },
        h("p", { id: rowId, class: "version__flags" },
          current && h("strong", null, "현재 버전"),
          current && version.pinned && " \u00b7 ",
          version.pinned && h("strong", null, "고정됨"),
          !current && !version.pinned && h("span", { class: "note" }, "이전 버전")),
        h("p", { class: "note" }, "생성 ", when(version.createdAt)),
        h("code", { class: "version__digest" }, version.digest)),
      h("div", { class: "cluster version__actions" },
        !current && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
          onClick: () => run("현재 버전 변경", () => setHead(skillId, head, version.digest, signal)) }, "현재 버전으로 선택"),
        head !== null && h("button", { class: "button secondary", type: "button", disabled: busy, "aria-pressed": version.pinned,
          onClick: () => run(version.pinned ? "버전 고정 해제" : "버전 고정", () => setPinned(skillId, head, version.digest, !version.pinned, signal)) },
          version.pinned ? "고정 해제" : "고정"),
        h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => exportVersion(version.digest) }, h("code", null, "JSON"), " 내보내기"),
        protectedReason === null && head !== null && (confirming
          ? confirmation({ kind: "version", digest: version.digest }, "내 계정에서 이 버전의 파일을 삭제합니다. 되돌릴 수 없습니다.", "버전 유지",
            () => run("버전 삭제", () => deleteVersion(skillId, head, version.digest, signal)))
          : h("button", { id: triggerId({ kind: "version", digest: version.digest }), class: "button secondary danger-quiet", type: "button", disabled: busy,
            onClick: () => openConfirmation({ kind: "version", digest: version.digest }) }, "버전 삭제\u2026")),
        protectedReason !== null && h("span", { class: "note version__protected" }, protectedReason)));
  };

  return h("section", { class: "panel skill", "aria-labelledby": "skill-title" },
    panelHead,
    (detail?.skill.description ?? summary?.description) !== undefined && h("p", { class: "account-lead" }, detail?.skill.description ?? summary?.description),
    h("p", { class: "note skill__status", role: "status", "aria-live": "polite" },
      detailState.status === "loading" ? "스킬 불러오는 중\u2026" : detailState.status === "failed" ? detailState.message : ""),
    detailState.status === "failed" && h("button", { class: "button secondary", type: "button", onClick: () => setRetry(current => current + 1) }, "다시 시도"),
    detail !== null && h("dl", { class: "account-status skill__facts" },
      h("div", null, h("dt", null, "현재 리비전"), h("dd", null, String(detail.skill.head.revision))),
      h("div", null, h("dt", null, "보관 버전 수"), h("dd", null, String(detail.versions.length))),
      h("div", { class: "skill__digest" }, h("dt", null, "현재 ", h("code", null, "digest")), h("dd", null, h("code", null, detail.skill.head.digest))),
      h("div", null, h("dt", null, "스킬 ID"), h("dd", null, h("code", null, detail.skill.skillId))),
      h("div", null, h("dt", null, "마지막 변경"), h("dd", null, when(detail.skill.updatedAt)))),
    detail !== null && h(VersionDiff, { detail, signal, onUnauthorized }),
    detail !== null && h("div", { class: "skill__layout" },
      h("div", { class: "skill__support" },
        h("section", { class: "skill__section", "aria-labelledby": "versions-title" },
          h("h3", { id: "versions-title", class: "panel__subtitle", tabIndex: -1 }, "버전"),
          h("p", { class: "note" }, "‘현재 버전으로 선택’을 누르면 에이전트가 받을 버전을 해당 버전으로 바꿉니다. 고정한 버전은 삭제할 수 없습니다. 각 버전은 ", h("code", null, "JSON"), "으로 내보낼 수 있습니다."),
          h("div", { class: "cluster versions__note" }, h(NoteLine, { note: versionsNote })),
          h("ul", { class: "version-list" }, detail.versions.map(versionRow))),
        h("section", { class: "skill__section skill__evidence", "aria-labelledby": "evidence-title" },
          h("h3", { id: "evidence-title", class: "panel__subtitle" }, "읽기 기록과 평가"),
          h("dl", { class: "account-status" },
            h("div", null, h("dt", null, "버전별 읽기 기록"), h("dd", null, "이 화면에 연결되지 않음")),
            h("div", null, h("dt", null, "평가 결과"), h("dd", null, "이 화면에 연결되지 않음"))),
          h("p", { class: "note" }, "게시 기록은 읽기 기록이 아니며, 읽었다고 작업 성공이 입증되지는 않습니다. 이 화면에는 버전별 읽기·평가 결과가 연결되어 있지 않습니다."),
          h("a", { class: "button secondary", href: "/dashboard/" }, "대시보드 열기"))),
      h("div", { class: "skill__document" },
        h("section", { class: "skill__section", "aria-labelledby": "resources-title" },
          h("h3", { id: "resources-title", class: "panel__subtitle" }, "현재 버전의 파일"),
          draftState.status === "ready"
            ? h("dl", { class: "account-status resource-list" }, draftState.resources.map(resource =>
              h("div", { key: resource.path }, h("dt", null, h("code", null, resource.path)), h("dd", null, `${formatBytes(resource.bytes)} \u00b7 ${resource.mediaType}`))))
            : h("p", { class: "note", role: "status" }, draftState.status === "loading" ? "현재 버전 불러오는 중\u2026" : draftState.message),
          draftState.status === "failed" && head !== null && h("button", {
            class: "button secondary", type: "button", disabled: busy, onClick: () => loadDraft(head),
          }, "다시 시도")),
        draftState.status === "ready" && h("form", { class: "skill__section publish", onSubmit: publish, "aria-labelledby": "edit-title" },
          h("h3", { id: "edit-title", class: "panel__subtitle" }, "새 버전 편집·게시"),
          h("p", { class: "note" }, `게시하기 전까지 수정 내용은 이 화면에만 있습니다. 게시하면 리비전 ${draftState.draft.base?.revision ?? detail.skill.head.revision}을 기준으로 리비전 ${detail.skill.head.revision + 1}을 만들며, 이전 버전은 보관합니다.`),
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
          problems.length > 0 && h("div", { role: "alert" },
            h("ul", { class: "problems" }, problems.map(problem => h("li", { key: problem }, problem)))),
          h("div", { class: "cluster publish__actions" },
            h("button", { class: "button primary", type: "submit", disabled: busy }, "새 버전 게시"),
            conflict && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: review }, "현재 버전 확인"),
            isDirty(draftState) && head !== null && h("button", { class: "button secondary", type: "button", disabled: busy,
              onClick: () => loadDraft(head) }, "수정 내용 버리고 현재 버전 불러오기"),
            h(NoteLine, { note: publishNote }))),
        h("section", { class: "skill__section skill__danger", "aria-labelledby": "delete-title" },
          h("h3", { id: "delete-title", class: "panel__subtitle" }, "스킬 삭제"),
          h("p", { class: "note" }, "내 계정에서 이 스킬의 모든 버전을 삭제합니다. 보관할 내용은 먼저 내보내세요."),
          h("div", { class: "cluster" }, pending?.kind === "skill"
            ? confirmation({ kind: "skill", name }, `버전 ${detail.versions.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`,
              "스킬 유지", removeSkill)
            : h("button", { id: triggerId({ kind: "skill" }), class: "button secondary danger-quiet", type: "button", disabled: busy, onClick: () => openConfirmation({ kind: "skill" }) },
              "스킬 삭제\u2026"),
            h(NoteLine, { note: deleteNote }))))));
}
