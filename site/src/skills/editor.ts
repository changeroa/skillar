import { h } from "preact";
import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { PRIVATE_SKILL_MAX_RESOURCE_BYTES, PRIVATE_SKILL_MAX_RESOURCES } from "../../../shared/dist/private-skills.js";
import { ENTRYPOINT, formatBytes, mediaTypeFor, mergePickedFiles, readFrontMatter, relativePaths, removeFile } from "./model.ts";
import type { Draft, DraftFile } from "./model.ts";

export type EditorProps = {
  readonly draft: Draft;
  readonly idPrefix: string;
  readonly busy: boolean;
  readonly notes: readonly string[];
  readonly onChange: (next: Draft, notes: readonly string[]) => void;
};

const PICK_LIMIT = 400;

export type PickedSelection = { readonly files: readonly DraftFile[]; readonly notes: readonly string[] };

function isHidden(path: string): boolean {
  return path.split("/").some(segment => segment.startsWith("."));
}

/** Only the picked files are read, after the pick, and oversize or hidden entries are skipped by name before any byte is read. */
export async function readSelection(list: FileList): Promise<PickedSelection> {
  if (list.length > PICK_LIMIT) {
    return { files: [], notes: [`That selection has ${list.length} files; a skill holds at most ${PRIVATE_SKILL_MAX_RESOURCES}. Pick a smaller folder.`] };
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
      notes.push(`${path} (${formatBytes(file.size)}) was skipped; each file must be at most ${formatBytes(PRIVATE_SKILL_MAX_RESOURCE_BYTES)}.`);
    } else kept.push({ file, path });
  }
  if (hidden > 0) notes.push(`${hidden} hidden ${hidden === 1 ? "file" : "files"} (names starting with a dot) ${hidden === 1 ? "was" : "were"} skipped.`);
  const files = await Promise.all(kept.map(async ({ file, path }): Promise<DraftFile> => ({
    path, mediaType: mediaTypeFor(path, file.type), bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  return { files, notes };
}

export function DraftEditor({ draft, idPrefix, busy, notes, onChange }: EditorProps) {
  const folderInput = useRef<HTMLInputElement | null>(null);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const id = (name: string) => `${idPrefix}-${name}`;
  const front = readFrontMatter(draft.document);

  const picked = async (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const list = input.files;
    if (list === null || list.length === 0) return;
    const selection = await readSelection(list);
    input.value = "";
    const merged = mergePickedFiles(draft, selection.files);
    onChange(merged.draft, [...selection.notes, ...merged.notes]);
  };

  const fileRows = draft.files.map(file => h("li", { key: file.path, class: "file-row" },
    h("div", { class: "file-row__name" },
      h("code", null, file.path),
      h("span", { class: "note" }, `${formatBytes(file.bytes.length)} · ${file.mediaType}`)),
    h("button", { class: "button secondary file-row__remove", type: "button", disabled: busy,
      "aria-label": `Remove ${file.path}`, onClick: () => onChange(removeFile(draft, file.path), []) }, "Remove")));

  return h("div", { class: "editor" },
    h("div", { class: "editor__files" },
      h("p", { id: id("pick-note") }, `Pick the folder that holds ${ENTRYPOINT}, or individual files. Folder structure is kept; the folder's own name is not. Only the files you pick are read, and only when you pick them.`),
      h("div", { class: "cluster file-picker" },
        h("button", { class: "button secondary", type: "button", disabled: busy, "aria-describedby": id("pick-note"),
          onClick: () => folderInput.current?.click() }, "Choose a skill folder\u2026"),
        h("button", { class: "button secondary", type: "button", disabled: busy, "aria-describedby": id("pick-note"),
          onClick: () => filesInput.current?.click() }, "Choose files\u2026"),
        h("input", { ref: folderInput, type: "file", webkitdirectory: true, multiple: true, hidden: true, tabIndex: -1,
          "aria-hidden": "true", onChange: picked }),
        h("input", { ref: filesInput, type: "file", multiple: true, hidden: true, tabIndex: -1, "aria-hidden": "true", onChange: picked })),
      notes.length > 0 && h("ul", { class: "editor__notes", role: "status", "aria-live": "polite" },
        notes.map(note => h("li", { key: note, class: "note" }, note))),
      h("p", { class: "editor__subtitle", id: id("files-title") }, "Supporting files"),
      draft.files.length === 0
        ? h("p", { class: "note" }, `None yet. ${ENTRYPOINT} alone is a complete skill.`)
        : h("ul", { class: "file-list", "aria-labelledby": id("files-title") }, fileRows)),
    h("dl", { class: "account-status will-publish" },
      h("div", null, h("dt", null, "Name"), h("dd", null, front.name ?? "Not found in the front matter yet")),
      h("div", null, h("dt", null, "Description"), h("dd", null, front.description ?? "Not found in the front matter yet"))),
    h("label", { class: "field-label document-label", for: id("document") }, `${ENTRYPOINT} (plain text, never rendered)`),
    h("textarea", { id: id("document"), class: "document-field", rows: 18, spellcheck: false, autocomplete: "off", disabled: busy,
      value: draft.document,
      onInput: (event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => onChange({ ...draft, document: event.currentTarget.value }, []) }),
    h("label", { class: "choice choice--ack" },
      h("input", { type: "checkbox", checked: draft.acknowledged, disabled: busy,
        onChange: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => onChange({ ...draft, acknowledged: event.currentTarget.checked }, []) }),
      h("span", null,
        h("strong", null, "Upload these files to my private skillar library."),
        h("span", { class: "choice__detail" },
          "This is separate from device activity consent. Only the files listed above and the SKILL.md text are sent, and they stay under your account until you delete them."))));
}
