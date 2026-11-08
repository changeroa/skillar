import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

export function SegmentedTabs({ id, label, tabs, initialId, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly content: ComponentChildren }[];
  readonly initialId?: string;
  readonly onChange?: (id: string) => void;
}) {
  const [selected, setSelected] = useState(initialId ?? tabs[0]?.id);
  const activate = (index: number, focus: boolean) => {
    const tab = tabs[index];
    if (!tab) return;
    setSelected(tab.id);
    onChange?.(tab.id);
    if (focus) document.getElementById(`${id}-tab-${tab.id}`)?.focus();
  };
  return h("div", { class: "ui-segments" },
    h("div", { role: "tablist", "aria-label": label }, tabs.map((tab, index) =>
      h("button", {
        type: "button", role: "tab", key: tab.id, id: `${id}-tab-${tab.id}`,
        "aria-controls": `${id}-panel-${tab.id}`, "aria-selected": selected === tab.id,
        tabIndex: selected === tab.id ? 0 : -1,
        onClick: () => activate(index, false),
        onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
          let next: number;
          switch (event.key) {
            case "ArrowRight": next = (index + 1) % tabs.length; break;
            case "ArrowLeft": next = (index - 1 + tabs.length) % tabs.length; break;
            case "Home": next = 0; break;
            case "End": next = tabs.length - 1; break;
            default: return;
          }
          event.preventDefault();
          activate(next, true);
        },
      }, tab.label))),
    tabs.map(tab => h("section", {
      key: tab.id, role: "tabpanel", id: `${id}-panel-${tab.id}`,
      "aria-labelledby": `${id}-tab-${tab.id}`, hidden: selected !== tab.id, tabIndex: 0,
    }, tab.content)));
}
