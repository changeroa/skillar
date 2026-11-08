import { useEffect, useState } from "preact/hooks";
import type { CaptureLevel, PrivacySettings } from "../../src/types.js";
import type { LocalApi } from "../api";

const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days (recommended)" },
  { value: "365", label: "1 year" },
  { value: "forever", label: "Forever" },
];

function retentionValue(days: number | null): string {
  return days === null ? "forever" : String(days);
}

export function PrivacyControls({ api, onClose, onHistoryDeleted }: { api: LocalApi; onClose(): void; onHistoryDeleted(): void }) {
  const [current, setCurrent] = useState<PrivacySettings>();
  const [draft, setDraft] = useState<PrivacySettings>();
  const [confirmFull, setConfirmFull] = useState(false);
  const [historyConfirm, setHistoryConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>();

  useEffect(() => {
    let cancelled = false;
    api.privacy().then((settings) => {
      if (!cancelled) {
        setCurrent(settings);
        setDraft(settings);
        setConfirmFull(false);
        setStatus(undefined);
      }
    }, (error: Error) => {
      if (!cancelled) setStatus({ text: error.message, error: true });
    });
    return () => { cancelled = true; };
  }, []);

  const needsFullConfirmation = draft?.captureLevel === "full" && current?.captureLevel !== "full";
  const canSave = draft !== undefined && !saving && (!needsFullConfirmation || confirmFull);

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    setStatus(undefined);
    try {
      const saved = await api.updatePrivacy({ ...draft, ...(needsFullConfirmation ? { confirmFullCapture: true } : {}) });
      setCurrent(saved);
      setDraft(saved);
      setConfirmFull(false);
      setStatus({ text: "Saved. New capture and retention settings are active in this daemon." });
    } catch (error) {
      setStatus({ text: (error as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const deleteHistory = async () => {
    if (historyConfirm !== "DELETE_HISTORY" || deleting) return;
    setDeleting(true);
    setStatus(undefined);
    try {
      const result = await api.deleteHistory();
      onHistoryDeleted();
      setHistoryConfirm("");
      setStatus({ text: `Deleted ${result.deleted.sessions} sessions and ${result.deleted.events} events. Catalog, configuration, and saved eval cases remain.` });
    } catch (error) {
      setStatus({ text: (error as Error).message, error: true });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section class="privacy card" aria-labelledby="privacy-title">
      <header class="privacy__head">
        <h2 id="privacy-title">Privacy controls</h2>
        <p>Changes are saved locally and apply to new daemon events immediately.</p>
      </header>
      {draft && (
        <>
          <div class="privacy__fields">
            <label class="privacy__field">
              Capture level
              <select class="field" value={draft.captureLevel} onChange={(event) => {
                setDraft({ ...draft, captureLevel: (event.currentTarget as HTMLSelectElement).value as CaptureLevel });
                setConfirmFull(false);
              }}>
                <option value="metadata">Metadata only</option>
                <option value="redacted">Redacted text</option>
                <option value="full">Full raw text</option>
              </select>
            </label>
            <label class="privacy__field">
              Retention
              <select class="field" value={retentionValue(draft.retentionDays)} onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                setDraft({ ...draft, retentionDays: value === "forever" ? null : Number(value) });
              }}>
                {!RETENTION_OPTIONS.some((option) => option.value === retentionValue(draft.retentionDays))
                  && <option value={retentionValue(draft.retentionDays)}>{draft.retentionDays} days (current)</option>}
                {RETENTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {needsFullConfirmation && (
            <label class="privacy__confirm">
              <input type="checkbox" checked={confirmFull} onChange={(event) => setConfirmFull((event.currentTarget as HTMLInputElement).checked)} />
              <span>I choose full raw capture and understand that new prompts, searches, and tool arguments can be stored as sent.</span>
            </label>
          )}
          <p class="privacy__note">Retention removes stored text after the selected period; metadata remains for local attribution.</p>
          <div class="privacy__actions">
            <button type="button" class="btn" disabled={!canSave} onClick={() => { void save(); }}>{saving ? "Saving..." : "Save controls"}</button>
            <button type="button" class="btn" onClick={onClose}>Close</button>
          </div>
        </>
      )}
      <details class="privacy__delete">
        <summary>Delete collected history</summary>
        <p>This permanently removes recorded sessions, events, loads, telemetry, links, and reconciliation data. Curated eval cases remain.</p>
        <form onSubmit={(event) => { event.preventDefault(); void deleteHistory(); }}>
          <label class="privacy__field">
            Type DELETE_HISTORY to confirm
            <input class="field" value={historyConfirm} onInput={(event) => setHistoryConfirm((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <div class="privacy__actions">
            <button type="submit" class="btn" disabled={historyConfirm !== "DELETE_HISTORY" || deleting}>{deleting ? "Deleting..." : "Delete history"}</button>
          </div>
        </form>
      </details>
      {status && <p class={`privacy__status${status.error ? " privacy__status--error" : ""}`} role={status.error ? "alert" : "status"}>{status.text}</p>}
    </section>
  );
}
