import { useEffect, useRef, useState } from "preact/hooks";
import type { DashboardProfile } from "../../../shared/dist/activity-dashboard.js";
import { DashboardRequestError, describeFailure, isUnauthorized, readCommandStatus, submitCommand } from "./api";
import {
  CHECK_COPY, COMMAND_KINDS, COMMAND_KIND_COPY, ENABLE_COMMANDS_CLI, FIELD_LABELS, SYNC_CADENCE_SECONDS,
  buildOperation, checkFailed, checked, classifyFailure, commandRequest, describeOutcome, draftFromOperation, emptyCommandDraft,
  fromStatus, isCommandId, newSubmission, nextActions, resultEntries, sending, statusRequest, submitFailed, submitted, summarizeOperation,
} from "./commands";
import type { CommandDraft, Submission } from "./commands";
import { shortId } from "./status";

type Props = {
  readonly profile: DashboardProfile;
  readonly sourcesBusy: boolean;
  readonly sourcesLoad: number;
  readonly signal: AbortSignal;
  readonly onRefreshSources: () => void;
  readonly onUnauthorized: () => void;
};

type Patch = (next: Partial<CommandDraft>) => void;

function TextField({ label, value, numeric = false, onInput }: {
  readonly label: string; readonly value: string; readonly numeric?: boolean; readonly onInput: (next: string) => void;
}) {
  return (
    <label class="field-label">{label}
      <input class="text-field" type="text" autocomplete="off" spellcheck={false} {...(numeric ? { inputMode: "numeric" as const } : {})}
        value={value} onInput={event => onInput(event.currentTarget.value)} />
    </label>
  );
}

function TextArea({ label, value, onInput }: { readonly label: string; readonly value: string; readonly onInput: (next: string) => void }) {
  return (
    <label class="field-label">{label}
      <textarea class="document-field document-field--short" spellcheck={false} value={value}
        onInput={event => onInput(event.currentTarget.value)} />
    </label>
  );
}

function KindFields({ draft, patch }: { readonly draft: CommandDraft; readonly patch: Patch }) {
  switch (draft.kind) {
    case "workflow.put":
      return (
        <>
          <div class="command-form__fields">
            <TextField label={FIELD_LABELS.workflowName} value={draft.workflowName} onInput={workflowName => patch({ workflowName })} />
          </div>
          <TextArea label={FIELD_LABELS.workflowSteps} value={draft.workflowSteps} onInput={workflowSteps => patch({ workflowSteps })} />
          <p class="note">
            Each step needs an <code>id</code> and a <code>skills</code> list; <code>together</code>, <code>expectTools</code> and <code>doneWhen</code> are optional.
            Up to 50 steps with unique ids, for example <code>{"[{\"id\":\"plan\",\"skills\":[\"skillar/plan\"]}]"}</code>.
          </p>
        </>
      );
    case "flow.create":
      return (
        <div class="command-form__fields">
          <TextField label={FIELD_LABELS.workspaceId} value={draft.workspaceId} onInput={workspaceId => patch({ workspaceId })} />
          <TextField label={FIELD_LABELS.tabId} value={draft.tabId} onInput={tabId => patch({ tabId })} />
          <TextField label={FIELD_LABELS.flowName} value={draft.flowName} onInput={flowName => patch({ flowName })} />
          <TextField label={FIELD_LABELS.flowVersion} value={draft.flowVersion} numeric onInput={flowVersion => patch({ flowVersion })} />
          <TextField label={FIELD_LABELS.label} value={draft.label} onInput={label => patch({ label })} />
        </div>
      );
    case "flow.map-step":
      return (
        <div class="command-form__fields">
          <TextField label={FIELD_LABELS.flowId} value={draft.flowId} onInput={flowId => patch({ flowId })} />
          <TextField label={FIELD_LABELS.paneId} value={draft.paneId} onInput={paneId => patch({ paneId })} />
          <TextField label={FIELD_LABELS.stepId} value={draft.stepId} onInput={stepId => patch({ stepId })} />
        </div>
      );
    case "flow.end":
      return (
        <div class="command-form__fields">
          <TextField label={FIELD_LABELS.flowId} value={draft.flowId} onInput={flowId => patch({ flowId })} />
        </div>
      );
    case "eval.add":
      return (
        <>
          <TextArea label={FIELD_LABELS.query} value={draft.query} onInput={query => patch({ query })} />
          <div class="command-form__fields">
            <TextField label={FIELD_LABELS.expectedUri} value={draft.expectedUri} onInput={expectedUri => patch({ expectedUri })} />
            <TextField label={FIELD_LABELS.fromTraceId} value={draft.fromTraceId} onInput={fromTraceId => patch({ fromTraceId })} />
          </div>
        </>
      );
    default: {
      const exhaustive: never = draft.kind;
      return exhaustive;
    }
  }
}

