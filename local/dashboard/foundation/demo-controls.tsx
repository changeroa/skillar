import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Badge, Button, Checkbox, CopyButton, IconButton, Input, KeyboardShortcut,
  Link, SearchInput, Select, Skeleton, StatusBadge, Tag } from "./controls";

/** Development-only host composition; primitive styles are never overridden. */
export function DemoControls() {
  const query = new URLSearchParams(location.search);
  const kind = query.get("demoControl");
  const label = query.get("label") ?? "Filters";
  const [value, setValue] = useState(query.get("value") ?? "");
  const width = Number(query.get("width") ?? "240");
  if (!Number.isFinite(width) || width <= 0) throw new RangeError("Invalid comparison host width");
  let control: ComponentChildren;
  switch (kind) {
    case "Button": {
      const requested = query.get("variant");
      const variant = requested === "ghost" ? "ghost" : requested === "primary" ? "primary" : "outline";
      control = <Button text={label} variant={variant}
        {...(query.get("icon") === "external" ? { icon: "external" as const } : {})}
        {...(query.get("icon") === "chevron" ? { trailingIcon: "chevron" as const } : {})}
        disabled={query.get("disabled") === "true"} />;
      break;
    }
    case "IconButton":
      control = <IconButton label={label} icon="ellipsis" size="sm" />;
      break;
    case "Badge":
      control = <Badge text={label} color={query.get("metric") === "true" ? "ghost" : "blue"}
        mono size={query.get("metric") === "true" ? "default" : "sm"} />;
      break;
    case "StatusBadge":
      control = <StatusBadge type={label} isLive={false} />;
      break;
    case "Tag":
      control = <Tag text={label} />;
      break;
    case "Input":
      control = <Input label={label} placeholder={query.get("placeholder") ?? label} defaultValue={value} />;
      break;
    case "SearchInput":
      control = <SearchInput label={label} placeholder={query.get("placeholder") ?? label}
        value={value} onChange={setValue} onSubmit={() => {}} />;
      break;
    case "Select":
      control = <Select label={label} placeholder={label} value={value} disabled={query.get("disabled") === "true"}
        onChange={event => setValue(event.currentTarget.value)}
        options={[{ value: "all", label: value === "all" ? label : "All Objects" }, { value: "score", label: "First score" }]} />;
      break;
    case "Checkbox":
      control = <Checkbox label={label} checked={query.get("checked") === "true"} size="sm" onChange={() => {}} />;
      break;
    case "Link":
      control = <Link text={label} href="#demo-control" />;
      break;
    case "KeyboardShortcut":
      control = <KeyboardShortcut keys={["Mod", "K"]} platform="mac" />;
      break;
    case "Skeleton":
      control = <Skeleton rows={1} />;
      break;
    case "CopyButton":
      control = <CopyButton label={label} value="public-demo-fixture-value" />;
      break;
    default:
      throw new RangeError("Unknown comparison control");
  }
  return <main id="gallery" data-ready="true" data-demo-control={kind}>
    <div id="demo-control" style={{ position: "absolute", left: "49px", top: "123px", width: `${width}px`,
      ...(query.get("stretch") === "true" ? { display: "flex", flexDirection: "column" } : {}) }}>
      {control}
    </div>
  </main>;
}
