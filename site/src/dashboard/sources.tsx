import type { ComponentChildren } from "preact";
import type { DashboardProfile, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import { availabilityCopy, formatWhen, profileKey, shortId, snapshotLines } from "./status";
import type { RequestFailure } from "./status";

type SourcesProps = {
  readonly profiles: readonly DashboardProfile[];
  readonly selectedKey: string | null;
  readonly busy: boolean;
  readonly message: string;
  readonly onSelect: (profile: DashboardProfile) => void;
  readonly onReload: () => void;
};

export function SourcesSection({ profiles, selectedKey, busy, message, onSelect, onReload }: SourcesProps) {
  return (
    <section class="panel" aria-labelledby="sources-title">
      <div class="panel__head">
        <h2 id="sources-title">Sources</h2>
        <button class="button secondary" type="button" onClick={onReload} disabled={busy}>Reload sources</button>
      </div>
      <p class="account-lead">A source is one device's local database. Only a source whose newest upload has been processed can be shown, and you choose which one.</p>
      {message !== "" && <p class="note" role="status" aria-live="polite">{message}</p>}
      {profiles.length === 0 && !busy && message === "" && (
        <p>No source has uploaded yet. Connect a device and save its consent below to add one.</p>
      )}
      <ul class="source-list">
        {profiles.map(profile => {
          const copy = availabilityCopy(profile.availability);
          const key = profileKey(profile);
          const current = key === selectedKey;
          return (
            <li class="source" key={key} aria-current={current ? "true" : undefined}>
              <div class="source__head">
                <h3>Device <span class="device-id">{shortId(profile.deviceId)}</span></h3>
                <span class="source__state">{copy.label}</span>
              </div>
              <dl class="account-status source__facts">
                <div><dt>Source</dt><dd><code>{profile.sourceDomain}</code></dd></div>
                <div><dt>Captured</dt><dd>{formatWhen(profile.capturedAtMs)}</dd></div>
                <div><dt>Received</dt><dd>{formatWhen(profile.receivedAtMs)}</dd></div>
                <div><dt>Revision</dt><dd>{profile.sourceSequence} / journal {profile.journalThrough} / runtime {profile.runtimeSequence ?? "none"}</dd></div>
              </dl>
              <p class="note">{copy.explanation}{copy.next === null ? "" : ` ${copy.next}`}</p>
              {copy.selectable && (
                <button class="button secondary" type="button" aria-pressed={current} onClick={() => onSelect(profile)}>
                  {current ? "Showing this snapshot" : "Show snapshot"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SnapshotProps = {
  readonly profile: DashboardProfile;
  readonly report: DashboardReportStatus | null;
  readonly failure: RequestFailure | null;
  readonly onRebuild: () => void;
  readonly onClose: () => void;
  readonly commands: ComponentChildren;
  readonly children: ComponentChildren;
};

export function SnapshotSection({ profile, report, failure, onRebuild, onClose, commands, children }: SnapshotProps) {
  return (
    <section class="panel snapshot" aria-labelledby="snapshot-title">
      <div class="panel__head">
        <h2 id="snapshot-title">Snapshot of device <span class="device-id">{shortId(profile.deviceId)}</span></h2>
        <div class="cluster">
          <button class="button secondary" type="button" onClick={onRebuild}>Rebuild reports</button>
          <button class="button secondary" type="button" onClick={onClose}>Close snapshot</button>
        </div>
      </div>
      <p class="note">Reports refresh when new uploads arrive. Capture and report times show freshness; a live connection does not mean the source device is running.</p>
      <dl class="account-status snapshot__facts" aria-live="polite">
        {snapshotLines(profile, report, failure).map(line => (
          <div key={line.term} {...(line.tone === undefined ? {} : { "data-tone": line.tone })}>
            <dt>{line.term}</dt><dd>{line.detail}{line.technical !== undefined && (
              <details><summary>Technical details</summary><code>{line.technical}</code></details>
            )}</dd>
          </div>
        ))}
      </dl>
      {commands}
      <div class="dash-embed">{children}</div>
    </section>
  );
}
