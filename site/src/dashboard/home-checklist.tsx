import type { DashboardProfile } from "../../../shared/dist/activity-dashboard.js";
import type { DeviceState } from "./devices";

export type ReadState<T> = {
  readonly status: "loading" | "ready" | "failed";
  readonly data: T | null;
  readonly message: string;
  readonly technical: string;
};

type Props = {
  readonly state: "loading" | "failed" | "none" | "choose";
  readonly message: string;
  readonly technical: string;
  readonly profiles: readonly DashboardProfile[];
  readonly devices: ReadState<readonly DeviceState[]>;
  readonly onRetry: () => void;
  readonly onManage: () => void;
};

export function HomeChecklist({ state, message, technical, profiles, devices, onRetry, onManage }: Props) {
  let heading: string;
  switch (state) {
    case "loading": heading = "출처 확인 중"; break;
    case "failed": heading = "출처를 확인할 수 없습니다"; break;
    case "none": heading = "조회할 수 있는 출처가 없습니다"; break;
    case "choose": heading = "확인할 출처를 선택하세요"; break;
    default: { const exhaustive: never = state; return exhaustive; }
  }
  const active = (devices.data ?? []).filter(device => device.revokedAt === null);
  const received = profiles.some(profile => profile.receivedAtMs !== null);
  const granted = active.some(device => device.consent.mode !== "local-only");
  const deviceStatus = devices.status === "failed" ? "failed" : devices.status === "ready" && active.length > 0 ? "done" : "pending";
  const consentStatus = devices.status === "failed" ? "failed" : devices.status === "ready" && granted ? "done" : "pending";
  const steps = [
    { title: "기기 연결", status: deviceStatus, detail: devices.status === "loading" ? "기기 상태 확인 중" :
      devices.status === "failed" ? devices.message : active.length > 0 ? "연결된 기기가 있습니다. 기록 동의와는 별개입니다." : "기기 연결 안내에서 CLI용 연결 승인을 만드세요." },
    { title: "기록 동의", status: consentStatus, detail: devices.status === "loading" ? "저장된 동의 확인 중" :
      devices.status === "failed" ? "동의를 확인하지 못했습니다. 다시 시도하세요." : granted ? "저장된 업로드 동의가 있습니다. 아래 권한 요약에서 범위를 확인하세요." : "연결만으로 기록되지 않습니다. 기기 관리에서 업로드할 범위를 직접 선택하세요." },
    { title: "첫 세션 수신", status: received ? "done" : "pending", detail: received ?
      "출처 업로드를 수신했습니다. 조회 가능한 출처를 직접 선택해 세션을 확인하세요." : "아직 출처 업로드를 수신하지 못했습니다. 동의 후 CLI 동기화를 실행하고 다시 확인하세요." },
  ];
  return (
    <section class={`dash-empty${state === "loading" || state === "failed" ? " dash-source-picker" : ""}`} aria-labelledby="dash-empty-title">
      <div class="panel__head">
        <h2 id="dash-empty-title" data-state={state} role={state === "loading" ? "status" : undefined}>{heading}</h2>
        {state === "failed" && <button class="button secondary" type="button" onClick={onRetry}>다시 시도</button>}
      </div>
      {state === "failed" && <>
        <p role="status">{message}</p>
        {message.includes("허용되지") && <p>이 출처를 볼 권한이 없습니다</p>}
        {technical !== "" && <details><summary>기술 정보</summary><code>{technical}</code></details>}
      </>}
      {state === "choose" && <>
        <p>조회할 수 있는 출처에서 '기록 보기'를 선택하면 최근 세션과 검색·읽기 기록이 열립니다.</p>
        <p class="note">아직 기록을 선택하지 않았습니다.</p>
      </>}
      {state === "none" && <>
        <p>기기 연결부터 첫 기록 확인까지 진행하세요. 기기 연결과 기록 업로드 동의는 별개입니다.</p>
        <ol class="dash-checklist" aria-label="첫 기록 확인 단계">
          {steps.map(step => <li key={step.title} data-state={step.status}>
            <div class="source__head"><h3>{step.title}</h3><span class="source__state">
              {step.status === "done" ? "완료" : step.status === "failed" ? "확인 실패" : "대기"}
            </span></div>
            <p class="note">{step.detail}</p>
          </li>)}
        </ol>
        {devices.status === "failed" && <button class="button secondary" type="button" onClick={onRetry}>다시 시도</button>}
        <div class="cluster">
          <a class="button primary" href="#dashboard-management" onClick={onManage}>기기 연결 안내</a>
          <a class="button secondary" href="/#local-setup">로컬 설정 안내</a>
          <button class="button secondary" type="button" onClick={onRetry}>출처 다시 읽기</button>
        </div>
      </>}
      <p class="note">읽기 기록은 작업 성공을 뜻하지 않습니다.</p>
    </section>
  );
}
