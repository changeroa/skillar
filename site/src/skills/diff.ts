export type DiffLine = {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
  readonly before: number | null;
  readonly after: number | null;
};

/** Match stable line anchors without allocating a document-sized quadratic matrix. */
export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const left = before === "" ? [] : before.split("\n");
  const right = after === "" ? [] : after.split("\n");
  const positions = new Map<string, number[]>();
  right.forEach((line, index) => {
    const existing = positions.get(line);
    if (existing === undefined) positions.set(line, [index]);
    else existing.push(index);
  });
  const rows: DiffLine[] = [];
  let next = 0;
  left.forEach((text, index) => {
    const matches = positions.get(text) ?? [];
    let low = 0;
    let high = matches.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((matches[middle] ?? -1) < next) low = middle + 1;
      else high = middle;
    }
    const match = matches[low];
    if (match === undefined) {
      rows.push({ kind: "removed", text, before: index + 1, after: null });
      return;
    }
    while (next < match) {
      rows.push({ kind: "added", text: right[next] ?? "", before: null, after: ++next });
    }
    rows.push({ kind: "same", text, before: index + 1, after: ++next });
  });
  while (next < right.length) {
    rows.push({ kind: "added", text: right[next] ?? "", before: null, after: ++next });
  }
  return rows;
}
