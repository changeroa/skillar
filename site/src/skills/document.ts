import {createElement as h} from "react";
import { useEffect, useState } from "react";
import type { PrivateSkillDetail, PrivateSkillDigest } from "../../../shared/dist/private-skills.js";
import { BarChart, Pill, SegmentedTabs, Skeleton } from "../ui/index.ts";
import { describeFailure, isUnauthorized, readExport } from "./api.ts";
import { draftFromExport, formatBytes } from "./model.ts";
import type { DraftState, Resources } from "./skill-state.ts";
import { MarkdownViewer, CodeBlock } from "../../../local/dashboard/foundation/viewers";

type Preview =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly document: string; readonly resources: Resources };

/** Markdown's structural subset, built only with escaped Preact text nodes. HTML is always literal. */
export function FormattedDocument({ text }: { readonly text: string }) {
  return h(MarkdownViewer, { text });
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
    h("p", { className: "note", role: "status" }, preview.message),
    h("button", { className: "button secondary", type: "button", onClick: retry }, "다시 시도"));
  return h("section", { className: "skill-document-preview", "aria-label": "선택한 버전 문서" },
    h("div", { className: "cluster" }, h("strong", null, "SKILL.md"), h(Pill, null, digest.slice(0, 8))),
    h(SegmentedTabs, { id: "document-format", label: "문서 표시",
      tabs: [
        { id: "formatted", label: "Formatted", content: h(FormattedDocument, { text: preview.document }) },
        { id: "raw", label: "Raw", content: h(CodeBlock, { value: preview.document, language: "markdown", label: "SKILL.md" }) },
      ] }));
}

export function VersionFiles({ preview, retry }: { readonly preview: Preview; readonly retry: () => void }) {
  if (preview.kind !== "ready") return h(VersionDocument, { preview, retry, digest: "" });
  return h("dl", { className: "account-status resource-list" }, preview.resources.map(resource =>
    h("div", { key: resource.path }, h("dt", null, h("code", null, resource.path)),
      h("dd", null, `${formatBytes(resource.bytes)} · ${resource.mediaType}`))));
}

export function UnmeasuredReads({ detail }: { readonly detail: PrivateSkillDetail }) {
  // 읽기 수는 아직 측정하지 않는다(집계 연결 없음). 대신 현재 버전을 읽은 세션 목록으로 가는 링크를 둔다.
  // 필터: 이 스킬의 현재 버전 URI + 읽기 성공 세션. 읽은 세션 0건이면 세션 화면의 빈 상태가 뜬다.
  // 세션 목록 해시 필터와 같은 직렬화(local/dashboard/state.ts의 serializeFilter): skill,loadStatus 순.
  const headUri = `skillar://private/${detail.skill.skillId}/${detail.skill.head.digest}/SKILL.md`;
  const sessionsHref = `/sessions/#/sessions?skill=${encodeURIComponent(headUri)}&loadStatus=succeeded`;
  return h("section", { className: "skill-reads", "aria-label": "버전별 읽기 수" },
    h(BarChart, { title: "버전별 읽기 수", data: { labels: detail.versions.map(version => version.digest.slice(0, 8)),
      series: [{ label: "읽기 수 · 미측정", values: detail.versions.map(() => null) }] } }),
    h("p", null, h("a", { href: sessionsHref }, "현재 버전을 읽은 세션 보기")),
    h("p", { className: "note" }, "읽기 수는 아직 측정하지 않습니다. 게시 기록은 읽기 기록이나 작업 성공의 근거가 아닙니다."));
}
