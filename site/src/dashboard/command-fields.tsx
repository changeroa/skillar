import { useId } from "preact/hooks";
import { Textarea } from "../../../local/dashboard/foundation/controls/textarea";
import { FIELD_LABELS } from "./commands";
import type { CommandDraft } from "./commands";

type Patch = (next: Partial<CommandDraft>) => void;

function TextField({ label, value, numeric = false, busy, onInput }: {
  readonly label: string; readonly value: string; readonly numeric?: boolean; readonly busy: boolean; readonly onInput: (next: string) => void;
}) {
  return (
    <label class="field-label">{label}
      <input class="text-field" type="text" disabled={busy} autocomplete="off" spellcheck={false} {...(numeric ? { inputMode: "numeric" as const } : {})}
        value={value} onInput={event => onInput(event.currentTarget.value)} />
    </label>
  );
}

function TextArea({ label, value, busy, onInput }: { readonly label: string; readonly value: string; readonly busy: boolean; readonly onInput: (next: string) => void }) {
  const id = useId();
  return <Textarea id={id} label={label} value={value} code disabled={busy} spellcheck={false}
    onInput={event => onInput(event.currentTarget.value)} />;
}

export function KindFields({ draft, patch, busy }: { readonly draft: CommandDraft; readonly patch: Patch; readonly busy: boolean }) {
  switch (draft.kind) {
    case "workflow.put":
      return (
        <>
          <div class="command-form__fields">
            <TextField busy={busy} label={FIELD_LABELS.workflowName} value={draft.workflowName} onInput={workflowName => patch({ workflowName })} />
          </div>
          <TextArea busy={busy} label={FIELD_LABELS.workflowSteps} value={draft.workflowSteps} onInput={workflowSteps => patch({ workflowSteps })} />
          <p class="note">
            각 단계에는 <code>id</code>와 <code>skills</code> 목록이 필요하고 <code>together</code>, <code>expectTools</code>, <code>doneWhen</code>은 선택입니다.
            서로 다른 id를 가진 단계를 최대 50개까지 넣을 수 있습니다. 예: <code>{"[{\"id\":\"plan\",\"skills\":[\"skillar/plan\"]}]"}</code>
          </p>
        </>
      );
    case "flow.create":
      return (
        <div class="command-form__fields">
          <TextField busy={busy} label={FIELD_LABELS.workspaceId} value={draft.workspaceId} onInput={workspaceId => patch({ workspaceId })} />
          <TextField busy={busy} label={FIELD_LABELS.tabId} value={draft.tabId} onInput={tabId => patch({ tabId })} />
          <TextField busy={busy} label={FIELD_LABELS.flowName} value={draft.flowName} onInput={flowName => patch({ flowName })} />
          <TextField busy={busy} label={FIELD_LABELS.flowVersion} value={draft.flowVersion} numeric onInput={flowVersion => patch({ flowVersion })} />
          <TextField busy={busy} label={FIELD_LABELS.label} value={draft.label} onInput={label => patch({ label })} />
        </div>
      );
    case "flow.map-step":
      return (
        <div class="command-form__fields">
          <TextField busy={busy} label={FIELD_LABELS.flowId} value={draft.flowId} onInput={flowId => patch({ flowId })} />
          <TextField busy={busy} label={FIELD_LABELS.paneId} value={draft.paneId} onInput={paneId => patch({ paneId })} />
          <TextField busy={busy} label={FIELD_LABELS.stepId} value={draft.stepId} onInput={stepId => patch({ stepId })} />
        </div>
      );
    case "flow.end":
      return (
        <div class="command-form__fields">
          <TextField busy={busy} label={FIELD_LABELS.flowId} value={draft.flowId} onInput={flowId => patch({ flowId })} />
        </div>
      );
    case "eval.add":
      return (
        <>
          <TextArea busy={busy} label={FIELD_LABELS.query} value={draft.query} onInput={query => patch({ query })} />
          <div class="command-form__fields">
            <TextField busy={busy} label={FIELD_LABELS.expectedUri} value={draft.expectedUri} onInput={expectedUri => patch({ expectedUri })} />
            <TextField busy={busy} label={FIELD_LABELS.fromTraceId} value={draft.fromTraceId} onInput={fromTraceId => patch({ fromTraceId })} />
          </div>
        </>
      );
    default: {
      const exhaustive: never = draft.kind;
      return exhaustive;
    }
  }
}
