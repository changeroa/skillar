import type { SessionListRow } from "../../api";
import { RUNTIME_LABEL, type SessionSort } from "../../state";

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
      case "state": return row.state;
      case "reads": return readSkills(row).length;
      case "duration": return row.endedAt === undefined ? undefined : row.endedAt - row.startedAt;
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
  started: "시작", runtime: "실행 환경", state: "상태", reads: "읽은 스킬", candidates: "후보",
  duration: "길이", prompt: "첫 요청", search: "검색", load: "읽기", attribution: "세션 연결", id: "세션 ID",
} as const;
