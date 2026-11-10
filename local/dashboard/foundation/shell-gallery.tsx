import { useState } from "preact/hooks";
import { Sidebar, NavGroup, NavItem, Breadcrumb, Topbar, PageHeader } from "./shell/navigation";
import { Tabs } from "./shell/tabs";
import { CommandPalette } from "./shell/command-palette";
import { Button } from "./controls/buttons";
import { Glyph as Icon } from "./controls/icons";
import { shellReferenceCommands } from "./shell-reference-commands";

export function ShellGallery() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const tabItems = [
    { id: "table", label: "Table", icon: <Icon name="columns" />, content: <p>표 보기</p> },
    { id: "chart", label: "Chart", icon: <Icon name="dashboard" />, content: <p>차트 보기</p> },
    { id: "graph", label: "Graph", disabled: true, content: <p>관계 기록 없음</p> },
  ];
  return <section data-component="shell" aria-labelledby="shell-title">
    <h2 id="shell-title">셸</h2>
    <div class="lf-gallery__grid">
      <div data-specimen="Sidebar" data-component="Sidebar">
        <Sidebar label="주요 화면"><NavGroup label="Observability">
          <NavItem href="#traces" label="Tracing" icon={<Icon name="tree" />} current />
          <NavItem href="#sessions" label="Sessions" icon={<Icon name="sessions" />} />
          <NavItem href="#disabled" label="Unavailable" disabled />
        </NavGroup></Sidebar>
      </div>
      <div data-specimen="Sidebar-collapsed" data-component="Sidebar-collapsed">
        <Sidebar label="축소 탐색" collapsed><NavGroup label="Observability">
          <NavItem href="#traces" label="Tracing" icon={<Icon name="tree" />} current />
          <NavItem href="#sessions" label="Sessions" icon={<Icon name="sessions" />} />
        </NavGroup></Sidebar>
      </div>
      <div data-specimen="Breadcrumb" data-component="Breadcrumb">
        <Breadcrumb items={[{ label: "Demo Project", href: "#project" }, { label: "Langfuse Demo" }]} />
      </div>
      <div data-specimen="Topbar" data-component="Topbar">
        <Topbar><Breadcrumb items={[{ label: "호스팅", href: "#hosted" }, { label: "대시보드" }]} /></Topbar>
        <PageHeader title="대시보드" actions={<Button text="새로고침" variant="outline" />} />
      </div>
      <div data-specimen="Tabs" data-component="Tabs">
        <Tabs id="gallery-tabs" label="View mode" tabs={tabItems} />
      </div>
      <div data-specimen="Tabs-underline" data-component="Tabs-underline">
        <Tabs id="gallery-underline" label="상세 보기" tabs={tabItems} variant="underline" activation="manual" />
      </div>
      <div data-specimen="CommandPalette" data-component="CommandPalette">
        <Button id="gallery-command-trigger" text="화면 이동" variant="outline" onClick={() => setOpen(true)} />
        <output aria-live="polite">{action}</output>
      </div>
    </div>
    {open && <CommandPalette id="gallery-command" onClose={() => setOpen(false)} commands={new URLSearchParams(location.search).has("referenceCommands")
      ? shellReferenceCommands.map(item => ({...item,onSelect:()=>setAction(item.id)})) : [
      { id: "tracing", label: "Tracing", icon: <Icon name="tree" />, onSelect: () => setAction("tracing") },
      { id: "sessions", label: "Sessions", icon: <Icon name="sessions" />, onSelect: () => setAction("sessions") },
      { id: "disabled", label: "Unavailable", disabled: true, onSelect: () => setAction("disabled") },
    ]} />}
  </section>;
}
