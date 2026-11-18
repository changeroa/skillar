import type { SessionListRow } from "../../api";
import { RUNTIME_LABEL, type SessionSort } from "../../state";

// row.state is a legacy server classification kept only as a data pointer: it says which list
// row.skills holds (loaded skills first, otherwise exposed candidates). It is never displayed -
// shown statuses come only from the 11/02 request-status model.
export function readSkills(row: SessionListRow): readonly string[] {
  return row.state === "loaded" ? row.skills : [];
}

export function candidateSkills(row: SessionListRow): readonly string[] {
  return row.state === "exposed_only" ? row.skills : [];
}

export function sortSessions(rows: readonly SessionListRow[], sort: SessionSort = "-started"): SessionListRow[] {
  const direction = sort.startsWith("-") ? -1 : 1;
  const field = sort.replace(/^-/, "");
  const value = (row: SessionListRow): string | number | undefined => {
    switch (field) {
      case "runtime": return RUNTIME_LABEL[row.runtime];
      case "reads": return readSkills(row).length;
      default: return row.startedAt;
    }
  };
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left === undefined || right === undefined) return left === right ? a.id.localeCompare(b.id) : left === undefined ? 1 : -1;
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ko");
    return comparison * direction || a.id.localeCompare(b.id);
  });
}

export const COLUMN_LABEL = {
  started: "시작", runtime: "실행 환경", reads: "읽은 스킬", prompt: "첫 요청", search: "검색",
} as const;
