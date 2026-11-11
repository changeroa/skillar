import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Filter } from "../../src/types.js";
import { ApiError } from "../api";
import { DOW_LABEL, RUNTIME_IDS, RUNTIME_LABEL, STATE_LABEL, buildHash, serializeFilter, skillName, type ViewProps } from "../state";
import { installStyles } from "../charts/sankey";
import { kstPeriodStart } from "../time";
import { Button } from "../foundation/controls/buttons";
import { Select } from "../foundation/controls/fields";
import { Card, Metric as FoundationMetric } from "../foundation/widgets/cards";
import { Alert, EmptyState } from "../foundation/widgets/messages";
import { consoleStyles } from "./console-style";

/** Keep a report and the exact conditions that produced it together. */
export function useAnalysisReport<T>(key: string, load: () => Promise<T>, sequence: number) {
  const [snapshot, setSnapshot] = useState<{ readonly value: T; readonly key: string }>();
  const [busy, setBusy] = useState(true), [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(undefined);
    load().then(value => {
      if (!cancelled) setSnapshot({ value, key });
    }, reason => { if (!cancelled) setError(reason); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [key, sequence, refresh]);
  return { snapshot, busy, error, refresh: () => setRefresh(value => value + 1) };
}

export function AnalysisError({ error, retry, title }: { readonly error: unknown; readonly retry: () => void; readonly title: string }) {
  if (error === undefined) return null;
  return <Alert announce variant="destructive" title={error instanceof ApiError && error.status === 403 ? "이 기록을 볼 권한이 없습니다" : title}
    action={<Button text="다시 시도" variant="outline" onClick={retry} />}>
    <details><summary>기술 세부 정보</summary><pre>{error instanceof Error ? error.message : String(error)}</pre></details>
  </Alert>;
}

export function conditions(filter: Filter) {
  const date = (value: number) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return [
    filter.from === undefined ? "시작 제한 없음" : date(filter.from),
    filter.to === undefined ? "종료 제한 없음" : date(filter.to),
    filter.runtime?.map(value => RUNTIME_LABEL[value]).join(", "),
    filter.skill?.map(skillName).join(", "), filter.q,
    filter.automated === "include" ? "자동 실행 포함" : filter.automated === "only" ? "자동 실행만" : "자동 실행 제외",
    filter.searchStatus?.map(value => `검색 ${STATE_LABEL[value]}`).join(", "),
    filter.loadStatus?.map(value => `읽기 ${STATE_LABEL[value]}`).join(", "),
    filter.searchResult?.map(value => value === "candidates_found" ? "후보 있음" : "후보 없음").join(", "),
    filter.state?.map(value => STATE_LABEL[value]).join(", "),
    filter.dow === undefined ? undefined : `${DOW_LABEL[filter.dow]}요일`,
    filter.hour === undefined ? undefined : `${filter.hour}시부터 ${filter.hourSpan ?? 1}시간`,
  ].filter(Boolean).join(" · ");
}

export function AnalysisToolbar({ route, navigate, refresh, busy, workspace = false }: Pick<ViewProps, "route" | "navigate"> & {
  readonly refresh: () => void; readonly busy: boolean; readonly workspace?: boolean;
}) {
  const update = (patch: Filter) => navigate({ ...route, peek: undefined, filter: { ...route.filter, ...patch } });
  return <div class="analysis-toolbar">
    <Select label="기간" value={route.filter.from === undefined && route.filter.to === undefined ? "all" : "custom"} onChange={event => {
      const value = event.currentTarget.value, now = Date.now();
      update(value === "all" ? { from: undefined, to: undefined } : { from: kstPeriodStart(now, Number(value)), to: now });
    }} options={[{ value: "all", label: "전체 기간" }, { value: "custom", label: "지정 기간", disabled: true },
      { value: "7", label: "최근 7일" }, { value: "30", label: "최근 30일" }, { value: "60", label: "최근 60일" }]} />
    {!workspace && <Select label="실행 환경" value={route.filter.runtime?.[0] ?? "all"} onChange={event => {
      const runtime = RUNTIME_IDS.find(value => value === event.currentTarget.value);
      update({ runtime: runtime ? [runtime] : undefined });
    }} options={[{ value: "all", label: "전체" }, ...RUNTIME_IDS.map(value => ({ value, label: RUNTIME_LABEL[value] }))]} />}
    <Select label="자동 실행" value={route.filter.automated ?? "exclude"} onChange={event => {
      const value = event.currentTarget.value;
      update({ automated: value === "include" || value === "only" ? value : undefined });
    }} options={[{ value: "exclude", label: "제외" }, { value: "include", label: "포함" }, { value: "only", label: "자동 실행만" }]} />
    <Button text={busy ? "갱신 중…" : "새로 고침"} variant="outline" onClick={refresh} disabled={busy} />
    {serializeFilter(route.filter) && <Button text="필터 지우기" variant="outline" onClick={() => navigate({ ...route, peek: undefined, filter: {} })} />}
  </div>;
}

export function AnalysisEmpty({ route, navigate }: Pick<ViewProps, "route" | "navigate">) {
  const filtered = Boolean(serializeFilter(route.filter));
  return <EmptyState title={filtered ? "조건에 맞는 세션이 없습니다" : "아직 기록된 세션이 없습니다"}
    description={filtered ? "기간을 늘리거나 필터를 해제하면 더 많은 세션을 볼 수 있습니다." : "연결된 실행 환경에서 세션을 시작하면 기록이 여기에 나타납니다."}
    action={filtered ? <Button text="필터 지우기" variant="outline" onClick={() => navigate({ ...route, filter: {} })} />
      : <><a class="pe-button" href={buildHash({ view: "sessions", filter: {} })}>세션과 연결 안내 보기</a><code>skillar doctor</code></>} />;
}

export function Metric({ label, value, suffix, children }: { readonly label: string; readonly value: number | null; readonly suffix?: string; readonly children?: ComponentChildren }) {
  return <section class="analysis-tile"><FoundationMetric label={label} value={value} suffix={suffix} /><div class="pe-muted">{children}</div></section>;
}

export function AnalysisWidget({ title, id, wide = false, children }: {
  readonly title: string; readonly id: string; readonly wide?: boolean; readonly children: ComponentChildren;
}) {
  return <div class={wide ? "analysis-widget-shell analysis-widget--wide" : "analysis-widget-shell"} data-widget={id}>
    <Card title={title}>{children}</Card>
  </div>;
}

consoleStyles();
installStyles("analysis", `
.analysis{display:grid;gap:16px;min-width:0;line-height:1.65}
.analysis .page-title{margin:0}.analysis .page-title h1,.analysis .page-title h2{font-size:22px;margin:0}
.analysis .page-title p{margin:4px 0;color:var(--ink-2)}
.analysis-toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:8px}
.analysis-toolbar label{display:grid;gap:4px;font-size:12px;color:var(--ink-2)}
.analysis-toolbar select{min-width:100px;min-height:44px}
.analysis-scope{font-size:12px;color:var(--ink-2);margin:0;overflow-wrap:anywhere}
.analysis-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.analysis-tile,.analysis-widget{border:1px solid var(--line);padding:16px;min-width:0;background:var(--bg)}
.analysis-tile h2,.analysis-widget h2{font-size:14px;margin:0 0 8px;font-weight:600}
.analysis-number{font-size:28px;line-height:1.4;font-weight:600;font-variant-numeric:tabular-nums;margin:0 0 8px}
.analysis-tile .pe-muted,.analysis-widget .pe-muted{font-size:12px}
.analysis-widgets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.analysis-widget--wide{grid-column:span 2}
.analysis-scroll{overflow-x:auto;min-width:0;scrollbar-gutter:stable}
.analysis-table{border-collapse:collapse;width:100%;font-size:14px}
.analysis-table th,.analysis-table td{text-align:left;border-bottom:1px solid var(--line);padding:0 8px;height:44px;overflow-wrap:anywhere}
.analysis-table th{color:var(--ink-2);font-size:12px;font-weight:500}
.analysis-table th button{border:0;background:transparent;padding:4px 0;min-height:44px;min-width:44px;text-align:left;color:inherit;cursor:pointer}
.analysis-table a,.analysis-table td>button{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:var(--ink);background:none;border:0;text-decoration:none;text-align:left;cursor:pointer;font:inherit}
.analysis-table tbody tr:hover,.analysis-table tr[aria-selected=true]{background:var(--wash)}
.analysis-table .num{text-align:right;font-variant-numeric:tabular-nums}
.analysis .notice p{margin:0}.analysis details summary{min-height:44px;cursor:pointer}.analysis pre{white-space:pre-wrap;overflow-wrap:anywhere}
.analysis-facets{display:flex;gap:8px;flex-wrap:wrap}.analysis-facets [aria-pressed=true]{background:var(--wash-2);font-weight:600}
.analysis-chart{margin:0}.analysis-chart svg{display:block;color:var(--ink-2);font-size:12px;max-width:none}
.analysis-chart text{fill:currentColor}.analysis-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;margin:8px 0}
.analysis-key{display:inline-block;width:8px;height:8px;margin-right:4px;background:var(--ink-2)}.analysis-key--read{background:var(--accent)}
.analysis-unmeasured{border:1px dashed var(--line-2);padding:16px;margin-top:8px}
.workspace-split{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}.workspace-split:has(.workspace-peek){grid-template-columns:minmax(0,1fr) 560px}
.workspace-peek{border:1px solid var(--line);height:calc(100dvh - 48px);position:fixed;top:48px;right:0;width:560px;z-index:20;display:flex;flex-direction:column;min-width:0;background:var(--bg)}
.workspace-peek__head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--line)}
.workspace-peek__body{overflow:auto;min-height:0;flex:1;padding:12px}.workspace-peek h2{font-size:18px}
.analysis .seg__btn,.analysis .seg__b{height:44px;min-width:44px}.analysis .seg{overflow:visible;flex-wrap:wrap}
.analysis>.seg{justify-self:start;margin-inline-start:0}
.analysis .seg__btn:focus-visible,.analysis .seg__b:focus-visible{outline-offset:2px}
.analysis .toolbar,.analysis .flow__legend{margin:0}
.analysis .paths th{padding:0 8px;height:44px}
.analysis .paths__share{background:none}.analysis .paths__skill{display:inline-flex;align-items:center;min-width:44px;min-height:44px}
.analysis .ws__back,.analysis .sess__link{min-width:44px;min-height:44px;display:inline-flex;align-items:center}
.analysis .pane__sum,.analysis .turn__sum{min-height:44px}.analysis .ws__title,.analysis .hmc__title{letter-spacing:0}
.analysis .hmc__title{font-size:18px}.analysis .hmc{background:var(--bg)}
.analysis .hm{min-width:calc(var(--hm-cols) * 48px + 120px)}
.analysis .hm__cell,.analysis .hm__skill{min-width:44px;min-height:44px}
.analysis [data-tip][data-tooltip-dismissed]::after{display:none}
.analysis .hm__cell:focus-visible{outline-offset:2px}
.analysis .hm__legend{flex-wrap:wrap;line-height:1.65}
.analysis [data-widget=flow]{display:flex;flex-direction:column}
.analysis [data-widget=flow]>.pe-button{margin-top:auto;align-self:start}
.analysis [data-widget=activity]{display:flex;flex-direction:column}
.analysis [data-widget=activity]>.pe-button{margin-top:auto;align-self:start}
.dashboard-activity-grid{border-collapse:separate;border-spacing:2px;width:100%;font-size:12px;text-align:center}
.dashboard-activity-grid caption{text-align:left;color:var(--ink-2);margin-bottom:8px}
.dashboard-activity-grid th{font-weight:500;color:var(--ink-2)}
.dashboard-activity-grid td{height:24px;min-width:24px;background:var(--wash)}
.dashboard-activity-grid [data-level="1"]{background:var(--wash-2)}
.dashboard-activity-grid [data-level="2"]{background:color-mix(in srgb,var(--accent) 15%,var(--bg))}
.dashboard-activity-grid [data-level="3"]{background:color-mix(in srgb,var(--accent) 30%,var(--bg))}
.dashboard-activity-grid [data-level="4"]{background:var(--accent);color:var(--on-accent)}
.analysis.pe-console{grid-template-columns:minmax(0,1fr);line-height:var(--lf-leading-sm);color:var(--lf-foreground)}
.analysis.pe-console>header>:is(h1,h2){border-color:var(--lf-border);font:var(--lf-weight-strong) var(--lf-text-lg)/24px var(--lf-font-sans)}
.analysis.pe-console .analysis-toolbar{gap:var(--lf-space-2)}
.analysis.pe-console .analysis-toolbar>.lf-field{min-width:0;flex:0 1 auto}
.analysis.pe-console .analysis-toolbar :is(select,.lf-select-wrap){height:var(--lf-control-height);min-height:var(--lf-control-height)}
.analysis.pe-console .analysis-toolbar label{display:block}
.analysis.pe-console .analysis-tile{padding:0;border-color:var(--lf-border);border-radius:var(--lf-radius-lg);background:var(--lf-card);box-shadow:var(--lf-widget-shadow)}
.analysis.pe-console .analysis-tile>.pe-muted{padding:0 var(--lf-space-4) var(--lf-space-4);font-size:var(--lf-text-xs)}
.analysis-widget-shell{min-width:0;display:flex}.analysis-widget-shell>.lf-card{width:100%}
.analysis.pe-console :is(.analysis-table th,.analysis-table td){height:var(--lf-control-height);font-size:var(--lf-text-sm);line-height:var(--lf-leading-sm);border-color:var(--lf-border)}
.analysis.pe-console .analysis-table th{height:calc(var(--lf-control-height) + var(--lf-space-2));padding:var(--lf-space-1);font-weight:var(--lf-weight-strong);line-height:var(--lf-leading-sm)}
.analysis.pe-console .analysis-table th:first-child{padding-left:var(--lf-space-2)}
.analysis.pe-console :is(.analysis-table th button,.analysis-table td>button,.analysis-table a,.paths__skill,.ws__back,.sess__link,.pane__sum,.turn__sum){min-height:var(--lf-control-height);min-width:var(--lf-control-height)}
.analysis.pe-console .workspace-table .wsrow__title{height:var(--lf-control-height);white-space:nowrap}
.analysis.pe-console :is(.seg__btn,.seg__b){height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding:0 var(--lf-space-4);border:0;border-color:var(--lf-border);border-radius:var(--lf-radius-sm);font-size:var(--lf-text-sm);line-height:var(--lf-text-sm);font-weight:var(--lf-weight-strong)}
.analysis.pe-console :is(.hmc,.flow__paths,.flow__chart){border-color:var(--lf-border);border-radius:var(--lf-radius-lg);background:var(--lf-card)}
.analysis.pe-console .hmc__title{font-size:var(--lf-text-base);line-height:var(--lf-leading-base);font-weight:var(--lf-weight-strong)}
.hm-stack.analysis.pe-console{--hm-l1:color-mix(in srgb,var(--lf-chart-1) 24%,transparent);--hm-l2:color-mix(in srgb,var(--lf-chart-1) 46%,transparent);--hm-l3:color-mix(in srgb,var(--lf-chart-1) 70%,transparent);--hm-l4:var(--lf-chart-1)}
.ws.analysis.pe-console .card{padding:var(--lf-space-4);border-color:var(--lf-border);border-radius:var(--lf-radius-lg);background:var(--lf-card)}
.analysis.pe-console :is(.hmc,.flow__chart),.ws.analysis.pe-console .card{font-size:var(--lf-text-lg);line-height:var(--lf-space-6);box-shadow:var(--lf-widget-shadow)}
.analysis.pe-console :is(.hmc__title,.lf-card__title,.lf-card__header,.lf-card__content,.lf-metric__value){border-color:var(--lf-border)}
.ws.analysis.pe-console>section.card>h2{font:var(--lf-weight-strong) var(--lf-text-base)/var(--lf-leading-base) var(--lf-font-sans);color:var(--lf-foreground);letter-spacing:-.025em}
.analysis.pe-console .workspace-peek{border-color:var(--lf-border);background:var(--lf-modal);box-shadow:var(--lf-shadow-peek)}
.analysis.pe-console :is(.pe-button,summary,.seg__btn,.seg__b,.analysis-table button,.analysis-table a):focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:var(--lf-focus-offset)}
.analysis.pe-console :is(.seg__btn,.seg__b)[aria-pressed=true]::after{content:" ✓";color:inherit}
.analysis.pe-console .analysis-facets [aria-pressed=true]{background:var(--lf-muted)}
.analysis.pe-console .analysis-facets [aria-pressed=true]::after{content:" ✓"}
.analysis.pe-console .analysis-scroll{scrollbar-gutter:auto}
@media(max-width:1023px){.workspace-split:has(.workspace-peek){display:block}.workspace-peek{position:fixed;inset:0;height:100dvh;z-index:100;width:100%}.analysis.pe-console .workspace-peek{border:0;border-color:var(--lf-border);box-shadow:none}}
@media(max-width:639px){.analysis-tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.analysis-tile,.analysis-widget{padding:12px}.analysis-number{font-size:22px}.analysis-widgets{grid-template-columns:minmax(0,1fr)}.analysis-widget--wide{grid-column:auto}.analysis-toolbar{gap:6px}.analysis-toolbar label{flex:1;min-width:0}.analysis-toolbar select{min-width:0;width:100%;padding-inline:4px}.analysis-refresh{width:44px;padding:0}.analysis-refresh__text{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.analysis-table th,.analysis-table td{padding:0 4px}}
@media(max-width:639px){.analysis .paths td{padding:0 8px}}
`);
