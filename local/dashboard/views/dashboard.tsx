import { useEffect, useState } from "preact/hooks";
import { api, type SessionListRow } from "../api";
import { buildHash, serializeFilter, type ViewProps } from "../state";

export function DashboardView({ route, live, embedded }: ViewProps) {
  const [rows, setRows] = useState<SessionListRow[] | null>(null), [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    api.sessions(route.filter).then(value => { if (!cancelled) setRows(value); }, reason => { if (!cancelled) setError(reason); });
    return () => { cancelled = true; };
  }, [serializeFilter(route.filter), live.seq, retry]);
  const Title = embedded ? "h2" : "h1";
  const reads = rows?.filter(row => row.state === "loaded");
  return <section class="pe-console">
    <header class="page-title"><Title>대시보드</Title><p>현재 출처와 수신된 범위의 세션 활동입니다.</p></header>
    {error && <div role="alert"><p>세션을 불러오지 못했습니다</p><button class="pe-button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>}
    {rows === null && !error && <p role="status">세션 불러오는 중…</p>}
    {rows && <><dl class="trace__meta">
      <div><dt>세션</dt><dd>{rows.length}개</dd></div>
      <div><dt>스킬을 읽은 세션</dt><dd>{reads?.length}개</dd></div>
      <div><dt>읽은 스킬</dt><dd>{new Set(reads?.flatMap(row => row.skills)).size}개</dd></div>
      <div><dt>작업 성공</dt><dd>미측정</dd></div>
    </dl><a class="pe-button" href={buildHash({ ...route, view: "sessions" })}>세션 기록 보기</a></>}
  </section>;
}
