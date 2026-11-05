import { h } from "preact";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { describeFailure, isUnauthorized, readExport, technicalDetail } from "./api.ts";
import { draftFromExport } from "./model.ts";
import { lineDiff } from "./diff.ts";
import type { DiffLine } from "./diff.ts";

type Props = {
  readonly detail: PrivateSkillDetail;
  readonly signal: AbortSignal;
  readonly onUnauthorized: () => void;
};
type Comparison =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string; readonly technical: string | null }
  | { readonly kind: "ready"; readonly before: string; readonly after: string; readonly rows: readonly DiffLine[] };

export function VersionDiff({ detail, signal, onUnauthorized }: Props) {
  const [before, setBefore] = useState(detail.versions.find(v => v.digest !== detail.skill.head.digest)?.digest ?? detail.skill.head.digest);
  const [after, setAfter] = useState(detail.skill.head.digest);
  const beforeDigest = detail.versions.some(v => v.digest === before) ? before : detail.skill.head.digest;
  const afterDigest = detail.versions.some(v => v.digest === after) ? after : detail.skill.head.digest;
  const [comparison, setComparison] = useState<Comparison>({ kind: "idle" });
  const generation = useRef(0);
  const running = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  const compare = async () => {
    if (running.current) return;
    const oldVersion = detail.versions.find(v => v.digest === beforeDigest);
    const newVersion = detail.versions.find(v => v.digest === afterDigest);
    if (oldVersion === undefined || newVersion === undefined) return;
    const id = ++generation.current;
    running.current = true;
    setComparison({ kind: "loading" });
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
    } finally {
      running.current = false;
    }
  };
  const busy = comparison.kind === "loading";
  const changed = () => { generation.current += 1; setComparison({ kind: "idle" }); };
  return h("section", { class: "skill__section version-diff", "aria-labelledby": "diff-title" },
    h("h3", { id: "diff-title", class: "panel__subtitle" }, "버전 비교"),
    h("p", { class: "note" }, "보관된 두 버전의 SKILL.md를 비교합니다. − 삭제, + 추가, = 같은 줄입니다. 게시·현재 버전·고정 상태는 바뀌지 않습니다."),
    h("div", { class: "diff-controls" },
      h("label", { class: "field-label", for: "diff-before" }, "이전 내용",
        h("select", { id: "diff-before", class: "text-field", value: beforeDigest, disabled: busy,
          onChange: (event: JSX.TargetedEvent<HTMLSelectElement, Event>) => {
            const value = detail.versions.find(v => v.digest === event.currentTarget.value);
            if (value !== undefined) { setBefore(value.digest); changed(); }
          } }, detail.versions.map(v => h("option", { key: v.digest, value: v.digest }, v.digest)))),
      h("label", { class: "field-label", for: "diff-after" }, "이후 내용",
        h("select", { id: "diff-after", class: "text-field", value: afterDigest, disabled: busy,
          onChange: (event: JSX.TargetedEvent<HTMLSelectElement, Event>) => {
            const value = detail.versions.find(v => v.digest === event.currentTarget.value);
            if (value !== undefined) { setAfter(value.digest); changed(); }
          } }, detail.versions.map(v => h("option", { key: v.digest, value: v.digest }, v.digest)))),
      h("button", { class: "button secondary", type: "button", disabled: busy, onClick: compare },
        comparison.kind === "failed" ? "다시 시도" : "변경점 보기")),
    h("p", { class: "note", role: "status", "aria-live": "polite" }, busy ? "버전 비교 중…" :
      comparison.kind === "failed" ? comparison.message :
      comparison.kind === "ready" && comparison.rows.every(row => row.kind === "same") ? "두 버전의 SKILL.md 내용이 같습니다." : ""),
    comparison.kind === "failed" && comparison.technical !== null &&
      h("details", { class: "technical" }, h("summary", null, "기술 정보"), h("code", null, comparison.technical)),
    comparison.kind === "ready" && h("div", { class: "diff-result" },
      h("p", { class: "note" }, "이전 ", h("code", null, comparison.before), " → 이후 ", h("code", null, comparison.after)),
      h("ol", { class: "diff-lines", "aria-label": "SKILL.md 줄별 변경점" }, comparison.rows.map((row, index) =>
        h("li", { key: index, "data-change": row.kind },
          h("span", { class: "diff-line-number" }, `${row.before ?? "·"} / ${row.after ?? "·"}`),
          h("span", { "aria-label": { same: "같음", added: "추가", removed: "삭제" }[row.kind] }, { same: "=", added: "+", removed: "−" }[row.kind]),
          h("code", null, row.text))))));
}
