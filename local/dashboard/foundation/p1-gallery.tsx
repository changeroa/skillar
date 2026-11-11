import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Textarea, Radio, Switch, Avatar } from "./controls/choices";
import { Combobox, MultiSelect } from "./controls/combobox";
import { DateRangeInput, TimePeriodSelect } from "./controls/date-range";
import { Spinner, Toast, type ToastVariant } from "./controls/feedback";
import { CodeBlock, MarkdownViewer, DiffViewer } from "./viewers";
import "./controls/controls.css";
import "./gallery.css";
import { lineDiff } from "../../../site/src/skills/diff";

const options = [{ value: "alpha", label: "Alpha" }, { value: "disabled", label: "Disabled", disabled: true },
  { value: "beta", label: "Beta" }, { value: "gamma", label: "Gamma" }] as const;
const sample = "# Skill\n\nA recorded document.\n\n- Read the file\n- Keep its content\n\n```text\nconst value = 1;\n```";
const variants: readonly ToastVariant[] = ["default", "success", "info", "warning", "error", "loading"];

function Specimen({ component, state, children }: { readonly component: string; readonly state: string; readonly children: ComponentChildren }) {
  return <article class="lf-gallery__specimen" data-component={component} data-state={state} data-specimen>
    <h2>{component} / {state}</h2><div data-probe>{children}</div>
  </article>;
}

