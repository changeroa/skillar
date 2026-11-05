import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import { createGrant, describeFailure, isUnauthorized, revokeDevice, writeConsent } from "./api";
import type { DeviceGrant } from "./api";
import { describeConsent } from "./consent";
import { ConsentForm } from "./consent-form";
import { connectSteps, downloadTextFile, grantFileName, grantFileText } from "./grant";
import { formatSeconds, shortId } from "./status";

export type DeviceState = {
  readonly deviceId: string; readonly createdAt: number; readonly revokedAt: number | null;
  readonly version: number; readonly consent: Consent;
};
type Common = {
  readonly signal: AbortSignal;
  readonly onChanged: () => void;
  readonly onUnauthorized: () => void;
};
const LOCAL_ONLY: Consent = { mode: "local-only" };

function ConnectDevice({ origin, signal, onChanged, onUnauthorized }: Common & { readonly origin: string }) {
  const [grant, setGrant] = useState<DeviceGrant | null>(null);
  const [allowPrivateSkills, setAllowPrivateSkills] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    setMessage("기기 연결 승인을 만드는 중\u2026");
    try {
      const created = await createGrant(signal, allowPrivateSkills);
      setGrant(created);
      setAllowPrivateSkills(false);
      setMessage("");
      onChanged();
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setMessage(describeFailure(error, "기기 연결 승인 생성"));
    } finally {
      setBusy(false);
    }
  };
  if (grant === null) {
    return (
      <div class="connect">
        <p>기기를 연결하면 skillar CLI용 일회성 연결 승인이 만들어집니다. 해당 기기의 동의를 저장하기 전까지 활동은 로컬 전용으로 남습니다. 비공개 스킬 권한은 별도입니다.</p>
        <label class="choice">
          <input type="checkbox" checked={allowPrivateSkills} disabled={busy}
            onChange={event => setAllowPrivateSkills(event.currentTarget.checked)} />
          <span>
            <strong>이 기기가 내 비공개 스킬을 읽고 게시하는 것도 허용합니다.</strong>
            <span class="choice__detail">선택 사항입니다. 허용해도 비공개 스킬을 업로드하려면 CLI에서 명시적으로 실행해야 합니다.</span>
          </span>
        </label>
        <div class="cluster">
          <button class="button primary" type="button" onClick={connect} disabled={busy}>기기 연결</button>
          <span class="note" role="status" aria-live="polite">{message}</span>
        </div>
      </div>
    );
  }
  const fileName = grantFileName(grant.deviceId);
  return (
    <div class="connect">
      <h3>기기 <span class="device-id">{shortId(grant.deviceId)}</span> 연결 준비가 끝났습니다.</h3>
      <p>지금 연결 승인 파일을 내려받으세요. 이 파일은 한 번만 제공되고 한 번만 쓸 수 있으며 {formatSeconds(grant.expiresAt)}에 만료됩니다. 이 브라우저에는 사본이 남지 않습니다.</p>
      <div class="cluster">
        <button class="button primary" type="button" onClick={() => downloadTextFile(fileName, grantFileText(grant.grant))}>{fileName} 내려받기</button>
        <button class="button secondary" type="button" onClick={() => {
          if (confirm("닫으면 이 일회성 연결 승인 파일을 다시 내려받을 수 없습니다. 필요한 파일을 보관했나요?")) setGrant(null);
        }}>완료</button>
      </div>
      <ol class="steps-list">
        {connectSteps(fileName, origin).map(step => (
          <li key={step.text}>
            <p>{step.text}</p>
            {step.command !== undefined && <pre class="command"><code>{step.command}</code></pre>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DeviceCard({ device, ingestEnabled, signal, onChanged, onUnauthorized }: Common & {
  readonly device: DeviceState; readonly ingestEnabled: boolean;
}) {
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const keepButton = useRef<HTMLButtonElement | null>(null);
  const revokeButton = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!confirming) return;
    keepButton.current?.focus();
    return () => revokeButton.current?.focus();
  }, [confirming]);
  const revoked = device.revokedAt !== null;
  const titleId = `device-${device.deviceId}`;
  const run = async (action: string, task: () => Promise<void>) => {
    setBusy(true);
    setMessage(`${action} 중\u2026`);
    try {
      await task();
      setMessage("");
      onChanged();
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setMessage(describeFailure(error, action));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const withdraw = () => run("동의 철회", async () => {
    await writeConsent(device.deviceId, device.version, LOCAL_ONLY, signal);
  });
  const revoke = () => run("기기 연결 해제", () => revokeDevice(device.deviceId, signal));
  return (
    <article class="device" aria-labelledby={titleId}>
      <h3 id={titleId}>기기 <span class="device-id">{shortId(device.deviceId)}</span></h3>
      <dl class="account-status device__facts">
        <div><dt>연결 시각</dt><dd>{formatSeconds(device.createdAt)}</dd></div>
        <div><dt>상태</dt><dd>{revoked ? `${formatSeconds(device.revokedAt)} 연결 해제됨` : "활성"}</dd></div>
        <div><dt>동의</dt><dd>{describeConsent(device.consent)}{revoked ? "" : ` 버전 ${device.version}.`}</dd></div>
      </dl>
      {!revoked && !ingestEnabled && (
        <p class="note">지금은 서버에서 업로드가 꺼져 있습니다. 동의는 저장되지만 다시 켜지기 전까지는 아무것도 업로드되지 않습니다.</p>
      )}
      {!revoked && (
        <details class="device__consent">
          <summary>{device.consent.mode === "local-only" ? "업로드 동의 설정" : "업로드 동의 변경"}</summary>
          <ConsentForm key={device.version} deviceId={device.deviceId} version={device.version} consent={device.consent}
            signal={signal} onUnauthorized={onUnauthorized}
            onSaved={saved => {
              setMessage(`동의를 저장했습니다 (버전 ${saved.version}).`);
              onChanged();
            }} />
        </details>
      )}
      {!revoked && (
        <div class="cluster device__actions">
          {device.consent.mode !== "local-only" && (
            <button class="button secondary" type="button" disabled={busy} onClick={withdraw}>동의 철회</button>
          )}
          {confirming ? (
            <>
              <button class="button primary" type="button" disabled={busy} onClick={revoke}>연결 해제 확인</button>
              <button ref={keepButton} class="button secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>기기 유지</button>
              <span class="note">연결을 해제하면 업로드가 멈추고 기기의 토큰이 만료됩니다. 되돌릴 수 없습니다.</span>
            </>
          ) : (
            <button ref={revokeButton} class="button secondary" type="button" disabled={busy} onClick={() => setConfirming(true)}>기기 연결 해제{"\u2026"}</button>
          )}
          <span class="note" role="status" aria-live="polite">{message}</span>
        </div>
      )}
    </article>
  );
}

export function DevicesSection({ devices, ingestEnabled, origin, settled, message, ...common }: Common & {
  readonly devices: readonly DeviceState[]; readonly ingestEnabled: boolean; readonly origin: string;
  readonly settled: boolean; readonly message: string;
}) {
  return (
    <section class="panel" aria-labelledby="devices-title">
      <h2 id="devices-title">기기와 동의</h2>
      <p class="account-lead">각 기기는 일회성 연결 승인으로 연결되며 로컬 전용으로 시작합니다. 업로드는 여기에서 해당 기기의 동의를 저장한 뒤에만 시작됩니다. 동의 철회와 기기 연결 해제는 별개의 작업입니다.</p>
      <ConnectDevice origin={origin} {...common} />
      {message !== "" && <p class="note" role="status">{message}</p>}
      {devices.length === 0 ? (
        settled && <p class="note">이 계정에 연결된 기기가 아직 없습니다.</p>
      ) : (
        <div class="device-list">
          {devices.map(device => <DeviceCard key={device.deviceId} device={device} ingestEnabled={ingestEnabled} {...common} />)}
        </div>
      )}
    </section>
  );
}
