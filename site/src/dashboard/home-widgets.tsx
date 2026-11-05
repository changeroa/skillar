import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import { BarChart, DataTable, NumberTile, Pill } from "../ui";
import type { TableColumn } from "../ui";
import { connectionStatus } from "../mcp-connections";
import type { DeviceState } from "./devices";
import type { ReadState } from "./home-checklist";
import { homeSort, lastChanges, readCatalog, readConnections, recentDays, saveHomeSort, useHomeRead } from "./home-data";
import { shortId } from "./status";
import { KST_TIME_ZONE } from "../time.ts";
import "../ui/ui.css";
import "./home-widgets.css";

type ConnectionRow = {
  readonly id: string; readonly name: string; readonly kind: string;
  readonly status: string; readonly consent: string;
};
const connectionColumns: readonly TableColumn<ConnectionRow>[] = [
  { id: "name", label: "대상 / 등록 ID", value: row => row.name,
    render: row => row.kind === "기기" && row.status === "철회됨" ? <span>해제된 기기</span> :
      <><span>{row.kind === "기기" ? <>기기 <code>{shortId(row.id)}</code></> : row.name}</span><small><code>{row.id}</code></small></> },
  { id: "kind", label: "종류", value: row => row.kind },
  { id: "status", label: "등록 상태", value: row => row.status, render: row => <Pill>{row.status}</Pill> },
  { id: "consent", label: "업로드 동의", value: row => row.consent },
];
const skillColumns: readonly TableColumn<PrivateSkillSummary>[] = [
  { id: "name", label: "스킬", value: row => row.name,
    render: row => <a href={`/skills/#skill/${row.skillId}`}>{row.name}</a> },
  { id: "head", label: "현재 버전", value: row => row.head.revision,
    render: row => <><Pill>r{row.head.revision}</Pill><small><code>{row.head.digest.slice(0, 8)}</code></small></> },
  { id: "updatedAt", label: "최근 변경", value: row => row.updatedAt,
    render: row => <time dateTime={new Date(row.updatedAt).toISOString()}>{new Date(row.updatedAt).toLocaleString("ko-KR", {
      timeZone: KST_TIME_ZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    })} KST</time> },
];

function ReadNotice({ state, onRetry }: { readonly state: ReadState<unknown>; readonly onRetry: () => void }) {
  if (state.status === "ready") return null;
  return <div class="home-read-notice" role="status">
    <p>{state.status === "loading" ? "확인 중 · 아직 측정값이 아닙니다." : state.message}</p>
    {state.data !== null && <p>마지막으로 확인한 값이며 최신 정보가 아닐 수 있습니다.</p>}
    {state.status === "failed" && <button class="button secondary" type="button" onClick={onRetry}>자산·연결 다시 읽기</button>}
  </div>;
}

function Widget({ title, children }: { readonly title: string; readonly children: ComponentChildren }) {
  return <section class="home-widget"><h2>{title}</h2>{children}</section>;
}