type ItemProps = {
  readonly submission: Submission;
  readonly busy: boolean;
  readonly journalThrough: number;
  readonly sourcesBusy: boolean;
  readonly sourcesLoad: number;
  readonly onRetry: () => void;
  readonly onCheck: () => void;
  readonly onRefresh: () => void;
  readonly onResubmit: () => void;
  readonly onEdit: () => void;
};

function CommandItem({ submission, busy, journalThrough, sourcesBusy, sourcesLoad, onRetry, onCheck, onRefresh, onResubmit, onEdit }: ItemProps) {
  const copy = describeOutcome(submission);
  const actions = nextActions(submission, journalThrough, sourcesLoad);
  const outcome = submission.outcome;
  const status = outcome.kind === "tracked" ? outcome.status : null;
  const technical = outcome.kind === "refused" ? outcome.technical : outcome.kind === "tracked" ? outcome.status.error ?? outcome.technical : null;
  const checkNote = outcome.kind === "tracked" && outcome.check !== "ok" ? CHECK_COPY[outcome.check] : "";
  const waitingForUpload = actions.refresh && !actions.resubmit && submission.operation !== null && sourcesLoad > submission.sourcesLoad;
  const titleId = `command-${submission.commandId}`;
  return (
    <li class="command-item" aria-labelledby={titleId}>
      <div class="command-item__head">
        <h4 id={titleId}>{summarizeOperation(submission.operation)}</h4>
        <span class="source__state">{copy.label}</span>
      </div>
      <dl class="account-status command__facts">
        <div><dt>Command ID</dt><dd><code>{submission.commandId}</code></dd></div>
        <div><dt>Base revision</dt><dd>journal {submission.baseRevision}</dd></div>
        <div data-tone={copy.tone}><dt>State</dt><dd>{copy.explanation}</dd></div>
        {status !== null && status.sourceRevision !== null && <div><dt>Source revision</dt><dd>{status.sourceRevision}</dd></div>}
        {resultEntries(status).map(entry => <div key={entry.key}><dt>Result: {entry.key}</dt><dd><code>{entry.value}</code></dd></div>)}
      </dl>
      {copy.next !== null && <p class="note">{copy.next}</p>}
      {waitingForUpload && (
        <p class="note">Sources were refreshed, but the revision here is still journal {journalThrough}. Wait for the device's next upload and refresh again.</p>
      )}
      {technical !== null && (
        <details class="command-item__technical"><summary>Technical details</summary><p><code>{technical}</code></p></details>
      )}
      <div class="cluster command-item__actions">
        {actions.retry && <button class="button secondary" type="button" disabled={busy} onClick={onRetry}>Retry with the same ID</button>}
        {actions.check && <button class="button secondary" type="button" disabled={busy} onClick={onCheck}>Check status</button>}
        {actions.refresh && <button class="button secondary" type="button" disabled={sourcesBusy} onClick={onRefresh}>Refresh sources</button>}
        {actions.resubmit && (
          <button class="button secondary" type="button" disabled={busy} onClick={onResubmit}>Submit again at journal {journalThrough}</button>
        )}
        {actions.edit && <button class="button secondary" type="button" onClick={onEdit}>Edit in form</button>}
        <span class="note" role="status" aria-live="polite">{busy ? "Working\u2026" : checkNote}</span>
      </div>
    </li>
  );
}

