import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PrivateSkillDetail, PrivateSkillDigest } from "../../../shared/dist/private-skills.js";
import { BarChart, Pill, SegmentedTabs, Skeleton } from "../ui/index.ts";
import { describeFailure, isUnauthorized, readExport } from "./api.ts";
import { draftFromExport, formatBytes } from "./model.ts";
import type { DraftState, Resources } from "./skill-state.ts";

type Preview =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly document: string; readonly resources: Resources };

/** Markdown's structural subset, built only with escaped Preact text nodes. HTML is always literal. */
export function FormattedDocument({ text }: { readonly text: string }) {
  const lines = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const key = index++;
    if (line.trim() === "") continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(h("h3", { key }, heading[2])); continue; }
    if (line.startsWith("```")) {
      const code = [];
      while (index < lines.length && !lines[index]?.startsWith("```")) code.push(lines[index++]);
      index++;
      blocks.push(h("pre", { key }, h("code", null, code.join("\n"))));
      continue;
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      const items = [line];
      while (index < lines.length && /^(?:[-*]|\d+\.)\s+/.test(lines[index] ?? "")) items.push(lines[index++] ?? "");
      blocks.push(h(/^\d/.test(line) ? "ol" : "ul", { key },
        items.map((item, row) => h("li", { key: row }, item.replace(/^(?:[-*]|\d+\.)\s+/, "")))));
      continue;
    }
    const paragraph = [line];
    while (index < lines.length && lines[index]?.trim() && !/^(?:#{1,6}\s|```|[-*]\s|\d+\.\s)/.test(lines[index] ?? "")) paragraph.push(lines[index++] ?? "");
    blocks.push(h("p", { key }, paragraph.join("\n")));
  }
  return h("div", { class: "skill-markdown" }, blocks);
}

export function useVersionPreview({ detail, digest, draftState, signal, onUnauthorized, retryHead }: {
  readonly detail: PrivateSkillDetail | null; readonly digest: PrivateSkillDigest | null; readonly draftState: DraftState;
  readonly signal: AbortSignal; readonly onUnauthorized: () => void;
  readonly retryHead: () => void;
}) {
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [loadedDigest, setLoadedDigest] = useState<PrivateSkillDigest | null>(null);
  const current = detail !== null && digest === detail.skill.head.digest && draftState.status === "ready"
    ? { document: draftState.baseline.document, resources: draftState.resources } : null;
  const skillId = detail?.skill.skillId;
  useEffect(() => {
    if (skillId === undefined || digest === null || digest === detail?.skill.head.digest) return;
    let active = true;
    setPreview({ kind: "loading" });
    readExport(skillId, digest, signal).then(async exported => {
      const draft = await draftFromExport(exported, { digest, revision: detail?.skill.head.revision ?? 1 });
      if (active) { setLoadedDigest(digest); setPreview({ kind: "ready", document: draft.document, resources: exported.package.manifest.resources }); }
    }).catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
      if (isUnauthorized(error)) { onUnauthorized(); return; }
      setLoadedDigest(digest);
      setPreview({ kind: "failed", message: describeFailure(error, "버전 문서 불러오기") });
    });
    return () => { active = false; };
  }, [skillId, digest, current?.document, retry, signal]);
  const currentPreview: Preview = current !== null ? { kind: "ready", ...current }
    : draftState.status === "failed" ? { kind: "failed", message: draftState.message } : { kind: "loading" };
  return { preview: digest === detail?.skill.head.digest ? currentPreview
    : loadedDigest === digest ? preview : { kind: "loading" } satisfies Preview,
    retry: digest === detail?.skill.head.digest ? retryHead : () => setRetry(value => value + 1) };
}

export function VersionDocument({ preview, retry, digest }: {
  readonly preview: Preview; readonly retry: () => void; readonly digest: string;
}) {
  if (preview.kind === "loading") return h(Skeleton, { label: "버전 문서 불러오는 중", rows: 3 });
  if (preview.kind === "failed") return h("div", null,
    h("p", { class: "note", role: "status" }, preview.message),
    h("button", { class: "button secondary", type: "button", onClick: retry }, "다시 시도"));
  return h("section", { class: "skill-document-preview", "aria-label": "선택한 버전 문서" },
    h("div", { class: "cluster" }, h("strong", null, "SKILL.md"), h(Pill, null, digest.slice(0, 8))),
    h(SegmentedTabs, { id: "document-format", label: "문서 표시",
      tabs: [
        { id: "formatted", label: "Formatted", content: h(FormattedDocument, { text: preview.document }) },
        { id: "raw", label: "Raw", content: h("pre", { class: "skill-document-raw" }, h("code", null, preview.document)) },
      ] }));
}

export function VersionFiles({ preview, retry }: { readonly preview: Preview; readonly retry: () => void }) {
  if (preview.kind !== "ready") return h(VersionDocument, { preview, retry, digest: "" });
  return h("dl", { class: "account-status resource-list" }, preview.resources.map(resource =>
    h("div", { key: resource.path }, h("dt", null, h("code", null, resource.path)),
      h("dd", null, `${formatBytes(resource.bytes)} · ${resource.mediaType}`))));
}

export function UnmeasuredReads({ detail }: { readonly detail: PrivateSkillDetail }) {
  return h("section", { class: "skill-reads", "aria-label": "버전별 읽기 수" },
    h(BarChart, { title: "버전별 읽기 수", data: { labels: detail.versions.map(version => version.digest.slice(0, 8)),
      series: [{ label: "읽기 수 · 미측정", values: detail.versions.map(() => null) }] } }),
    h("p", { class: "note" }, "아직 읽기 기록을 연결하지 않았습니다. 게시 기록은 읽기 기록이나 작업 성공의 근거가 아닙니다."));
}
