import { useState } from "preact/hooks";
import { ConfirmDialog, Dialog, DropdownMenu, Sheet, Tooltip } from "./overlays";
import { Button, IconButton } from "./controls";
import "./demo-overlays.css";

/** Public-prop reference fixtures; no primitive CSS overrides or reference images. */
export function DemoOverlays() {
  const control = new URLSearchParams(location.search).get("demoOverlay");
  const state = new URLSearchParams(location.search).get("state") ?? "open";
  const size = new URLSearchParams(location.search).get("size") === "default" ? "default" : "comparison";
  const params = new URLSearchParams(location.search);
  const bottomSheet = state === "bottom" || params.get("side") === "bottom";
  const [open, setOpen] = useState(state !== "closed");
  const [checked, setChecked] = useState(state === "checked");
  const noAction = () => {};
  const filterItems = [
    { id: "clear", label: "Clear all filters", onSelect: noAction },
    { id: "active", label: "Show only active", checked, onSelect: () => setChecked(value => !value) },
    { id: "collapse", label: "Collapse sidebar", separatorBefore: true, onSelect: noAction },
  ];
  const actionItems = [
    { id: "public", label: "Make Public", disabled: true, icon: "share", onSelect: noAction },
    { id: "copy", label: "Copy trace ID", icon: "copy", onSelect: noAction },
    { id: "name", label: "Copy trace name", icon: "copy", onSelect: noAction },
    { id: "delete", label: "Delete", icon: "trash", disabled: true, destructive: true, separatorBefore: true, onSelect: noAction },
  ] as const;
  const nested = <DropdownMenu id="reference-nested" label="More actions" icon="ellipsis" items={actionItems} />;
  const tooltip = <Tooltip id="reference-tooltip" content={params.get("label") ?? (state === "long" ? "Compare with selected prompt" : "Filter options")}
    size={params.get("tipSize") === "content" ? "content" : "bounded"}>
    <IconButton id="reference-tooltip-trigger" label={params.get("label") ?? "Filter options"}
      icon={params.get("tipIcon") === "diff" ? "diff" : params.get("tipIcon") === "chevrons" ? "chevrons" : "ellipsis"} />
  </Tooltip>;
  const body = state === "empty" ? null : state === "error" ? <p role="alert">Could not load the content.</p>
    : state === "loading" ? <p role="status">Loading content…</p> : <>
      <h3 class="reference-content-heading">Content</h3><div class="reference-content-grid"><section><p>v1</p><pre>{"Answer the following questions: {{question}} "}</pre></section>
        <section><p>v2</p><pre>{"Answer the following questions: {{question}} one word only"}</pre></section></div>
      <h3 class="reference-content-heading">Config</h3><p>No changes</p>
      {state === "scroll" && Array.from({ length: 60 }, (_, index) => <p key={index}>Recorded item {index + 1}</p>)}
      {state === "nested" && nested}
    </>;
  const actions = <Button id="reference-done" text="Close" variant={control === "dialog" && size === "comparison" ? "primary" : "outline"} disabled={state === "disabled"}
    loading={state === "loading"} onClick={() => setOpen(false)} />;
  return <main class="lf-gallery" id="gallery" data-ready="true">
    <h1>Overlay reference fixtures</h1>
    <div class="reference-host">
    {control === "menu" || control === "actions" ? state === "nested" ?
      <Dialog id="reference-menu-parent" open title="Read-only preview" onClose={noAction}>{nested}</Dialog> : <DropdownMenu id="reference-menu"
      label={state === "disabled-trigger" ? "New skill" : control === "actions" ? "More actions" : "Filter options"} disabled={state === "disabled-trigger"}
      width={control === "menu" ? "wide" : "content"} align="end"
      variant={state === "disabled-trigger" ? "primary" : "outline"}
      {...(state === "disabled-trigger" ? { buttonIcon: "chevron" as const } : { icon: "ellipsis" as const })}
      items={state === "empty" ? [] : control === "menu" ? filterItems : actionItems} />
      : control === "dialog" ? <>
        <IconButton id="reference-open" label="Compare with selected prompt" icon="diff" onClick={() => setOpen(true)} />
        <Dialog id="reference-dialog" size={size} open={open}
          title="Changes v1 → v2" {...(size === "comparison" ? { subtitle: "Prompt answer question" } : {})} onClose={() => setOpen(false)}
          actions={actions}>{body}</Dialog>
      </> : control === "confirm" ? <>
        {state === "nested" && <Dialog id="reference-parent" open title="Parent dialog" description="The confirmation is the top layer." onClose={noAction}>{null}</Dialog>}
        <IconButton id="reference-open" label="Evaluator actions" icon="ellipsis" onClick={() => setOpen(true)} />
        <ConfirmDialog id="reference-confirm" open={open} title="Delete selected evaluators?"
          description={state === "empty" ? "" : "All versions and evaluation rule assignments will be deleted."} confirmLabel="Delete evaluators" cancelLabel="Cancel"
          busy={state === "loading"} confirmDisabled={state === "disabled" || state === "empty"}
          error={state === "error" ? "Could not delete. Try again." : undefined}
          onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </> : control === "sheet" ? <>
        <Button id="reference-open" text="Open filters" onClick={() => setOpen(true)} />
        <Sheet id="reference-sheet" side={bottomSheet ? "bottom" : "right"} open={open} title="Filters"
          {...(bottomSheet ? { actions: <><Button text="Clear all" variant="outline" onClick={noAction} /><Button text="Show results" onClick={() => setOpen(false)} /></> } : {})}
          onClose={() => setOpen(false)}>{body}</Sheet>
    </> : state === "nested" ? <Dialog id="reference-tooltip-parent" open={open} title="Read-only preview"
      onClose={() => setOpen(false)}>{tooltip}</Dialog> : tooltip}
    </div>
  </main>;
}
