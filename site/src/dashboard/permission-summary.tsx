import type { Consent } from "../../../shared/dist/activity-consent.js";
import type { DeviceState } from "./devices";
import type { ReadState } from "./home-checklist";
import { CONTENT_KIND_COPY } from "./consent";
import { shortId } from "./status";
import { readConsent, readDevices } from "./api";

export async function loadDevices(signal: AbortSignal): Promise<readonly DeviceState[]> {
  const devices = await readDevices(signal);
  const states = await Promise.all(devices.map(async (device): Promise<DeviceState> => {
    if (device.revokedAt !== null) return { ...device, version: 0, consent: { mode: "local-only" } };
    const state = await readConsent(device.deviceId, signal);
    return { ...device, version: state.version, consent: state.consent };
  }));
  return states.sort((a, b) => b.createdAt - a.createdAt);
}

function ConsentFacts({ consent, revoked }: { readonly consent: Consent; readonly revoked: boolean }) {
  let recording: string;
  let processing: string;
  let history: string;
  switch (consent.mode) {
    case "local-only":
      recording = "로컬 전용 · 업로드 동의 없음";
      processing = "허용하지 않음";
      history = "허용하지 않음";
      break;
    case "metadata":
      recording = "메타데이터만";
      processing = "메타데이터 처리만 · 내용 처리 동의 없음";
      history = consent.backfill === undefined ? "허용하지 않음" : `동의한 스냅샷만 · ${consent.backfill.snapshotId}`;
      break;
    case "managed-content":
      recording = consent.contentKinds.map(kind => CONTENT_KIND_COPY[kind].label).join(", ");
      processing = consent.serverProcessingAcknowledged ? "선택한 내용의 서버 처리 허용 · 외부 모델 전송 없음" : "허용하지 않음";
      history = consent.backfill === undefined ? "허용하지 않음" : `동의한 스냅샷만 · ${consent.backfill.snapshotId}`;
      break;
    default: { const exhaustive: never = consent; return exhaustive; }
  }
  return <dl class="account-status dash-permission-facts">
    <div><dt>읽기</dt><dd>{revoked ? "기기 연결 철회됨" : "기기 연결은 업로드 동의가 아닙니다. 비공개 스킬 읽기 권한은 이 동의 응답에 포함되지 않습니다."}</dd></div>
    <div><dt>기록</dt><dd>{revoked ? "새 업로드 불가" : recording}</dd></div>
    <div><dt>서버 처리</dt><dd>{revoked ? "새 업로드 불가" : processing}</dd></div>
    <div><dt>과거 데이터</dt><dd>{revoked ? "새 업로드 불가" : history}</dd></div>
    <div><dt>철회</dt><dd>{revoked ? "기기 연결 철회됨 · 기존 기록 삭제와는 별개" : "기기 관리에서 기록 동의를 로컬 전용으로 바꾸거나 기기 연결을 철회할 수 있습니다. 기존 기록 삭제와는 별개입니다."}</dd></div>
  </dl>;
}

export function PermissionSummary({ devices, onRetry }: {
  readonly devices: ReadState<readonly DeviceState[]>;
  readonly onRetry: () => void;
}) {
  return <section class="dash-permissions" aria-labelledby="dash-permissions-title">
    <h2 id="dash-permissions-title">권한 요약</h2>
    <p class="note">저장된 기기별 동의만 표시합니다. 연결 상태로 동의를 추정하지 않으며 여기서는 권한을 바꾸지 않습니다.</p>
    {devices.status === "loading" ? <p role="status">권한 확인 중</p> :
      devices.status === "failed" ? <>
        <p role="alert">{devices.message}</p>
        {devices.technical !== "" && <details><summary>기술 정보</summary><code>{devices.technical}</code></details>}
        <button class="button secondary" type="button" onClick={onRetry}>다시 시도</button>
      </> : devices.data?.length === 0 ? <p>연결된 기기가 없습니다. 읽기·기록·서버 처리·과거 데이터 권한을 확인할 기기가 아직 없습니다.</p> :
        <ul class="dash-permission-list">{devices.data?.map(device => <li key={device.deviceId}>
          <h3>기기 <code title={device.deviceId}>{shortId(device.deviceId)}</code></h3>
          <ConsentFacts consent={device.consent} revoked={device.revokedAt !== null} />
        </li>)}</ul>}
  </section>;
}
