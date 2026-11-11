import { useEffect, useRef, useState } from "preact/hooks";
import type { DashboardProfile } from "../../../shared/dist/activity-dashboard.js";
import { DashboardRequestError, describeFailure, isUnauthorized, readCommandStatus, submitCommand } from "./api";
import {
  COMMAND_KINDS, COMMAND_KIND_COPY, ENABLE_COMMANDS_CLI, SYNC_CADENCE_SECONDS,
  buildOperation, checkFailed, checked, classifyFailure, commandRequest, draftFromOperation, emptyCommandDraft,
  fromStatus, isCommandId, newSubmission, sending, statusRequest, submitFailed, submitted,
} from "./commands";
import type { CommandDraft, Submission } from "./commands";
import { shortId } from "./status";

import { KindFields } from "./command-fields";
import { CommandItem } from "./command-item";

type Patch = (next: Partial<CommandDraft>) => void;

type Props = {
  readonly profile: DashboardProfile;
  readonly sourcesBusy: boolean;
  readonly sourcesLoad: number;
  readonly signal: AbortSignal;
  readonly onRefreshSources: () => void;
  readonly onUnauthorized: () => void;
};

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
  const sendingDraft = useRef(false);
  const activeRequests = useRef(new Set<string>());
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
    if (controller === null || activeRequests.current.has(commandId)) return;
    activeRequests.current.add(commandId);
    mark(commandId, true);
    try {
      await task(controller.signal);
    } finally {
      activeRequests.current.delete(commandId);
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
    if (sendingDraft.current || busy.size > 0) return;
    const built = buildOperation(draft);
    if (!built.ok) {
      setProblems(built.problems);
      setMessage("");
      return;
    }
    setProblems([]);
    const submission = newSubmission(source, profile.journalThrough, built.operation, sourcesLoad);
    setSubmissions(current => [submission, ...current]);
    setMessage(`명령 ${shortId(submission.commandId)}의 상태가 아래 목록에 표시됩니다.`);
    sendingDraft.current = true;
    void send(submission).finally(() => { sendingDraft.current = false; });
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
    setMessage(`명령 ${shortId(submission.commandId)}의 내용을 입력란에 복사했습니다. 대기열에 넣으면 새 명령으로 보냅니다.`);
    form.current?.querySelector<HTMLElement>("select")?.focus();
  };
  const lookUp = (event: Event) => {
    event.preventDefault();
    const commandId = lookup.trim().toLowerCase();
    if (!isCommandId(commandId)) {
      setLookupMessage("명령을 대기열에 넣을 때 표시된 전체 명령 ID를 입력하세요.");
      return;
    }
    const existing = submissions.find(submission => submission.commandId === commandId);
    if (existing !== undefined) {
      setLookupMessage(`명령 ${shortId(commandId)}의 항목이 이미 아래에 있습니다. 상태를 확인합니다.`);
      void check(existing);
      return;
    }
    setLookupMessage("확인 중\u2026");
    void run(commandId, async requestSignal => {
      try {
        const status = await readCommandStatus({ profile: source, commandId }, requestSignal);
        setSubmissions(current => [fromStatus(source, status, sourcesLoad), ...current]);
        setLookup("");
        setLookupMessage(`명령 ${shortId(commandId)}의 항목을 아래에 추가했습니다.`);
      } catch (error) {
        if (requestSignal.aborted) return;
        if (isUnauthorized(error)) {
          onUnauthorized();
          return;
        }
        setLookupMessage(error instanceof DashboardRequestError && error.status === 404 ?
          "이 출처에는 해당 명령 ID의 기록이 skillar에 없습니다." : describeFailure(error, "명령 상태 확인"));
      }
    });
  };

  return (
    <details class="commands">
      <summary>이 출처에 보내는 원격 명령</summary>
      <p class="note">
        기기 {shortId(profile.deviceId)}에 보낼 명령을 skillar가 대기열에 넣습니다. 기기의 로컬 데몬은 기존 {SYNC_CADENCE_SECONDS}초 동기화 때 명령을 적용하되,
        그 기기에서 <code>{ENABLE_COMMANDS_CLI}</code>를 실행한 뒤에만 적용합니다. 원격 명령은 기본적으로 꺼져 있고, 오프라인이거나
        원격 명령을 켜지 않은 기기에서는 대기 상태로 남습니다. 상태는 직접 확인할 때만 갱신됩니다.
      </p>
      <form class="command-form" ref={form} onSubmit={submit} aria-describedby={id("base")}>
        <label class="field-label">명령
          <select class="text-field" disabled={busy.size > 0} value={draft.kind} onChange={event => {
            const kind = COMMAND_KINDS.find(candidate => candidate === event.currentTarget.value);
            if (kind !== undefined) patch({ kind });
          }}>
            {COMMAND_KINDS.map(kind => <option value={kind} key={kind}>{kind} {"\u2014"} {COMMAND_KIND_COPY[kind].label}</option>)}
          </select>
        </label>
        <p class="note">{COMMAND_KIND_COPY[draft.kind].detail}</p>
        <KindFields draft={draft} patch={patch} busy={busy.size > 0} />
        <p class="note" id={id("base")}>
          기준 리비전: 저널 {profile.journalThrough} (마지막 출처 읽기 기준). 기기는 데이터가 아직 이 리비전에 있을 때만 명령을 적용합니다.
          갱신하려면 출처를 새로 고치세요.
        </p>
        {problems.length > 0 && (
          <ul class="problems" role="alert">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
        )}
        <div class="cluster">
          <button class="button primary" type="submit" disabled={busy.size > 0}>명령 대기열에 넣기</button>
          <button class="button secondary" type="button" onClick={onRefreshSources} disabled={sourcesBusy}>출처 새로 고침</button>
          <span class="note" role="status" aria-live="polite">{message}</span>
        </div>
      </form>
      <h3 id={id("list")}>이 페이지에서 보낸 명령</h3>
      <p class="note">
        이 기록이 열려 있는 동안만 표시됩니다. 기록을 닫거나 출처를 바꾸거나 로그아웃하면 목록이 지워집니다. 상태는 skillar에 남아 있어
        명령 ID로 조회할 수 있습니다.
      </p>
      {submissions.length === 0 ? <p class="note">이 페이지에서 대기열에 넣은 명령이 없습니다.</p> : (
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
        <label class="field-label">명령 ID
          <input class="text-field" type="text" autocomplete="off" spellcheck={false} value={lookup}
            onInput={event => setLookup(event.currentTarget.value)} />
        </label>
        <div class="cluster">
          <button class="button secondary" type="submit" disabled={busy.has(lookup.trim().toLowerCase())}>명령 ID로 확인</button>
          <span class="note" role="status" aria-live="polite">{lookupMessage}</span>
        </div>
      </form>
    </details>
  );
}
