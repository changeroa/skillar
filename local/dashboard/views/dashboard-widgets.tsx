import type { FlowDto, SkillEntry } from "../../src/types.js";
import type { SessionListRow } from "../api";
import { DOW_LABEL, skillName } from "../state";
import { buildGrid } from "../charts/heatmap";
import { Sankey } from "../charts/sankey";
import { sessionsHeatmap } from "./analysis-data";

export function DashboardActivity({ rows, tz }: { readonly rows: readonly SessionListRow[]; readonly tz: string }) {
  const grid = buildGrid(sessionsHeatmap(rows, tz, 1), { bucketHours: 4 });
  return <div class="analysis-scroll"><table class="dashboard-activity-grid">
    <caption>요일·시간대 활동 · 세션 시작 · {tz} · 4시간</caption>
    <thead><tr><th scope="col">요일</th>{grid.hours.map(hour => <th scope="col" key={hour}>{hour}시</th>)}<th scope="col">합계</th></tr></thead>
    <tbody>{grid.rows.map((row, index) => <tr key={grid.dows[index]}><th scope="row">{DOW_LABEL[grid.dows[index]!]}</th>{row.map(cell =>
      <td key={cell.hour} data-level={cell.level} title={`${DOW_LABEL[cell.dow]}요일 ${cell.hour}시부터 4시간 · ${cell.count}세션`}>{cell.count}</td>)}<td>{grid.rowTotals[index]}</td></tr>)}</tbody>
  </table><p class="pe-muted">0 · 적음 → 많음 · 최댓값 {grid.maxCount} · 전체 {grid.total}세션</p></div>;
}

export function DashboardFlow({ dto, skills }: { readonly dto: FlowDto; readonly skills: readonly SkillEntry[] }) {
  const preview = { ...dto, nodes: dto.nodes.map(node => node.column !== 1 || node.other ? node : {
    ...node, label: skills.find(skill => `s:${skill.uri}` === node.id)?.name ?? skillName(node.label),
  }) };
  return <>{(dto.requestCount ?? dto.sessionCount) > 0
    ? <div role="img" aria-label={`검색 요청 ${dto.requestCount ?? dto.sessionCount}건의 작업 유형·스킬·결과 흐름. 상세 화면에서 경로와 상태를 확인할 수 있습니다.`}><div inert aria-hidden="true"><Sankey dto={preview} hrefFor={() => undefined} onActivate={() => undefined} /></div></div>
    : <p>이 기간에 검색 요청이 없습니다.</p>}
    <p class="pe-muted">검색 요청 {dto.requestCount === undefined ? "미측정 · 세션 단위 원본" : `${dto.requestCount}건`} · 요청의 상태이며 작업 성공률이 아닙니다. 상세 화면에서 탐색합니다.</p></>;
}
