import {createElement as h} from "react";
import type {JSX} from "react";
import { useEffect, useRef, useState } from "react";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { describeFailure, isUnauthorized, readExport, technicalDetail } from "./api.ts";
import { draftFromExport } from "./model.ts";
import { lineDiff } from "./diff.ts";
import type { DiffLine } from "./diff.ts";
import { versionLabel } from "./version-label.ts";
import { VersionMetricsPanel } from "./version-metrics-panel.ts";
import { DiffViewer } from "../../../local/dashboard/foundation/viewers";

type Props = {
  readonly detail: PrivateSkillDetail;
  readonly signal: AbortSignal;
  readonly onUnauthorized: () => void;
  readonly active?: boolean;
};
type Comparison =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string; readonly technical: string | null }
  | { readonly kind: "ready"; readonly before: string; readonly after: string; readonly rows: readonly DiffLine[] };

export function VersionDiff({ detail, signal, onUnauthorized, active = true }: Props) {
  const [before, setBefore] = useState(detail.versions.find(v => v.digest !== detail.skill.head.digest)?.digest ?? detail.skill.head.digest);
  const [after, setAfter] = useState(detail.skill.head.digest);
  const beforeDigest = detail.versions.some(v => v.digest === before) ? before : detail.skill.head.digest;
  const afterDigest = detail.versions.some(v => v.digest === after) ? after : detail.skill.head.digest;
  const [comparison, setComparison] = useState<Comparison>({ kind: "idle" });
  const [retry, setRetry] = useState(0);
  const [reportOpen, setReportOpen] = useState(false); // 첫 프롬프트 리포트는 펼칠 때만 조회한다
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    const oldVersion = detail.versions.find(v => v.digest === beforeDigest);
    const newVersion = detail.versions.find(v => v.digest === afterDigest);
    if (oldVersion === undefined || newVersion === undefined) return;
    const id = ++generation.current;
    setComparison({ kind: "loading" });
    const compare = async () => {
      try {
        const read = async (digest: typeof oldVersion.digest) => draftFromExport(
          await readExport(detail.skill.skillId, digest, signal), { digest, revision: detail.skill.head.revision });
        const [oldDraft, newDraft] = await Promise.all([read(oldVersion.digest), read(newVersion.digest)]);
        if (id === generation.current) setComparison({
          kind: "ready", before: oldVersion.digest, after: newVersion.digest, rows: lineDiff(oldDraft.document, newDraft.document),
        });
      } catch (error) {
        if (id !== generation.current || (error instanceof DOMException && error.name === "AbortError")) return;
        if (isUnauthorized(error)) { onUnauthorized(); return; }
        setComparison({ kind: "failed", message: describeFailure(error, "버전 비교"), technical: technicalDetail(error) });
      }
    };
    void compare();
    return () => { generation.current += 1; };
  }, [active, detail.skill.skillId, beforeDigest, afterDigest, signal, retry]);
  const busy = comparison.kind === "loading";
  const rows = comparison.kind === "ready" && comparison.before === beforeDigest && comparison.after === afterDigest
    ? h(DiffViewer, { rows: comparison.rows }) : null;
  return h("section", { className: "skill__section version-diff", "aria-labelledby": "diff-title" },
    h("h3", { id: "diff-title", className: "panel__subtitle" }, "버전 비교"),
    h("p", { className: "note" }, "보관된 두 버전의 SKILL.md를 비교합니다. − 삭제, + 추가, = 같은 줄입니다. 게시·현재 버전·고정 상태는 바뀌지 않습니다."),
    h("p", { className: "note" }, "현재 버전은 현재 리비전 번호로, 보관 버전은 생성 순서로 표시합니다. 날짜는 KST입니다."),
    h("div", { className: "diff-controls" },
      h("label", { className: "field-label", for: "diff-before" }, "이전 내용",
        h("select", { id: "diff-before", className: "text-field", value: beforeDigest,
          onChange: (event: React.SyntheticEvent<HTMLSelectElement>) => {
            const value = detail.versions.find(v => v.digest === event.currentTarget.value);
            if (value !== undefined) setBefore(value.digest);
          } }, detail.versions.map(v => h("option", { key: v.digest, value: v.digest }, versionLabel(detail, v.digest))))),
      h("label", { className: "field-label", for: "diff-after" }, "이후 내용",
        h("select", { id: "diff-after", className: "text-field", value: afterDigest,
          onChange: (event: React.SyntheticEvent<HTMLSelectElement>) => {
            const value = detail.versions.find(v => v.digest === event.currentTarget.value);
            if (value !== undefined) setAfter(value.digest);
          } }, detail.versions.map(v => h("option", { key: v.digest, value: v.digest }, versionLabel(detail, v.digest))))),
      comparison.kind === "failed" && h("button", { className: "button secondary", type: "button", onClick: () => setRetry(value => value + 1) }, "다시 시도")),
    h("details", { className: "report-disclosure", onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => setReportOpen(event.currentTarget.open) },
      h("summary", null, "첫 프롬프트 리포트 (기록 동의 범위 · 펼칠 때만 조회)"),
      h(VersionMetricsPanel, { detail, before: beforeDigest, after: afterDigest, signal, onUnauthorized, active: active && reportOpen })),
    h("p", { className: "note", role: "status", "aria-live": "polite" }, busy ? "버전 비교 중…" :
      comparison.kind === "failed" ? comparison.message :
      comparison.kind === "ready" && comparison.rows.every(row => row.kind === "same") ? "두 버전의 SKILL.md 내용이 같습니다." : ""),
    comparison.kind === "failed" && comparison.technical !== null &&
      h("details", { className: "technical" }, h("summary", null, "기술 정보"), h("code", null, comparison.technical)),
    comparison.kind === "ready" && h("div", { className: "diff-result" },
      h("p", { className: "note" }, `이전 ${versionLabel(detail, comparison.before)} → 이후 ${versionLabel(detail, comparison.after)}`),
      comparison.rows.length > 80 ? h("details", { open: true }, h("summary", null, "줄별 변경점 접기·펼치기"), rows) : rows));
}
