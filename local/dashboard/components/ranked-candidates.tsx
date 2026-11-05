import { chosenUris, formatScore, INVOCATION_LABEL, orderCandidates, type CandidatesProps } from "./candidates";

export function RankedCandidates({ candidates, chosen }: CandidatesProps) {
  if (!candidates.length) return <p class="cands__none">반환된 후보가 없습니다.</p>;
  const read = chosenUris(candidates, chosen);
  return <table class="ranked-candidates">
    <caption class="sr-only">검색 후보. 이후 읽음은 실제 읽기 기록이며 작업 성공을 뜻하지 않습니다.</caption>
    <thead><tr><th scope="col">순위</th><th scope="col">후보</th><th scope="col">점수</th><th scope="col">방식</th><th scope="col">이후 읽음</th></tr></thead>
    <tbody>{orderCandidates(candidates).map(candidate => <tr key={candidate.uri} class="cand" data-uri={candidate.uri}
      data-score={formatScore(candidate.score)} data-chosen={read.has(candidate.uri) ? "true" : "false"}>
      <td>{candidate.rank}</td>
      <td><details class="cand__desc"><summary><code class="cand__nm">{candidate.name}</code></summary>
        <p>{candidate.name}</p><code>{candidate.uri}</code><p>{candidate.description}</p>
        {candidate.matched?.length ? <p class="cand__matched">일치 단어 <code>{candidate.matched.join(", ")}</code></p> : null}
      </details></td>
      <td>{formatScore(candidate.score)}</td><td>{INVOCATION_LABEL[candidate.invocation]}</td>
      <td>{read.has(candidate.uri) ? <span class="pe-pill">읽음</span> : "—"}</td>
    </tr>)}</tbody>
  </table>;
}