export function HomeWidgets({ signal, devices, onRetryDevices, onUnauthorized }: {
  readonly signal: AbortSignal; readonly devices: ReadState<readonly DeviceState[]>;
  readonly onRetryDevices: () => void; readonly onUnauthorized: () => void;
}) {
  const [catalog, reloadCatalog] = useHomeRead(readCatalog, signal, onUnauthorized);
  const [mcp, reloadMcp] = useHomeRead(readConnections, signal, onUnauthorized);
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState(() => {
    const value = new URL(location.href).searchParams.get("days");
    return value === "3" || value === "7" ? Number(value) : 5;
  });
  const dates = recentDays(now, range);
  const skills = catalog.data?.skills ?? [];
  const changes = lastChanges(skills, dates);
  const weeklyChanges = lastChanges(skills, recentDays(now, 7)).total;
  const activeDevices = devices.data?.filter(device => device.revokedAt === null) ?? [];
  const connections = mcp.data?.connections ?? [];
  const activeMcp = connections.filter(connection => connectionStatus(connection, now / 1000) === "active");
  const rows: readonly ConnectionRow[] = [
    ...(devices.data ?? []).map(device => ({ id: device.deviceId, name: `기기 ${shortId(device.deviceId)}`, kind: "기기",
      status: device.revokedAt === null ? "등록됨" : "철회됨",
      consent: device.revokedAt !== null ? "새 업로드 불가" : device.consent.mode === "local-only" ? "동의 없음" :
        device.consent.mode === "metadata" ? "메타데이터만" : "선택한 내용" })),
    ...connections.map(connection => ({ id: connection.connectionId, name: connection.name, kind: `MCP · ${connection.kind === "pat" ? "PAT" : "OAuth"}`,
      status: ({ active: "등록됨", expired: "만료됨", revoked: "철회됨" })[connectionStatus(connection, now / 1000)],
      consent: connection.recordActivity ? "MCP 활동 동의됨 · 기기 동의와 별개" : "MCP 활동 동의 없음" })),
  ];
  const retry = () => { reloadCatalog(); reloadMcp(); onRetryDevices(); };
  return <section class="home-widgets" aria-label="자산·연결 요약" data-home-variant="B">
    <div class="home-number-tiles">
      <NumberTile label="스킬 수" value={catalog.data?.skills.length ?? null} note="보관함 전체 · 현재 등록된 스킬" />
      <NumberTile label="이번 주 변경 수" value={catalog.data === null ? null : weeklyChanges}
        note="updatedAt 기준 · 최근 7일 · KST" />
      <NumberTile label="등록된 연결 수" value={devices.data !== null && mcp.data !== null ? activeDevices.length + activeMcp.length : null}
        note="활성 기기 + MCP 등록 · 중복 제거 안 함" />
      <NumberTile label="활성 토큰 수" value={mcp.data === null ? null : activeMcp.filter(connection => connection.kind === "pat").length}
        note="미철회·만료 전 PAT만 · OAuth 제외" />
    </div>
    <ReadNotice state={catalog} onRetry={retry} /><ReadNotice state={mcp} onRetry={retry} />
    <label class="home-range">기간 <select value={range} onChange={event => {
      const days = Number(event.currentTarget.value);
      setRange(days);
      const url = new URL(location.href); url.searchParams.set("days", String(days)); history.replaceState(null, "", url);
    }}><option value="3">최근 3일</option><option value="5">최근 5일</option><option value="7">최근 7일</option></select>
      <span>{dates[0]} – {dates.at(-1)} · KST · 양끝 포함</span>
    </label>
    <div class="home-widget-grid">
      <section class="home-widget home-changes" aria-label="일별 변경 수">
        <BarChart title="일별 변경 수 · KST" data={{ labels: dates.map(date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}\nKST`), series: [
          { label: "스킬 마지막 변경", values: catalog.data === null ? dates.map(() => null) : changes.counts },
          { label: "보관 버전 생성", values: dates.map(() => catalog.data?.skills.length === 0 ? 0 : null) },
        ] }} />
        <p class="note">updatedAt의 마지막 변경일별 개수이며 전체 변경 이력이 아닙니다. 두 계열을 더하지 않습니다.</p>
        <p class="note">{catalog.data?.skills.length === 0 ? "보관된 스킬이 없어 보관 버전 생성 수도 0개입니다." :
          "버전 생성: 미측정 · versions[].createdAt은 스킬별 상세 조회가 필요해 자동으로 전체 조회하지 않습니다."}</p>
      </section>
      <Widget title="최근 변경된 스킬">
        {catalog.data !== null && <DataTable caption={`기간 내 ${changes.total}개 중 최근 5개 이하 · KST`}
          rows={changes.recent} columns={skillColumns} rowId={skill => skill.skillId} controls={false}
          initialSort={homeSort(new URL(location.href), "recent", skillColumns.map(column => column.id),
            { column: "updatedAt", direction: "descending" })} onSort={sort => saveHomeSort("recent", sort)} />}
        {catalog.data === null && <p class="note">미측정 · 보관함을 확인한 뒤 표시합니다.</p>}
        {catalog.status === "ready" && skills.length === 0 && <a class="home-link" href="/skills/">첫 스킬 게시하기</a>}
      </Widget>
    </div>
    <Widget title="연결 상태">
      <a class="home-link" href="/connections/">연결 관리</a>
      {(devices.data !== null || mcp.data !== null) && <DataTable caption="기기 + MCP 등록 상태 · 온라인 여부나 사용량이 아닙니다." rows={rows}
        columns={connectionColumns} rowId={row => `${row.kind}:${row.id}`}
        initialSort={homeSort(new URL(location.href), "connections", connectionColumns.map(column => column.id),
          { column: "name", direction: "ascending" })} onSort={sort => saveHomeSort("connections", sort)} />}
      <ReadNotice state={devices} onRetry={onRetryDevices} />
      {mcp.status !== "ready" && <p class="note">MCP 등록 상태는 {mcp.status === "loading" ? "확인 중" : "조회 실패"}입니다.</p>}
    </Widget>
    <section class="home-consent" aria-labelledby="home-consent-title">
      <h2 id="home-consent-title">기기 업로드 동의 후 표시</h2>
      <p class="note">보유 자산과 별도로 수집하는 사용량입니다. 미측정은 0건이 아닙니다.</p>
      <div class="home-consent-slots">
        {[
          { title: "일별 읽기 / 검색", reason: "기기 업로드 동의와 출처 선택 후 성공 load·검색 요청을 확인할 수 있습니다." },
          { title: "읽기 수 상위 스킬", reason: "업로드 동의와 버전별 읽기 기록을 연결한 뒤 표시합니다." },
          { title: "검색 결과 비중", reason: "업로드 동의 후 후보 있음·없음·실패·기타를 같은 범위에서 집계해야 합니다." },
        ].map(slot => <section key={slot.title} class="home-consent-slot">
          <header><h3>{slot.title}</h3><Pill>미측정</Pill></header>
          <p class="note">{slot.reason}</p>
          <a class="home-link" href="/connections/" aria-label={`${slot.title} 업로드 동의 설정`}>업로드 동의 설정 →</a>
        </section>)}
      </div>
    </section>
  </section>;
}
