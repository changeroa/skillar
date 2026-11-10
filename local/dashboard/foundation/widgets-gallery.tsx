import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Button, IconButton, Select } from "./controls";
import { Card, Widget, MetricStrip, Metric, BarChart, LineChart, Histogram, EmptyState, Alert, StatusMessage, Callout } from "./widgets";
import type { ChartData, WidgetState } from "./widgets";

const chart: ChartData = { labels: ["월\nKST", "화\nKST", "수\nKST"], series: [
  { label: "읽기", values: [0, 7, null] }, { label: "검색", values: [3, 14, 2] },
] };
function Specimen({ name, children }: { readonly name: string; readonly children: ComponentChildren }) {
  return <section data-specimen={name} class="lf-widget-specimen"><h2>{name}</h2>{children}</section>;
}
export function WidgetsGallery() {
  const [theme, setTheme] = useState(document.documentElement.dataset["theme"] ?? "system");
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  return <main id="gallery" data-ready="true" class="lf-gallery lf-widgets-gallery">
    <header class="lf-gallery__header"><div><h1>위젯과 차트</h1><p>합성 데이터 · 측정값과 미측정 구분</p></div>
      <Select label="테마" value={theme} options={[{ value: "system", label: "시스템" }, { value: "light", label: "라이트" }, { value: "dark", label: "다크" }]}
        onChange={event => { const value = event.currentTarget.value; document.documentElement.dataset["theme"] = value; setTheme(value); }} /></header>
    <Specimen name="Card"><Card title="읽기 기록" description="최근 3일 · KST"
      actions={<Button text="새로 읽기" variant="outline" />} footer="업로드 동의가 있는 기록만 표시합니다.">기록된 사용량을 확인합니다.</Card></Specimen>
    <Specimen name="Metric"><MetricStrip label="현재 범위" metrics={[
      { label: "읽기", value: 0, note: "실제 측정값" }, { label: "검색", value: 21, note: "최근 3일 · KST" },
      { label: "비용", value: null, note: "미측정은 0이 아닙니다." },
    ]} /></Specimen>
    <Specimen name="Bar"><BarChart title="일별 읽기와 검색 · KST" data={chart} /></Specimen>
    <Specimen name="Line"><LineChart title="일별 요청 추이 · KST" data={chart} /></Specimen>
    <Specimen name="Histogram"><Histogram title="세션 빈도 · KST · 일별" labels={chart.labels} values={[0, 7, 2]} /></Specimen>
    <Specimen name="Chart-unmeasured"><BarChart title="비용 · 미측정" data={{ labels: ["월", "화"], series: [{ label: "비용", values: [null, null] }] }} /></Specimen>
    <Specimen name="Chart-empty"><LineChart title="읽기 · 빈 범위" data={{ labels: [], series: [] }} /></Specimen>
    <Specimen name="Line-unmeasured"><LineChart title="요청 · 미측정" data={{ labels: ["월", "화"], series: [{ label: "요청", values: [null, null] }] }} /></Specimen>
    <Specimen name="Histogram-unmeasured"><Histogram title="빈도 · 미측정" labels={["월", "화"]} values={[null, null]} /></Specimen>
    <Specimen name="Bar-empty"><BarChart title="요청 · 빈 범위" data={{ labels: [], series: [] }} /></Specimen>
    <Specimen name="Histogram-empty"><Histogram title="빈도 · 빈 범위" labels={[]} values={[]} /></Specimen>
    {([
      { kind: "ready" },
      { kind: "loading" },
      { kind: "empty", message: "다른 기간을 선택해 주세요.", action: <Button text="다시 읽기" variant="outline" /> },
      { kind: "error", message: "연결을 확인하고 다시 읽어 주세요.", action: <Button text="다시 읽기" variant="outline" /> },
    ] satisfies readonly WidgetState[]).map(state => <Specimen key={state.kind} name={`Widget-${state.kind}`}>
      <Widget title="기록" state={state}>기록</Widget></Specimen>)}
    <Specimen name="Empty"><EmptyState title="표시할 데이터가 없습니다" description="기간을 변경하거나 연결을 확인하세요."
      action={<Button text="연결 확인" variant="outline" />} /></Specimen>
    <Specimen name="Empty-intro"><EmptyState variant="intro" title="스킬을 등록해 보세요"
      description="스킬을 만들거나 기존 파일을 가져오면 기록을 확인할 수 있습니다." /></Specimen>
    {(["default", "info", "warning", "destructive"] as const).flatMap(variant => (["default", "sm"] as const).map(size =>
      <Specimen key={`${variant}-${size}`} name={`Alert-${variant}-${size}`}>
        <Alert title="기록 확인" variant={variant} size={size} icon="dashboard">현재 선택한 기간의 기록을 표시합니다.</Alert>
      </Specimen>))}
    {(["DEFAULT", "DEBUG", "WARNING", "ERROR"] as const).flatMap(level => (["default", "compact"] as const).map(size =>
      <Specimen key={`${level}-${size}`} name={`StatusMessage-${level}-${size}`}>
        <StatusMessage level={level} size={size} message={level === "ERROR" ? "기록을 불러오지 못했습니다.\n연결을 확인하고 다시 시도하세요." : "기록된 관찰 메시지입니다."} />
      </Specimen>))}
    {(["info", "warning"] as const).flatMap(variant => (["top", "middle"] as const).map(align => {
      const name = `Callout-${variant}-${align}`;
      return <Specimen key={name} name={name}>{dismissed.includes(name) ? <Button text="안내 다시 표시" variant="outline"
        onClick={() => setDismissed(previous => previous.filter(value => value !== name))} /> :
        <Callout variant={variant} align={align} onDismiss={() => setDismissed(previous => [...previous, name])}
          actions={[{ type: "button", label: "연결 확인", onClick: () => setDismissed(previous => [...previous, name]) }]}>
          <p>업로드 동의와 출처를 확인하면 <span style={{ whiteSpace: "nowrap" }}>기록을 볼 수 있습니다.</span></p>
        </Callout>}</Specimen>;
    }))}
    <Specimen name="Metric-zero"><Metric label="측정값" value={0} /></Specimen>
    <Specimen name="Metric-unmeasured"><Metric label="측정값" value={null} /></Specimen>
    <Specimen name="Card-minimal"><Card title="기록">기록된 사용량입니다.</Card></Specimen>
    <Specimen name="Metric-affixes"><Metric label="비용" value={7} prefix="₩" suffix="원" note="기록된 값" /></Specimen>
    <Specimen name="Metric-strip-empty"><MetricStrip label="빈 측정 범위" metrics={[]} /></Specimen>
    <Specimen name="Empty-minimal"><EmptyState title="표시할 데이터가 없습니다" /></Specimen>
    <Specimen name="Alert-body-only"><Alert>기록된 관찰 메시지입니다.</Alert></Specimen>
    <Specimen name="Alert-icon-only"><Alert icon="dashboard">기록된 관찰 메시지입니다.</Alert></Specimen>
    <Specimen name="Alert-action"><Alert title="기록 확인" action={<Button text="다시 읽기" variant="outline" />}>연결을 확인하세요.</Alert></Specimen>
    <Specimen name="Alert-dismissible">{dismissed.includes("Alert-dismissible") ?
      <Button text="안내 다시 표시" variant="outline" onClick={() => setDismissed(previous => previous.filter(value => value !== "Alert-dismissible"))} /> :
      <Alert title="기록 확인" action={<IconButton label="안내 닫기" icon="close" onClick={() => setDismissed(previous => [...previous,"Alert-dismissible"])} />}>연결을 확인하세요.</Alert>}</Specimen>
    {(["no-actions","links","disabled"] as const).map(mode => {
      const name=`Callout-${mode}`;
      return <Specimen key={name} name={name}>{dismissed.includes(name) ?
        <Button text="안내 다시 표시" variant="outline" onClick={() => setDismissed(previous => previous.filter(value => value !== name))} /> :
        <Callout variant="info" onDismiss={() => setDismissed(previous => [...previous,name])}
          actions={mode==="links" ? [{type:"link",label:"기록 위치",href:"#gallery"},{type:"link",label:"Skillar",href:"https://skillar.sh"}] :
            mode==="disabled" ? [{type:"button",label:"연결 확인",disabled:true,onClick:()=>{}}] : []}>
          <p>업로드 동의와 출처를 확인하면 기록을 볼 수 있습니다.</p>
        </Callout>}</Specimen>;
    })}
    <Specimen name="Widget-empty-no-action"><Widget title="기록" state={{kind:"empty",message:"다른 기간을 선택해 주세요."}}>기록</Widget></Specimen>
    <Specimen name="Widget-error-no-action"><Widget title="기록" state={{kind:"error",message:"연결을 확인해 주세요."}}>기록</Widget></Specimen>
    <Specimen name="StatusMessage-announced-status"><StatusMessage level="DEFAULT" message="기록을 갱신했습니다." announce /></Specimen>
    <Specimen name="StatusMessage-announced-error"><StatusMessage level="ERROR" message="연결을 확인해 주세요." announce /></Specimen>
  </main>;
}
