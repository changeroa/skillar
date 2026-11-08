import { useState } from "preact/hooks";
import { ganttGeometry, ganttViewport } from "./geometry";
import { formatOffset } from "./model";

type Graph = NonNullable<ReturnType<typeof ganttGeometry>>;

export function useGanttWindow(graph: Graph | undefined) {
  const [zoom, setZoom] = useState(1), [position, setPosition] = useState(0);
  return { zoom, position, setPosition, setZoom,
    viewport: graph ? ganttViewport(graph, zoom, position) : undefined };
}

export function GanttControls({ graph, window }: { readonly graph: Graph; readonly window: ReturnType<typeof useGanttWindow> }) {
  const viewport = window.viewport;
  if (!viewport) return null;
  return <section class="event-gantt-controls" aria-label="타임라인 범위" data-zoom={window.zoom}
    data-start={viewport.start} data-end={viewport.end}>
    <div class="event-gantt-tools">
      <button class="pe-button" aria-label="타임라인 축소" disabled={window.zoom === 1}
        onClick={() => window.setZoom(value => value / 2)}>−</button>
      <button class="pe-button" aria-label="타임라인 확대" disabled={window.zoom === 64 || graph.start === graph.end}
        onClick={() => window.setZoom(value => value * 2)}>+</button>
      <button class="pe-button" data-gantt-reset onClick={() => { window.setZoom(1); window.setPosition(0); }}>전체</button>
      <output>{formatOffset(viewport.start - graph.start)} – {formatOffset(viewport.end - graph.start)}</output>
    </div>
    <p class="pe-muted">전체 {formatOffset(graph.end - graph.start)}</p>
    <div class="event-gantt-overview" role="img" aria-label="전체 세션에서 현재 표시 중인 구간">
      {graph.points.filter(point => !point.outside).map(point => <i key={point.key} style={`left:${point.x}%`} />)}
      <span data-gantt-window style={`left:${viewport.left}%;width:${viewport.width}%`} />
    </div>
    <label class="event-gantt-position">확대 구간 시작
      <input type="range" min="0" max="100" step="1" value={window.position * 100} disabled={window.zoom === 1}
        aria-label="확대 구간 시작" aria-valuetext={formatOffset(viewport.start - graph.start)}
        onInput={event => window.setPosition(Number(event.currentTarget.value) / 100)} />
    </label>
  </section>;
}
