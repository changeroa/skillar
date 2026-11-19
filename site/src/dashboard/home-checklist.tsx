export type ReadState<T> = {
  readonly status: "loading" | "ready" | "failed";
  readonly data: T | null;
  readonly message: string;
  readonly technical: string;
};

type Props = {
  readonly state: "loading" | "failed" | "choose";
  readonly message: string;
  readonly technical: string;
  readonly onRetry: () => void;
  readonly stale?: boolean;
};

// 출처 없음("none") 상태는 오너 결정(ts 1795051070.800359)으로 삭제됐다: 단계 카드·업로드 범위
// 버튼·해제된 기기 접힘을 싣던 온보딩 블록은 보여 주지 않고, 빈 스킬 뷰(SkillsEmpty)가 대신한다.
export function HomeChecklist({ state, message, technical, onRetry, stale = false }: Props) {
  let heading: string;
  switch (state) {
    case "loading": heading = "출처 확인 중"; break;
    case "failed": heading = "출처를 확인할 수 없습니다"; break;
    case "choose": heading = "확인할 출처를 선택하세요"; break;
    default: { const exhaustive: never = state; return exhaustive; }
  }
  return (
    <section className={`dash-empty${state === "loading" || state === "failed" ? " dash-source-picker" : ""}`} aria-labelledby="dash-empty-title">
      <div className="panel__head">
        <h2 id="dash-empty-title" data-state={state} role={state === "loading" ? "status" : undefined}>{heading}</h2>
        {state === "failed" && <button className="button secondary" type="button" onClick={onRetry}>다시 시도</button>}
      </div>
      {stale && (state === "loading" || state === "failed") && <p role="status" data-stale="true">
        마지막으로 확인한 기록을 표시하고 있습니다. 최신 정보가 아닐 수 있습니다.
      </p>}
      {state === "failed" && <>
        <p role="status">{message}</p>
        {message.includes("허용되지") && <p>이 출처를 볼 권한이 없습니다</p>}
        {technical !== "" && <details><summary>기술 정보</summary><code>{technical}</code></details>}
      </>}
      {state === "choose" && <>
        <p>조회할 수 있는 출처에서 '기록 보기'를 선택하면 최근 세션과 검색·읽기 기록이 열립니다.</p>
        <p className="note">아직 기록을 선택하지 않았습니다.</p>
      </>}
      <p className="note">읽기 기록은 작업 성공을 뜻하지 않습니다.</p>
    </section>
  );
}