export function CommandsDisclosure({ profile, sourcesBusy, sourcesLoad, signal, onRefreshSources, onUnauthorized }: Props) {
  const [draft, setDraft] = useState<CommandDraft>(() => emptyCommandDraft());
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("");
  const [submissions, setSubmissions] = useState<readonly Submission[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [lookup, setLookup] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const own = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    own.current = controller;
    const abort = () => controller.abort();
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return () => {
      signal.removeEventListener("abort", abort);
      controller.abort();
      own.current = null;
    };
  }, [signal]);

  const source = { deviceId: profile.deviceId, sourceDomain: profile.sourceDomain };
  const id = (name: string) => `commands-${profile.deviceId}-${name}`;
  const patch: Patch = next => setDraft(current => ({ ...current, ...next }));
  const update = (commandId: string, change: (submission: Submission) => Submission) =>
    setSubmissions(current => current.map(submission => submission.commandId === commandId ? change(submission) : submission));
  const mark = (commandId: string, active: boolean) => setBusy(current => {
    const next = new Set(current);
    if (active) next.add(commandId);
    else next.delete(commandId);
    return next;
  });
  const run = async (commandId: string, task: (signal: AbortSignal) => Promise<void>) => {
    const controller = own.current;
    if (controller === null) return;
    mark(commandId, true);
    try {
      await task(controller.signal);
    } finally {
      if (!controller.signal.aborted) mark(commandId, false);
    }
  };
  const send = (submission: Submission) => run(submission.commandId, async requestSignal => {
    update(submission.commandId, sending);
    try {
      const status = await submitCommand(commandRequest(submission), requestSignal);
      update(submission.commandId, current => submitted(current, status));
    } catch (error) {
      if (requestSignal.aborted) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      const failure = classifyFailure(error);
      update(submission.commandId, current => submitFailed(current, failure));
    }
  });
  const check = (submission: Submission) => run(submission.commandId, async requestSignal => {
    try {
      const status = await readCommandStatus(statusRequest(submission), requestSignal);
      update(submission.commandId, current => checked(current, status));
    } catch (error) {
      if (requestSignal.aborted) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      const failure = classifyFailure(error);
      update(submission.commandId, current => checkFailed(current, failure));
    }
  });
  const submit = (event: Event) => {
    event.preventDefault();
    const built = buildOperation(draft);
    if (!built.ok) {
      setProblems(built.problems);
      setMessage("");
      return;
    }
    setProblems([]);
    const submission = newSubmission(source, profile.journalThrough, built.operation, sourcesLoad);
    setSubmissions(current => [submission, ...current]);
    setMessage(`Command ${shortId(submission.commandId)} is listed below with its status.`);
    void send(submission);
  };
  const resubmit = (previous: Submission) => {
    if (previous.operation === null) return;
    const submission = newSubmission(source, profile.journalThrough, previous.operation, sourcesLoad);
    setSubmissions(current => [submission, ...current]);
    void send(submission);
  };
  const edit = (submission: Submission) => {
    if (submission.operation === null) return;
    setDraft(draftFromOperation(submission.operation));
    setProblems([]);
    setMessage(`Copied command ${shortId(submission.commandId)} into the form. Queueing sends it as a new command.`);
    form.current?.querySelector<HTMLElement>("select")?.focus();
  };
  const lookUp = (event: Event) => {
    event.preventDefault();
    const commandId = lookup.trim().toLowerCase();
    if (!isCommandId(commandId)) {
      setLookupMessage("Enter the full command ID shown when a command was queued.");
      return;
    }
    const existing = submissions.find(submission => submission.commandId === commandId);
    if (existing !== undefined) {
      setLookupMessage(`Command ${shortId(commandId)} is already listed below; checking its status.`);
      void check(existing);
      return;
    }
    setLookupMessage("Checking\u2026");
    void run(commandId, async requestSignal => {
      try {
        const status = await readCommandStatus({ profile: source, commandId }, requestSignal);
        setSubmissions(current => [fromStatus(source, status, sourcesLoad), ...current]);
        setLookup("");
        setLookupMessage(`Command ${shortId(commandId)} is listed below.`);
      } catch (error) {
        if (requestSignal.aborted) return;
        if (isUnauthorized(error)) {
          onUnauthorized();
          return;
        }
        setLookupMessage(error instanceof DashboardRequestError && error.status === 404 ?
          "skillar has no record of that command ID for this source." : describeFailure(error, "Checking the command"));
      }
    });
  };

  return (
    <details class="commands">
      <summary>Remote commands for this source</summary>
      <p class="note">
        skillar queues a command for device {shortId(profile.deviceId)}. The device's local daemon applies it on its existing {SYNC_CADENCE_SECONDS}-second
        sync only after <code>{ENABLE_COMMANDS_CLI}</code> was run on that device; remote commands are off by default, and a device that is offline or
        opted out leaves them pending. Statuses change only when you check them.
      </p>
      <form class="command-form" ref={form} onSubmit={submit} aria-describedby={id("base")}>
        <label class="field-label">Command
          <select class="text-field" value={draft.kind} onChange={event => {
            const kind = COMMAND_KINDS.find(candidate => candidate === event.currentTarget.value);
            if (kind !== undefined) patch({ kind });
          }}>
            {COMMAND_KINDS.map(kind => <option value={kind} key={kind}>{kind} {"\u2014"} {COMMAND_KIND_COPY[kind].label}</option>)}
          </select>
        </label>
        <p class="note">{COMMAND_KIND_COPY[draft.kind].detail}</p>
        <KindFields draft={draft} patch={patch} />
        <p class="note" id={id("base")}>
          Base revision: journal {profile.journalThrough}, from the last sources load. The device applies the command only if its data is still at this
          revision; refresh sources to update it.
        </p>
        {problems.length > 0 && (
          <ul class="problems" role="alert">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
        )}
        <div class="cluster">
          <button class="button primary" type="submit">Queue command</button>
          <button class="button secondary" type="button" onClick={onRefreshSources} disabled={sourcesBusy}>Refresh sources</button>
          <span class="note" role="status" aria-live="polite">{message}</span>
        </div>
      </form>
      <h3 id={id("list")}>Commands from this page</h3>
      <p class="note">
        Listed only while this snapshot is open; closing it, switching sources or signing out clears the list. Statuses stay on skillar and can be
        looked up by command ID.
      </p>
      {submissions.length === 0 ? <p class="note">No command has been queued from this page.</p> : (
        <ul class="command-list" aria-labelledby={id("list")}>
          {submissions.map(submission => (
            <CommandItem key={submission.commandId} submission={submission} busy={busy.has(submission.commandId)}
              journalThrough={profile.journalThrough} sourcesBusy={sourcesBusy} sourcesLoad={sourcesLoad}
              onRetry={() => void send(submission)} onCheck={() => void check(submission)} onRefresh={onRefreshSources}
              onResubmit={() => resubmit(submission)} onEdit={() => edit(submission)} />
          ))}
        </ul>
      )}
      <form class="command-lookup" onSubmit={lookUp}>
        <label class="field-label">Command ID
          <input class="text-field" type="text" autocomplete="off" spellcheck={false} value={lookup}
            onInput={event => setLookup(event.currentTarget.value)} />
        </label>
        <div class="cluster">
          <button class="button secondary" type="submit" disabled={busy.has(lookup.trim().toLowerCase())}>Check a command ID</button>
          <span class="note" role="status" aria-live="polite">{lookupMessage}</span>
        </div>
      </form>
    </details>
  );
}
