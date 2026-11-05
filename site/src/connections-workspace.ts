import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Model } from "./mcp-connections";
import { connectionStatus } from "./mcp-connections";
import { readProfiles, describeFailure, isUnauthorized } from "./dashboard/api";
import { ConnectDevice, DeviceCard } from "./dashboard/devices";
import type { DeviceState } from "./dashboard/devices";
import { describeConsent } from "./dashboard/consent";
import { DataTable, FacetPanel, KeyValueGrid, PeekPanel, Pill, Skeleton, usePeekSelection } from "./ui";
import type { TableColumn, TableSort } from "./ui";
import { KST_TIME_ZONE } from "./time.ts";

type Row = {
  readonly id: string; readonly name: string; readonly kind: string;
  readonly status: string; readonly scope: string; readonly created: number;
  readonly device?: DeviceState;
  readonly mcp?: Model["connections"][number];
};
const kinds = ["기기", "OAuth", "개인 토큰"];
const states = ["활성", "만료", "해제됨"];
const date = (seconds: number) => `${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: KST_TIME_ZONE }).format(seconds * 1000)} KST`;
const statusText = { active: "활성", expired: "만료", revoked: "해제됨" } as const;

export function connectionRows(model: Model, devices: readonly DeviceState[], now: number): readonly Row[] {
  return [
    ...devices.map(device => ({
      id: `device:${device.deviceId}`, name: device.deviceId, kind: "기기",
      status: device.revokedAt === null ? "활성" : "해제됨",
      scope: describeConsent(device.consent), created: device.createdAt, device,
    })),
    ...model.connections.map(mcp => ({
      id: mcp.connectionId, name: mcp.name, kind: mcp.kind === "oauth" ? "OAuth" : "개인 토큰",
      status: statusText[connectionStatus(mcp, now)], scope: "비공개 스킬 읽기", created: mcp.createdAt, mcp,
    })),
  ];
}

function readView() {
  const query = new URL(location.href).searchParams;
  const direction = query.get("direction") === "ascending" ? "ascending" : "descending";
  const showRevoked = query.get("revoked") === "1";
  return {
    q: query.get("q") ?? "",
    kind: query.getAll("kind").filter(value => kinds.includes(value)),
    status: query.has("status") ? query.getAll("status").filter(value => states.includes(value))
      : showRevoked ? [] : ["활성"],
    showRevoked,
    sort: { column: query.get("sort") ?? "created", direction } satisfies TableSort,
  };
}

