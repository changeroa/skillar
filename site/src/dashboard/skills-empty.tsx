// 출처가 없을 때 세션 화면에 보여 주는 빈 스킬 뷰.
// 오너 결정(ts 1795051070.800359): 출처 없음 온보딩 블록(단계 카드·업로드 범위 버튼·해제된 기기
// 접힘)은 삭제하고 같은 Skills 뷰의 빈 상태만 보여 준다. 업로드 동의 안내는 연결 화면에 있으므로
// 여기서는 반복하지 않는다. 측정 자체가 없으므로 KPI는 0이 아니라 미측정(공통 Metric의 null 표현)이다.
import { AnalysisWidget, Metric } from "../../../local/dashboard/components/analysis";

export function SkillsEmpty() {
  return <section className="analysis pe-console" data-analysis-dashboard aria-label="스킬">
    <header className="page-title"><h2>스킬</h2></header>
    <div className="analysis-tiles">
      <Metric label="세션" value={null} icon="clock" />
      <Metric label="검색 요청" value={null} icon="search" />
      <Metric label="읽기 요청" value={null} icon="book-open" />
    </div>
    <AnalysisWidget title="많이 읽힌 스킬" id="top-skills" wide>
      <p className="pe-muted" role="status">데이터 없음 · 연결된 실행 환경에서 세션이 도착하면 스킬별 읽기 기록이 여기에 표시됩니다.</p>
    </AnalysisWidget>
  </section>;
}
