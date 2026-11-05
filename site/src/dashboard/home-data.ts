import { useEffect, useState } from "preact/hooks";
import type { PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { readCatalog, SkillsRequestError } from "../skills/api";
import { ConnectionsRequestError, readConnections } from "../mcp-connections";
import type { TableSort } from "../ui/table";
import { kstDay } from "../time.ts";
export type ReadState<T> = {
  readonly status: "loading" | "ready" | "failed";
  readonly data: T | null;
  readonly message: string;
  readonly technical: string;
};

export function useHomeRead<T>(
  load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, onUnauthorized: () => void,
): readonly [ReadState<T>, () => void] {
  const [state, setState] = useState<ReadState<T>>({ status: "loading", data: null, message: "", technical: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, status: "loading", message: "", technical: "" }));
    load(signal).then(data => {
      if (active) setState({ status: "ready", data, message: "", technical: "" });
    }, (error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
      if ((error instanceof SkillsRequestError || error instanceof ConnectionsRequestError) && error.status === 401) {
        onUnauthorized();
        return;
      }
      setState(current => ({ ...current, status: "failed", message: "조회 실패 · 값을 확인하지 못했습니다.",
        technical: error instanceof Error ? error.message : "" }));
    });
    return () => { active = false; };
  }, [signal, revision]);
  return [state, () => setRevision(value => value + 1)];
}

export { readCatalog, readConnections };

export { kstDay } from "../time.ts";

/** A complete consecutive range, not only dates on which changes occurred. */
export function recentDays(now: number, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => kstDay(now - (count - index - 1) * 86400000));
}

export function lastChanges(skills: readonly PrivateSkillSummary[], dates: readonly string[]) {
  const inRange = skills.filter(skill => dates.includes(kstDay(skill.updatedAt)));
  return {
    counts: dates.map(date => inRange.filter(skill => kstDay(skill.updatedAt) === date).length),
    recent: [...inRange].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)).slice(0, 5),
    total: inRange.length,
  };
}

export function homeSort(url: URL, table: string, columns: readonly string[], fallback: TableSort): TableSort {
  const column = url.searchParams.get(`${table}-sort`);
  const direction = url.searchParams.get(`${table}-direction`);
  return column !== null && columns.includes(column) && (direction === "ascending" || direction === "descending")
    ? { column, direction } : fallback;
}

export function saveHomeSort(table: string, sort: TableSort): void {
  const url = new URL(location.href);
  url.searchParams.set(`${table}-sort`, sort.column);
  url.searchParams.set(`${table}-direction`, sort.direction);
  history.replaceState(null, "", url);
}
