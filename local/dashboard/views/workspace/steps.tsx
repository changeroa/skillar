import type { FlowComparison, StepComparison } from "../../../src/workflow/compare.js";
import type { WorkflowSpec } from "../../../src/workflow/spec.js";
import { STEP_STATUS_LABEL, STEP_STATUS_TITLE } from "../../state";

export function StepRow({ step, specStep, uncertain = false }: { step: StepComparison; specStep?: WorkflowSpec["steps"][number]; uncertain?: boolean }) {
  const used = new Set(step.usedSkills);
  const intended = new Set(step.intendedSkills);
  const attributionUncertain = uncertain && step.panes.length > 0;
  return (
    <li class="step" data-step={step.stepId} data-status={step.status}>
      <div class="step__head">
        <span class="step__id">{step.stepId}</span>
        <span class="tag" data-skill-mode={specStep ? specStep.together ? "together" : "alternatives" : "unknown"}>
          {specStep ? specStep.together ? "함께 (모두 필요)" : "택일 (하나면 충분)" : "스킬 매칭 방식 알 수 없음"}
        </span>
        {attributionUncertain && step.status !== "matched"
          ? <span class="tag" data-step-attribution="uncertain">세션 연결 미확정</span>
          : <span class={`badge badge--${step.status}`} title={STEP_STATUS_TITLE[step.status]}>{STEP_STATUS_LABEL[step.status]}</span>}
        <span class="dim">{step.panes.length === 0 ? "연결된 패널 없음" : step.panes.join(", ")}</span>
      </div>
      <div class="step__row">
        <span class="step__k">계획한 스킬</span>
        <span class="step__v">
          {step.intendedSkills.length === 0
            ? <span class="dim">없음</span>
            : step.intendedSkills.map((name) => (
              <span key={name} class={used.has(name) ? "skill" : "skill skill--missing"} title={used.has(name) ? "이 단계에서 사용됨" : "이 단계에 연결된 사용 기록 없음"}>{name}</span>
            ))}
        </span>
      </div>
      <div class="step__row">
        <span class="step__k">{attributionUncertain ? "연결된 사용 기록" : "사용한 스킬"}</span>
        <span class="step__v">
          {step.usedSkills.length === 0
            ? <span class="dim">{attributionUncertain ? "알 수 없음" : "없음"}</span>
            : step.usedSkills.map((name) => (
              <span key={name} class="skill" title={intended.has(name) ? "이 단계에서 계획한 스킬" : "이 단계에서 계획하지 않은 스킬"}>
                {name}
                {!intended.has(name) && <span class="skill__tag">계획 외</span>}
              </span>
            ))}
        </span>
      </div>
      {step.unexpectedTools.length > 0 && (
        <p class="dim step__tools">단계 목록에 없는 도구: {step.unexpectedTools.join(", ")}</p>
      )}
    </li>
  );
}

export function Steps({ comparison, specSteps, specError, uncertain }: { comparison: FlowComparison; specSteps: WorkflowSpec["steps"]; specError: string | undefined; uncertain: boolean }) {
  return (
    <section class="card ws__block" aria-labelledby="ws-steps">
      <h2 class="ws__h" id="ws-steps">단계</h2>
      {specError && <p class="notice" role="alert">단계별 스킬 매칭 방식을 읽을 수 없습니다: {specError}</p>}
      <ol class="wssteps">
        {comparison.steps.map((step) => <StepRow key={step.stepId} step={step} specStep={specSteps.find((item) => item.id === step.stepId)} uncertain={uncertain} />)}
      </ol>
      {comparison.unplanned.length > 0 && (
        <p class="dim">
          스펙에 없는 패널: {comparison.unplanned.map((pane) => `${pane.paneId}${pane.usedSkills.length ? ` (${pane.usedSkills.join(", ")})` : ""}`).join(", ")}
        </p>
      )}
    </section>
  );
}
