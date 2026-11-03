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
    setMessage("Creating a device grant\u2026");
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
      setMessage(describeFailure(error, "Creating a device grant"));
    } finally {
      setBusy(false);
    }
  };
  if (grant === null) {
    return (
      <div class="connect">
        <p>Connecting a device creates a one-time grant for the skillar CLI. Activity stays local-only until you save consent for that device. Private skill permissions are separate.</p>
        <label class="choice">
          <input type="checkbox" checked={allowPrivateSkills} disabled={busy}
            onChange={event => setAllowPrivateSkills(event.currentTarget.checked)} />
          <span>
            <strong>Also allow this device to read and publish my private skills.</strong>
            <span class="choice__detail">Optional. Private skill upload still requires an explicit CLI action.</span>
          </span>
        </label>
        <div class="cluster">
          <button class="button primary" type="button" onClick={connect} disabled={busy}>Connect a device</button>
          <span class="note" role="status" aria-live="polite">{message}</span>
        </div>
      </div>
    );
  }
  const fileName = grantFileName(grant.deviceId);
  return (
    <div class="connect">
      <h3>Device <span class="device-id">{shortId(grant.deviceId)}</span> is ready to connect.</h3>
      <p>Download its grant file now. The file is offered once, works once, and expires at {formatSeconds(grant.expiresAt)}. This browser keeps no copy.</p>
      <div class="cluster">
        <button class="button primary" type="button" onClick={() => downloadTextFile(fileName, grantFileText(grant.grant))}>Download {fileName}</button>
        <button class="button secondary" type="button" onClick={() => setGrant(null)}>Done</button>
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
    setMessage(`${action}\u2026`);
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
  const withdraw = () => run("Withdrawing consent", async () => {
    await writeConsent(device.deviceId, device.version, LOCAL_ONLY, signal);
  });
  const revoke = () => run("Revoking the device", () => revokeDevice(device.deviceId, signal));
  return (
    <article class="device" aria-labelledby={titleId}>
      <h3 id={titleId}>Device <span class="device-id">{shortId(device.deviceId)}</span></h3>
      <dl class="account-status device__facts">
        <div><dt>Connected</dt><dd>{formatSeconds(device.createdAt)}</dd></div>
        <div><dt>Status</dt><dd>{revoked ? `Revoked ${formatSeconds(device.revokedAt)}` : "Active"}</dd></div>
        <div><dt>Consent</dt><dd>{describeConsent(device.consent)}{revoked ? "" : ` Version ${device.version}.`}</dd></div>
      </dl>
      {!revoked && !ingestEnabled && (
        <p class="note">Uploads are switched off on the server right now. Consent is saved, but nothing is uploaded until they are switched on again.</p>
      )}
      {!revoked && (
        <details class="device__consent">
          <summary>{device.consent.mode === "local-only" ? "Set upload consent" : "Change upload consent"}</summary>
          <ConsentForm key={device.version} deviceId={device.deviceId} version={device.version} consent={device.consent}
            signal={signal} onUnauthorized={onUnauthorized}
            onSaved={saved => {
              setMessage(`Consent saved as version ${saved.version}.`);
              onChanged();
            }} />
        </details>
      )}
      {!revoked && (
        <div class="cluster device__actions">
          {device.consent.mode !== "local-only" && (
            <button class="button secondary" type="button" disabled={busy} onClick={withdraw}>Withdraw consent</button>
          )}
          {confirming ? (
            <>
              <button class="button primary" type="button" disabled={busy} onClick={revoke}>Confirm revoke</button>
              <button ref={keepButton} class="button secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep device</button>
              <span class="note">Revoking stops uploads and ends the device's tokens. It cannot be undone.</span>
            </>
          ) : (
            <button ref={revokeButton} class="button secondary" type="button" disabled={busy} onClick={() => setConfirming(true)}>Revoke device{"\u2026"}</button>
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
      <h2 id="devices-title">Devices and consent</h2>
      <p class="account-lead">Each device connects with a one-time grant and starts local only. Uploads begin only after you save consent for that device here. Withdrawing consent and revoking a device are separate actions.</p>
      <ConnectDevice origin={origin} {...common} />
      {message !== "" && <p class="note" role="status">{message}</p>}
      {devices.length === 0 ? (
        settled && <p class="note">No device is connected to this account yet.</p>
      ) : (
        <div class="device-list">
          {devices.map(device => <DeviceCard key={device.deviceId} device={device} ingestEnabled={ingestEnabled} {...common} />)}
        </div>
      )}
    </section>
  );
}
