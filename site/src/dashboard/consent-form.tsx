import { useState } from "preact/hooks";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import type { ContentKind } from "../../../shared/dist/activity-schema.js";
import { describeFailure, isUnauthorized, writeConsent } from "./api";
import type { ConsentState } from "./api";
import {
  CONTENT_KINDS, CONTENT_KIND_COPY, DEFAULT_RETENTION_DAYS, MAX_BACKUP_DAYS, buildConsent, draftFromConsent, isExactMilliseconds, projectIdFor,
} from "./consent";
import type { BackfillDraft, ConsentDraft, ConsentMode } from "./consent";

type Props = {
  readonly deviceId: string;
  readonly version: number;
  readonly consent: Consent;
  readonly signal: AbortSignal;
  readonly onSaved: (next: ConsentState) => void;
  readonly onUnauthorized: () => void;
};

const MODES: readonly { readonly value: ConsentMode; readonly label: string; readonly detail: string }[] = [
  { value: "local-only", label: "Local only", detail: "The default. Activity stays on the device and nothing is uploaded." },
  { value: "metadata", label: "Metadata only", detail: "Session timing, runtime names and event kinds. No prompts, queries, arguments, paths or skill text." },
  { value: "managed-content", label: "Metadata and selected content", detail: "Adds only the content categories you check below. Reports on this page need all seven." },
];

function NumberField({ label, value, min, max, onInput }: {
  readonly label: string; readonly value: string; readonly min: number; readonly max?: number;
  readonly onInput: (next: string) => void;
}) {
  return (
    <label class="field-label">{label}
      <input class="text-field" type="number" inputMode="numeric" min={min} {...(max === undefined ? {} : { max })}
        value={value} onInput={event => onInput(event.currentTarget.value)} />
    </label>
  );
}