export function ConnectionsWorkspace({ model, operationMessage, onUnauthorized }: {
  readonly model: Model; readonly operationMessage: string; readonly onUnauthorized: () => void;
}) {
  const [view, setView] = useState(readView);
  const [selected, select] = usePeekSelection("connection");
  const [devices, setDevices] = useState<readonly DeviceState[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [ingestEnabled, setIngestEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const signal = useRef(new AbortController());
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (selected !== null) setOpener(document.querySelector<HTMLElement>(`.connection-row[data-id="${CSS.escape(selected)}"]`));
  }, [selected, model.connections, devices]);
  useEffect(() => {
    const restore = () => setView(readView());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    signal.current = controller;
    setLoading(true);
    void readProfiles(controller.signal).then(result => {
      setDevices(result.devices.map(device => ({ ...device, version: device.consentVersion })));
      setIngestEnabled(result.ingestEnabled);
      setFailure("");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isUnauthorized(error)) { onUnauthorized(); return; }
      setFailure(describeFailure(error, "기기 조회"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const change = (next: typeof view) => {
    const url = new URL(location.href);
    for (const key of ["q", "kind", "status", "revoked", "sort", "direction"]) url.searchParams.delete(key);
    if (next.q) url.searchParams.set("q", next.q);
    next.kind.forEach(value => url.searchParams.append("kind", value));
    if (next.status.length) next.status.forEach(value => url.searchParams.append("status", value));
    else url.searchParams.set("status", "all");
    if (next.showRevoked) url.searchParams.set("revoked", "1");
    url.searchParams.set("sort", next.sort.column);
    url.searchParams.set("direction", next.sort.direction);
    history.replaceState(null, "", url);
    setView(next);
  };
  const rows = connectionRows(model, devices, Date.now() / 1000);
  const filtered = rows.filter(row => (!view.kind.length || view.kind.includes(row.kind)) &&
    (!view.status.length || view.status.includes(row.status)) &&
    `${row.name} ${row.id}`.toLocaleLowerCase("ko").includes(view.q.toLocaleLowerCase("ko")));
  const revoked = rows.filter(row => row.status === "해제됨").length;
  const hiddenRevoked = revoked - filtered.filter(row => row.status === "해제됨").length;
  const busy = loading || model.phase === "checking" || model.phase === "loading";
  const countKnown = !busy && !failure && model.phase === "ready";
  const current = rows.find(row => row.id === selected);
  const columns: readonly TableColumn<Row>[] = [
    { id: "name", label: "이름 / 토큰", value: row => row.name, render: row =>
      h("button", { type: "button", class: "connection-row", "data-id": row.id, "data-name": "",
        onClick: (event: MouseEvent) => {
          if (event.currentTarget instanceof HTMLElement) setOpener(event.currentTarget);
          select(row.id);
        } }, row.name) },
    { id: "kind", label: "종류", value: row => row.kind },
    { id: "status", label: "상태", value: row => row.status, render: row => h(Pill, null, row.status) },
    { id: "scope", label: "범위", value: row => row.scope },
    { id: "created", label: "생성일", value: row => row.created, render: row => date(row.created) },
  ];
  const common = {
    signal: signal.current.signal, onChanged: () => setRevision(value => value + 1),
    onUnauthorized,
  };
  return h("div", null,
    h("div", { class: "connections-toolbar" },
      h("h2", { id: "connections-title" }, "토큰 / 기기"),
      h("label", { class: "connections-search" }, "연결 검색",
        h("input", { type: "search", value: view.q, onInput: event => change({ ...view, q: event.currentTarget.value }) })),
      h("button", { type: "button", id: "connections-show-revoked", class: "button secondary",
        "aria-pressed": view.showRevoked, disabled: !countKnown,
        onClick: () => change({ ...view, showRevoked: !view.showRevoked, status: view.showRevoked ? ["활성"] : [] }),
      }, countKnown ? `해제됨 보기 (${revoked})` : "해제됨 보기")),
    h("p", { class: "note" }, "받은 목록 안에서 검색·정렬합니다. 활성은 온라인 상태가 아닙니다."),
    failure && h("p", { role: "status", class: "note" }, failure,
      h("button", { type: "button", class: "button secondary", onClick: common.onChanged }, "기기 다시 불러오기")),
    busy && h(Skeleton, { label: "연결 목록을 불러오는 중", rows: 2 }),
    !busy && h("div", { class: "connections-grid" },
      h("details", { class: "connections-filters" },
        h("summary", null, "필터"),
        h(FacetPanel, { title: "연결 필터", scope: countKnown ? `받은 전체 목록 ${rows.length}개 기준` : "일부 목록을 확인하지 못했습니다.",
          groups: [
            { id: "kind", label: "종류", values: kinds.map(label => ({ id: label, label, count: rows.filter(row => row.kind === label).length })) },
            { id: "status", label: "상태", values: states.map(label => ({ id: label, label, count: rows.filter(row => row.status === label).length })) },
          ], selected: { kind: view.kind, status: view.status },
          onChange: (group, values) => change({ ...view, [group]: [...values] }) })),
      h(DataTable<Row>, { caption: countKnown
        ? `연결 ${filtered.length}개${hiddenRevoked ? ` · 해제됨 ${hiddenRevoked}개 숨김` : ""}` : "연결 수 확인 불가",
        rows: filtered, columns, rowId: row => row.id, sort: view.sort, onSort: sort => change({ ...view, sort }) })),
    countKnown && rows.length === 0 && h("p", { class: "ui-empty" },
      "아직 연결이 없습니다. ", h("a", { class: "button secondary", href: "#endpoint-title" }, "MCP 설정으로 연결하기")),
    h("details", { class: "connections-pairing" }, h("summary", null, "새 기기 연결"),
      h(ConnectDevice, { ...common, origin: location.origin })),
    selected !== null && (opener !== null || !loading) && h(PeekPanel, {
      children: null,
      id: "connection-peek", selectedId: selected, title: current?.name ?? "연결을 찾을 수 없습니다",
      returnFocus: opener,
      onClose: () => select(null),
    }, current ? h("div", { "data-id": current.id },
      operationMessage && h("p", { role: "status", class: "note", "data-operation-status": "" }, operationMessage),
      h(KeyValueGrid, { entries: [
        { label: "식별자", value: h("code", null, current.id) },
        { label: "종류", value: current.kind }, { label: "상태", value: h(Pill, null, current.status) },
        { label: "범위", value: current.scope }, { label: "생성일", value: date(current.created) },
        { label: "사용량", value: "미측정" },
        ...(current.mcp ? [
          { label: "만료일", value: date(current.mcp.expiresAt) },
          { label: "권한", value: current.mcp.scopes.map(scope => h("code", { key: scope }, `${scope} `)) },
          { label: "활동 기록", value: current.mcp.recordActivity ? "켜짐 · 검색과 읽기를 기록합니다." : "꺼짐" },
        ] : []),
      ] }),
      current.device && h(DeviceCard, { ...common, key: current.device.deviceId, device: current.device, ingestEnabled }),
      current.mcp && current.status !== "해제됨" && h("div", { class: "cluster connection__actions" },
        model.confirming === current.id ? [
          h("button", { class: "button secondary", type: "button", "data-action": "keep" }, "연결 유지"),
          h("button", { class: "button danger", type: "button", "data-action": "confirm", disabled: model.revoking !== null }, "연결 해제 확인"),
          h("p", { class: "note" }, "이 연결을 사용하는 에이전트의 접근이 즉시 중단됩니다. 되돌릴 수 없으며 이미 기록된 활동은 대시보드에 남습니다."),
        ] : h("button", { class: "button danger", type: "button", "data-action": "revoke", disabled: model.revoking !== null }, "연결 해제…")))
      : h("p", null, "이 연결이 받은 목록에 없습니다. 필터를 닫거나 목록을 다시 확인하세요.")));
}
