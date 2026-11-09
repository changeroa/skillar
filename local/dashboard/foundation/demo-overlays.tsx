import { DropdownMenu, Tooltip } from "./overlays";
import { IconButton } from "./controls";

/** Public-prop reference fixtures; no primitive CSS overrides or reference images. */
export function DemoOverlays() {
  const control = new URLSearchParams(location.search).get("demoOverlay");
  const noAction = () => {};
  return <main class="lf-gallery" id="gallery" data-ready="true">
    <h1>Overlay reference fixtures</h1>
    {control === "menu" ? <DropdownMenu id="reference-menu" label="Filter options" items={[
      { id: "clear", label: "Clear all filters", onSelect: noAction },
      { id: "active", label: "Show only active", checked: false, onSelect: noAction },
      { id: "collapse", label: "Collapse sidebar", separatorBefore: true, onSelect: noAction },
    ]} /> : <Tooltip id="reference-tooltip" content="Filter options">
      <IconButton id="reference-tooltip-trigger" label="Filter options" icon="ellipsis" />
    </Tooltip>}
  </main>;
}
