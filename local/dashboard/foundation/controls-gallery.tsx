import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button, IconButton, Badge, StatusBadge, Tag, Input, SearchInput, Select,
  Checkbox, Link, KeyboardShortcut, Skeleton, CopyButton } from "./controls";

function Specimen({ id, children }: { readonly id: string; readonly children: ComponentChildren }) {
  return <div class="lf-gallery__specimen" data-specimen={id}>
    <code>{id}</code><div class="lf-controls__sample">{children}</div>
  </div>;
}

export function ControlsGallery() {
  const [search, setSearch] = useState("skillar");
  const [submitted, setSubmitted] = useState("");
  const [count, setCount] = useState(0);
  const [tag, setTag] = useState(true);
  const [badge, setBadge] = useState(true);
  const [checked, setChecked] = useState(false);
  const [selection, setSelection] = useState("a");
  return <section id="basic-controls" aria-labelledby="basic-controls-title" data-component="basic-controls">
    <h2 id="basic-controls-title">기본 컨트롤</h2>
    <p>같은 Preact 컴포넌트를 두 앱에서 사용합니다.</p>
    <div class="lf-gallery__grid">
      {(["primary", "secondary", "outline", "destructive", "ghost", "text"] as const).map(variant =>
        <Specimen key={variant} id={`button-${variant}`}><Button text="확인" variant={variant} onClick={() => setCount(value => value + 1)} /></Specimen>)}
      <Specimen id="button-small"><Button text="확인" size="sm" /></Specimen>
      <Specimen id="button-disabled"><Button text="확인" disabled /></Specimen>
      <Specimen id="button-loading"><Button text="확인" loading /></Specimen>
      <Specimen id="button-selected"><Button text="선택" variant="outline" icon="check" aria-pressed="true" /></Specimen>
      {(["ghost", "outline", "outlineDestructive", "subtle", "toolbar", "destructive"] as const).map(variant =>
        <Specimen key={variant} id={`icon-${variant}`}><IconButton label="복사" icon="copy" variant={variant} /></Specimen>)}
      <Specimen id="icon-disabled"><IconButton label="복사" icon="copy" disabled /></Specimen>
      <Specimen id="icon-small"><IconButton label="복사" icon="copy" size="sm" /></Specimen>
      <Specimen id="icon-xs"><IconButton label="복사" icon="copy" size="xs" /></Specimen>
      {(["primary", "filled", "filledOnMuted", "ghost", "inverted", "green", "blue", "violet", "teal", "red", "yellow"] as const).map(color =>
        <Specimen key={color} id={`badge-${color}`}><Badge text="value" color={color} /></Specimen>)}
      <Specimen id="badge-mono"><Badge text="0.71s" label="latency" mono /></Specimen>
      <Specimen id="badge-small"><Badge text="value" size="sm" /></Specimen>
      <Specimen id="badge-medium"><Badge text="value" size="md" /></Specimen>
      <Specimen id="badge-large"><Badge text="value" size="lg" /></Specimen>
      <Specimen id="badge-dismiss">{badge ? <Badge text="value" onDismiss={() => setBadge(false)} /> : <Button text="다시 표시" variant="ghost" onClick={() => setBadge(true)} />}</Specimen>
      {["active", "pending", "delayed", "cancelled", "not_configured", "paused", "completed", "failed", "warning", "unknown"].map(type =>
        <Specimen key={type} id={`status-${type.replaceAll("_", "-")}`}><StatusBadge type={type} /></Specimen>)}
      <Specimen id="tag-default"><Tag text="production" /></Specimen>
      <Specimen id="tag-warning"><Tag text="production" status="warning" /></Specimen>
      <Specimen id="tag-error"><Tag text="production" status="error" /></Specimen>
      <Specimen id="tag-secondary"><Tag text="production" secondaryText="(current)" /></Specimen>
      <Specimen id="tag-remove">{tag ? <Tag text="production" remove={{ onRemove: () => setTag(false) }} /> : <Button text="다시 표시" variant="ghost" onClick={() => setTag(true)} />}</Specimen>
      <Specimen id="tag-disabled"><Tag text="production" remove={{ onRemove() {}, disabled: true }} /></Specimen>
      <Specimen id="input-default"><Input label="이름" defaultValue="skillar" /></Specimen>
      <Specimen id="input-empty"><Input label="이름" placeholder="스킬 이름" /></Specimen>
      <Specimen id="input-disabled"><Input label="이름" defaultValue="skillar" disabled /></Specimen>
      <Specimen id="input-error"><Input label="이름" error="이름을 입력하세요." /></Specimen>
      <Specimen id="input-prefix"><Input label="이름" prefix="name" defaultValue="skillar" /></Specimen>
      <Specimen id="input-value-prefix"><Input label="주소" valuePrefix="https://" defaultValue="skillar.sh" /></Specimen>
      <Specimen id="search-default"><SearchInput label="검색" value={search} onChange={setSearch} onSubmit={setSubmitted} /></Specimen>
      <Specimen id="search-empty"><SearchInput label="검색" value="" onChange={setSearch} onSubmit={setSubmitted} /></Specimen>
      <Specimen id="search-disabled"><SearchInput label="검색" value="skillar" disabled onChange={setSearch} onSubmit={setSubmitted} /></Specimen>
      <Specimen id="select-default"><Select label="항목" value={selection} onChange={event => setSelection(event.currentTarget.value)}
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma", disabled: true }]} /></Specimen>
      <Specimen id="select-disabled"><Select label="항목" value="a" disabled options={[{ value: "a", label: "Alpha" }]} /></Specimen>
      <Specimen id="select-empty"><Select label="항목" value="" options={[]} /></Specimen>
      <Specimen id="select-error"><Select label="항목" value="" error="항목을 선택하세요." options={[{ value: "a", label: "Alpha" }]} /></Specimen>
      <Specimen id="checkbox-unchecked"><Checkbox label="선택" checked={checked} onChange={event => setChecked(event.currentTarget.checked)} /></Specimen>
      <Specimen id="checkbox-checked"><Checkbox label="선택" checked onChange={() => {}} /></Specimen>
      <Specimen id="checkbox-mixed"><Checkbox label="선택" mixed /></Specimen>
      <Specimen id="checkbox-disabled"><Checkbox label="선택" checked disabled /></Specimen>
      <Specimen id="checkbox-small"><Checkbox label="선택" checked size="sm" onChange={() => {}} /></Specimen>
      <Specimen id="link-default"><Link href="#basic-controls" text="스킬 보기" /></Specimen>
      <Specimen id="link-external"><Link href="https://skillar.sh" text="스킬 보기" external /></Specimen>
      <Specimen id="shortcut-default"><KeyboardShortcut keys={["Mod", "K"]} /></Specimen>
      <Specimen id="shortcut-keycap"><KeyboardShortcut keys={["Mod", "K"]} variant="keycap" /></Specimen>
      <Specimen id="shortcut-small"><KeyboardShortcut keys={["Mod", "K"]} size="sm" /></Specimen>
      <Specimen id="shortcut-xs"><KeyboardShortcut keys={["Mod", "K"]} size="xs" /></Specimen>
      <Specimen id="skeleton-default"><Skeleton /></Specimen>
      <Specimen id="skeleton-contrast"><Skeleton variant="contrast" /></Specimen>
      <Specimen id="copy-default"><CopyButton value="skillar-original-value" label="ID" /></Specimen>
      <Specimen id="copy-disabled"><CopyButton value="skillar-original-value" label="ID" disabled /></Specimen>
      <Specimen id="copy-copying"><CopyButton value="skillar-original-value" label="ID" /></Specimen>
      <Specimen id="copy-copied"><CopyButton value="skillar-original-value" label="ID" /></Specimen>
      <Specimen id="copy-error"><CopyButton value="skillar-original-value" label="ID" /></Specimen>
    </div>
    <output id="controls-result" aria-live="polite">확인 {count}회 / 검색: {submitted || "아직 없음"} / 항목: {selection}</output>
  </section>;
}
