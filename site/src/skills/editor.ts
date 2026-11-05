import { h } from "preact";
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { PRIVATE_SKILL_MAX_RESOURCE_BYTES, PRIVATE_SKILL_MAX_RESOURCES } from "../../../shared/dist/private-skills.js";
import { ENTRYPOINT, formatBytes, mediaTypeFor, mergePickedFiles, readFrontMatter, relativePaths, removeFile } from "./model.ts";
import type { Draft, DraftFile } from "./model.ts";

export type EditorProps = {
  readonly draft: Draft;
  readonly idPrefix: string;
  readonly busy: boolean;
  readonly notes: readonly string[];
  readonly onChange: (next: Draft | ((current: Draft) => Draft), notes: readonly string[]) => void;
};

const PICK_LIMIT = 400;

/** Drafts stay in memory; a page exit must not silently discard them. */
export function useDraftGuard(dirty: boolean): void {
  useLayoutEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
}

export type PickedSelection = { readonly files: readonly DraftFile[]; readonly notes: readonly string[] };

function isHidden(path: string): boolean {
  return path.split("/").some(segment => segment.startsWith("."));
}

/** Only the picked files are read, after the pick, and oversize or hidden entries are skipped by name before any byte is read. */
export async function readSelection(list: FileList): Promise<PickedSelection> {
  if (list.length > PICK_LIMIT) {
    return { files: [], notes: [`선택한 파일은 ${list.length}개입니다. 스킬 하나에는 최대 ${PRIVATE_SKILL_MAX_RESOURCES}개를 담을 수 있습니다. 더 작은 폴더를 선택하세요.`] };
  }
  const picked = Array.from(list);
  const paths = relativePaths(picked.map(file => ({ name: file.name, relativePath: file.webkitRelativePath })));
  const notes: string[] = [];
  const kept: { readonly file: File; readonly path: string }[] = [];
  let hidden = 0;
  for (const [index, file] of picked.entries()) {
    const path = paths[index] ?? file.name;
    if (isHidden(path)) hidden += 1;
    else if (file.size > PRIVATE_SKILL_MAX_RESOURCE_BYTES) {
      notes.push(`${path} (${formatBytes(file.size)})는 제외했습니다. 파일 하나는 ${formatBytes(PRIVATE_SKILL_MAX_RESOURCE_BYTES)} 이하여야 합니다.`);
    } else kept.push({ file, path });
  }
  if (hidden > 0) notes.push(`이름이 점으로 시작하는 숨김 파일 ${hidden}개는 제외했습니다.`);
  const files = await Promise.all(kept.map(async ({ file, path }): Promise<DraftFile> => ({
    path, mediaType: mediaTypeFor(path, file.type), bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  return { files, notes };
}

export function DraftEditor({ draft, idPrefix, busy, notes, onChange }: EditorProps) {
  const folderInput = useRef<HTMLInputElement | null>(null);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);
  const latest = useRef(draft);
  const locked = useRef(busy);
  latest.current = draft;
  locked.current = busy;
  const [undo, setUndo] = useState<Draft | null>(null);
  const [readError, setReadError] = useState("");
  useEffect(() => {
    if (busy) generation.current += 1;
  }, [busy]);
  useEffect(() => () => { generation.current += 1; }, []);
  const id = (name: string) => `${idPrefix}-${name}`;
  const front = readFrontMatter(draft.document);

  const picked = async (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const list = input.files;
    if (busy || list === null || list.length === 0) return;
    const id = ++generation.current;
    setReadError("");
    try {
      const reading = readSelection(list);
      input.value = "";
      const selection = await reading;
      if (id !== generation.current || locked.current) return;
      const previous = latest.current;
      const merged = mergePickedFiles(previous, selection.files);
      if (selection.files.length > 0) setUndo(previous);
      onChange(current => mergePickedFiles(current, selection.files).draft, [...selection.notes, ...merged.notes]);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (id === generation.current) setReadError("파일을 읽지 못했습니다. 수정 내용은 유지했습니다. 파일을 다시 선택하세요.");
    }
  };

  const fileRows = draft.files.map(file => h("li", { key: file.path, class: "file-row" },
    h("div", { class: "file-row__name" },
      h("code", null, file.path),
      h("span", { class: "note" }, `${formatBytes(file.bytes.length)} · ${file.mediaType}`)),
    h("button", { class: "button secondary file-row__remove", type: "button", disabled: busy,
      "aria-label": `${file.path} 제거`, onClick: () => onChange(current => removeFile(current, file.path), []) }, "제거")));

  return h("div", { class: "editor" },
    h("div", { class: "editor__files" },
      h("p", { id: id("pick-note") }, `${ENTRYPOINT}가 있는 폴더나 파일을 선택하세요. 폴더 안의 구조는 유지하고 최상위 폴더 이름은 제외합니다. 선택한 파일만, 선택할 때 읽습니다.`),
      h("div", { class: "cluster file-picker" },
        h("button", { class: "button secondary", type: "button", disabled: busy, "aria-describedby": id("pick-note"),
          onClick: () => folderInput.current?.click() }, "스킬 폴더 선택\u2026"),
        h("button", { class: "button secondary", type: "button", disabled: busy, "aria-describedby": id("pick-note"),
          onClick: () => filesInput.current?.click() }, "파일 선택\u2026"),
        h("input", { ref: folderInput, type: "file", disabled: busy, webkitdirectory: true, multiple: true, hidden: true, tabIndex: -1,
          "aria-hidden": "true", onChange: picked }),
        h("input", { ref: filesInput, type: "file", disabled: busy, multiple: true, hidden: true, tabIndex: -1, "aria-hidden": "true", onChange: picked })),
      readError !== "" && h("p", { class: "note", role: "alert" }, readError),
      undo !== null && h("button", { class: "button secondary", type: "button", disabled: busy, onClick: () => {
        onChange(current => ({ ...current, document: undo.document, files: undo.files }), []);
        setUndo(null);
      } }, "되돌리기"),
      notes.length > 0 && h("ul", { class: "editor__notes", role: "status", "aria-live": "polite" },
        notes.map(note => h("li", { key: note, class: "note" }, note))),
      h("p", { class: "editor__subtitle", id: id("files-title") }, "추가 파일"),
      draft.files.length === 0
        ? h("p", { class: "note" }, `아직 없습니다. ${ENTRYPOINT} 하나만으로도 스킬을 구성할 수 있습니다.`)
        : h("ul", { class: "file-list", "aria-labelledby": id("files-title") }, fileRows)),
    h("dl", { class: "account-status will-publish" },
      h("div", null, h("dt", null, "이름"), h("dd", null, front.name ?? "SKILL.md 메타데이터에서 찾지 못했습니다")),
      h("div", null, h("dt", null, "설명"), h("dd", null, front.description ?? "SKILL.md 메타데이터에서 찾지 못했습니다"))),
    h("label", { class: "field-label document-label", for: id("document") }, `${ENTRYPOINT} (렌더링하지 않는 일반 텍스트)`),
    h("textarea", { id: id("document"), class: "document-field", rows: 18, spellcheck: false, autocomplete: "off", disabled: busy,
      value: draft.document,
      onInput: (event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => {
        const document = event.currentTarget.value;
        onChange(current => ({ ...current, document }), []);
      } }),
    h("label", { class: "choice choice--ack" },
      h("input", { type: "checkbox", checked: draft.acknowledged, disabled: busy,
        onChange: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
          const acknowledged = event.currentTarget.checked;
          onChange(current => ({ ...current, acknowledged }), []);
        } }),
      h("span", null,
        h("strong", null, "이 파일을 내 비공개 skillar 보관함에 업로드하는 데 동의합니다."),
        h("span", { class: "choice__detail" },
          "기기 활동 수집 동의와 별개입니다. 위에 나열된 파일과 SKILL.md 텍스트만 전송하며, 삭제할 때까지 내 계정에 보관합니다."))));
}
