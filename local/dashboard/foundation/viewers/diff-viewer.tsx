import { lineDiff } from "../../../../site/src/skills/diff";

export type DiffRow = {
  readonly kind: "same" | "added" | "removed"; readonly text: string;
  readonly before: number | null; readonly after: number | null;
};
const signs = { same: "=", added: "+", removed: "\u2212" } as const;
const labels = { same: "같음", added: "추가", removed: "삭제" } as const;

function DiffWords({ before, after, side }: {
  readonly before: string; readonly after: string; readonly side: "before" | "after";
}) {
  const tokens = (text: string) => (text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []).join("\n");
  return <>{lineDiff(tokens(before), tokens(after)).map((part, index) => {
    switch (part.kind) {
      case "same": return <span key={index} data-word-change="same">{part.text}</span>;
      case "removed": return side === "before" ? <span key={index} data-word-change="removed">{part.text}</span> : null;
      case "added": return side === "after" ? <span key={index} data-word-change="added">{part.text}</span> : null;
      default: return part.kind satisfies never;
    }
  })}</>;
}

function pairedRows(rows: readonly DiffRow[]) {
  const paired: { readonly before: DiffRow | undefined; readonly after: DiffRow | undefined }[] = [];
  let removed: DiffRow[] = [], added: DiffRow[] = [];
  const flush = () => {
    for (let position = 0; position < Math.max(removed.length, added.length); position++)
      paired.push({ before: removed[position], after: added[position] });
    removed = []; added = [];
  };
  for (const row of rows) {
    switch (row.kind) {
      case "same": flush(); paired.push({ before: row, after: row }); break;
      case "removed": removed.push(row); break;
      case "added": added.push(row); break;
      default: row.kind satisfies never;
    }
  }
  flush();
  return paired;
}

/** Consumes the caller's existing diff rather than recalculating document history. */
export function DiffViewer({ rows, label = "SKILL.md 줄별 변경점" }: {
  readonly rows: readonly DiffRow[]; readonly label?: string;
}) {
  if (rows.length === 0) return <div class="lf-diff-scroll lf-diff-empty" tabIndex={0} role="region" aria-label={label}>변경 없음</div>;
  return <div class="lf-diff-scroll" tabIndex={0} role="region" aria-label={label}>
    <div class="lf-diff__head"><span>이전 내용</span><span>이후 내용</span></div>
    <ol class="diff-lines lf-diff" aria-label={label}>{pairedRows(rows).map((pair, index) =>
      <li key={index} data-change={pair.before?.kind === "same" ? "same" : pair.before && pair.after ? "changed" : pair.before ? "removed" : "added"}>
        <div data-side="before" data-change={pair.before?.kind}>
          <span class="diff-line-number">{pair.before?.before ?? "\u00b7"}</span>{" "}
          {pair.before && <><span aria-label={labels[pair.before.kind]}>{signs[pair.before.kind]}</span>{" "}<code>
            {pair.after && pair.before.kind !== "same"
              ? <DiffWords before={pair.before.text} after={pair.after.text} side="before" /> : pair.before.text}
          </code></>}
        </div>
        <div data-side="after" data-change={pair.after?.kind}>
          <span class="diff-line-number">{pair.after?.after ?? "\u00b7"}</span>{" "}
          {pair.after && <><span aria-label={labels[pair.after.kind]}>{signs[pair.after.kind]}</span>{" "}<code>
            {pair.before && pair.after.kind !== "same"
              ? <DiffWords before={pair.before.text} after={pair.after.text} side="after" /> : pair.after.text}
          </code></>}
        </div>
      </li>)}</ol>
  </div>;
}