export function ConsentForm({ deviceId, version, consent, signal, onSaved, onUnauthorized }: Props) {
  const [draft, setDraft] = useState<ConsentDraft>(() => draftFromConsent(consent));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<ConsentDraft>) => setDraft(current => ({ ...current, ...next }));
  const patchBackfill = (next: Partial<BackfillDraft>) =>
    setDraft(current => ({ ...current, backfill: { ...current.backfill, ...next } }));
  const toggleKind = (kind: ContentKind, checked: boolean) => setDraft(current => ({
    ...current, kinds: checked ? [...current.kinds.filter(k => k !== kind), kind] : current.kinds.filter(k => k !== kind),
  }));
  const id = (name: string) => `consent-${deviceId}-${name}`;
  const uploads = draft.mode !== "local-only";

  const submit = async (event: Event) => {
    event.preventDefault();
    const built = buildConsent(draft, deviceId, version, Date.now());
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    setMessage("Saving consent\u2026");
    try {
      const saved = await writeConsent(deviceId, version, built.consent, signal);
      setMessage(`Consent saved as version ${saved.version}.`);
      onSaved(saved);
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setMessage(describeFailure(error, "Saving consent"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="consent" onSubmit={submit} aria-describedby={id("scope")}>
      <fieldset class="consent__group">
        <legend>What this device may upload</legend>
        {MODES.map(mode => (
          <label class="choice" key={mode.value}>
            <input type="radio" name={id("mode")} value={mode.value} checked={draft.mode === mode.value}
              onChange={() => patch({ mode: mode.value })} />
            <span><strong>{mode.label}</strong><span class="choice__detail">{mode.detail}</span></span>
          </label>
        ))}
      </fieldset>
      {draft.mode === "managed-content" && (
        <fieldset class="consent__group">
          <legend>Content categories</legend>
          <p class="note">Nothing is preselected. A category is uploaded only if you check it here.</p>
          {CONTENT_KINDS.map(kind => (
            <label class="choice" key={kind}>
              <input type="checkbox" checked={draft.kinds.includes(kind)}
                onChange={event => toggleKind(kind, event.currentTarget.checked)} />
              <span><strong>{CONTENT_KIND_COPY[kind].label}</strong><span class="choice__detail">{CONTENT_KIND_COPY[kind].detail}</span></span>
            </label>
          ))}
          <label class="choice choice--ack">
            <input type="checkbox" checked={draft.serverProcessing}
              onChange={event => patch({ serverProcessing: event.currentTarget.checked })} />
            <span>
              <strong>The skillar server may read and process the checked content to build reports.</strong>
              <span class="choice__detail">Required for any content upload. Content is never transferred to external models.</span>
            </span>
          </label>
        </fieldset>
      )}
      {uploads && (
        <fieldset class="consent__group">
          <legend>Retention</legend>
          <div class="consent__fields">
            <NumberField label="Content retention (days)" value={draft.contentDays} min={1} onInput={contentDays => patch({ contentDays })} />
            <NumberField label="Report retention (days)" value={draft.projectionDays} min={1} onInput={projectionDays => patch({ projectionDays })} />
            <NumberField label={`Backup copies (days, at most ${MAX_BACKUP_DAYS})`} value={draft.backupDays} min={0} max={MAX_BACKUP_DAYS}
              onInput={backupDays => patch({ backupDays })} />
          </div>
          <p class="note">{DEFAULT_RETENTION_DAYS} days is the default. A longer retention keeps data on the server longer; backups never exceed {MAX_BACKUP_DAYS} days.</p>
        </fieldset>
      )}
      {uploads && (
        <details class="consent__history" open={draft.backfill.enabled}>
          <summary>Include a prepared historical snapshot (optional)</summary>
          <p class="note">Run <code>skillar sync prepare</code> on the device and copy the printed snapshot ID and journal cut. Only that exact snapshot, cut and range may be uploaded as history.</p>
          <label class="choice">
            <input type="checkbox" checked={draft.backfill.enabled} onChange={event => patchBackfill({ enabled: event.currentTarget.checked })} />
            <span><strong>Allow one prepared snapshot</strong></span>
          </label>
          {draft.backfill.enabled && (
            <>
              <div class="consent__fields">
              <label class="field-label">Snapshot ID
                <input class="text-field" type="text" autocomplete="off" spellcheck={false} value={draft.backfill.snapshotId}
                  onInput={event => patchBackfill({ snapshotId: event.currentTarget.value })} />
              </label>
              <NumberField label="Journal cut" value={draft.backfill.journalCut} min={0} onInput={journalCut => patchBackfill({ journalCut })} />
              <NumberField label="Manifest version" value={draft.backfill.version} min={1} onInput={backfillVersion => patchBackfill({ version: backfillVersion })} />
              </div>
              <label class="choice">
                <input type="checkbox" checked={draft.backfill.allHistory}
                  onChange={event => patchBackfill({ allHistory: event.currentTarget.checked })} />
                <span><strong>Allow all available history in this prepared snapshot</strong>
                  <span class="choice__detail">Includes every recorded date in this exact snapshot. Leave unchecked to choose a date range.</span>
                </span>
              </label>
              {!draft.backfill.allHistory && <div class="consent__fields">
              <label class="field-label">History from
                <input class="text-field" type={isExactMilliseconds(draft.backfill.from) ? "text" : "datetime-local"} value={draft.backfill.from}
                  onInput={event => patchBackfill({ from: event.currentTarget.value })} />
              </label>
              <label class="field-label">History to
                <input class="text-field" type={isExactMilliseconds(draft.backfill.to) ? "text" : "datetime-local"} value={draft.backfill.to}
                  onInput={event => patchBackfill({ to: event.currentTarget.value })} />
              </label>
              </div>}
            </>
          )}
          {draft.backfill.enabled && !draft.backfill.allHistory && (isExactMilliseconds(draft.backfill.from) || isExactMilliseconds(draft.backfill.to)) && (
            <p class="note">A bound the calendar picker cannot represent exactly is shown as exact milliseconds since 1970 and saved unchanged.</p>
          )}
        </details>
      )}
      <p class="note" id={id("scope")}>
        Scope: this device only ({projectIdFor(deviceId)}), every project, no root restriction. Saving writes consent version {version + 1}, replacing version {version}.
      </p>
      {problems.length > 0 && (
        <ul class="problems" role="alert">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
      )}
      <div class="cluster">
        <button class="button primary" type="submit" disabled={busy}>Save consent</button>
        <span class="note" role="status" aria-live="polite">{message}</span>
      </div>
    </form>
  );
}