export function P1Gallery() {
  const examples = new URLSearchParams(location.search);
  const [single, setSingle] = useState("");
  const [multiple, setMultiple] = useState<readonly string[]>(["alpha"]);
  const [period, setPeriod] = useState("7");
  const [range, setRange] = useState({ from: Date.UTC(2026, 10, 1) - 9 * 3600000, to: Date.UTC(2026, 10, 7) - 9 * 3600000 });
  const [message, setMessage] = useState("Saved");
  const [theme, setTheme] = useState(document.documentElement.dataset["theme"] ?? "system");
  return <main id="gallery" class={`lf-gallery${examples.has("atomic") ? " lf-gallery--atomic" : ""}`} data-ready="true">
    <h1>Viewers and P1 controls</h1>
    <label>Theme <select value={theme} onChange={event => {
      const next = event.currentTarget.value; setTheme(next); document.documentElement.dataset["theme"] = next;
    }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <div class="lf-gallery__grid">
      {["default", "empty", "disabled", "error", "code"].map(state =>
        <Specimen component="Textarea" state={state} key={`textarea-${state}`}>
          <Textarea id={`p1-textarea-${state}`} label="Description" disabled={state === "disabled"} code={state === "code"}
            {...(state === "error" ? { error: "Required" } : {})} placeholder="Describe the skill"
            defaultValue={state === "empty" ? "" : "Recorded text"} />
        </Specimen>)}
      <Specimen component="Combobox" state="default"><Combobox id="p1-combo" label="Skill" options={options} value={single} onChange={setSingle} /></Specimen>
      <Specimen component="Combobox" state="disabled"><Combobox label="Skill" options={options} value="alpha" onChange={setSingle} disabled /></Specimen>
      <Specimen component="Combobox" state="error"><Combobox label="Skill" options={options} value="" onChange={setSingle} error="Required" /></Specimen>
      <Specimen component="Combobox" state="empty"><Combobox label="Skill" options={[]} value="" onChange={setSingle} /></Specimen>
      <Specimen component="MultiSelect" state="selected"><MultiSelect id="p1-multi" label="Models" options={options} value={multiple} onChange={setMultiple} /></Specimen>
      <Specimen component="MultiSelect" state="empty"><MultiSelect label="Models" options={[]} value={[]} onChange={setMultiple} /></Specimen>
      <Specimen component="MultiSelect" state="disabled"><MultiSelect label="Models" options={options} value={["alpha"]} onChange={setMultiple} disabled /></Specimen>
      {["default", "sm"].flatMap(size => ["default", "green"].flatMap(color => [false, true].flatMap(checked =>
        [false, true].map(disabled => <Specimen component="Switch" key={`${size}-${color}-${checked}-${disabled}`}
          state={`${size}-${color}-${checked ? "checked" : "unchecked"}-${disabled ? "disabled" : "enabled"}`}>
          <Switch label="Show details" size={size === "sm" ? "sm" : "default"} color={color === "green" ? "green" : "default"}
            defaultChecked={checked} disabled={disabled} />
        </Specimen>))))}
      {[false, true].flatMap(checked => [false, true].map(disabled =>
        <Specimen component="Radio" key={`radio-${checked}-${disabled}`} state={`${checked ? "checked" : "unchecked"}-${disabled ? "disabled" : "enabled"}`}>
          <Radio label="Option" name={`radio-${checked}-${disabled}`} defaultChecked={checked} disabled={disabled} />
        </Specimen>))}
      <Specimen component="Radio" state="group"><fieldset><legend>Choose one</legend>
        <Radio label="Alpha" name="group" value="a" defaultChecked /><Radio label="Beta" name="group" value="b" />
      </fieldset></Specimen>
      {(["xxs", "xs", "sm", "md", "lg", "xl", "xxl", "full"] as const).flatMap(size =>
        (["primary", "muted", "inherit"] as const).flatMap(variant => (["block", "inline"] as const).map(display =>
          <Specimen component="Spinner" key={`${size}-${variant}-${display}`} state={`${size}-${variant}${display === "inline" ? "-inline" : ""}`}>
            <div style={{ width: "48px", height: "48px" }}><Spinner size={size} variant={variant} display={display} /></div>
          </Specimen>)))}
      {variants.map(variant => <Specimen component="Toast" state={variant} key={variant}>
        <Toast message={message} description="Your changes are saved." variant={variant}
          action={{ label: "Undo", onClick: () => setMessage("Undone") }} onDismiss={() => setMessage("")} />
      </Specimen>)}
      {(["sm", "md", "lg"] as const).flatMap(size => (["circle", "rounded"] as const).flatMap(shape =>
        (["muted", "tinted"] as const).map(tone => <Specimen component="Avatar" key={`${size}-${shape}-${tone}`} state={`${size}-${shape}-${tone}`}>
          <Avatar displayName="Demo User" size={size} shape={shape} tone={tone} />
        </Specimen>)))}
      <Specimen component="Avatar" state="image"><Avatar displayName="Demo User" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23888'/%3E%3C/svg%3E" /></Specimen>
      <Specimen component="MarkdownViewer" state="formatted"><MarkdownViewer text={examples.get("markdown") ?? sample} /></Specimen>
      <Specimen component="MarkdownViewer" state="empty"><MarkdownViewer text="" /></Specimen>
      <Specimen component="MarkdownViewer" state="literal-html"><MarkdownViewer text={'<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>'} /></Specimen>
      <Specimen component="CodeBlock" state="default"><CodeBlock value={examples.get("code") ?? "const value = 1;"} language={examples.get("language") ?? "javascript"} /></Specimen>
      <Specimen component="CodeBlock" state="read-only"><CodeBlock value='{"value":1}' variant="read-only" language="json" /></Specimen>
      <Specimen component="CodeBlock" state="empty"><CodeBlock value="" /></Specimen>
      <Specimen component="DiffViewer" state="changed"><DiffViewer rows={examples.has("before") ? lineDiff(examples.get("before") ?? "", examples.get("after") ?? "") : [
        { kind: "same", text: "name: Skill", before: 1, after: 1 }, { kind: "removed", text: "before", before: 2, after: null },
        { kind: "added", text: "after", before: null, after: 2 },
      ]} /></Specimen>
      <Specimen component="DiffViewer" state="empty"><DiffViewer rows={[]} /></Specimen>
      <Specimen component="DateRangeInput" state="default"><DateRangeInput range={range} onChange={setRange} /></Specimen>
      <Specimen component="DateRangeInput" state="disabled"><DateRangeInput range={range} onChange={setRange} disabled /></Specimen>
      <Specimen component="TimePeriodSelect" state="default"><TimePeriodSelect value={period} onChange={setPeriod}
        options={[{ value: "7", label: "Past 7 days" }, { value: "30", label: "Past 30 days" }]} /></Specimen>
    </div>
  </main>;
}
