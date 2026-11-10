import { h } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

export type TabItem = {
  readonly id: string; readonly label: string; readonly content: ComponentChildren;
  readonly disabled?: boolean; readonly icon?: ComponentChildren;
};
export type TabsProps = {
  readonly id: string; readonly label: string; readonly tabs: readonly TabItem[];
  readonly initialId?: string; readonly value?: string; readonly onChange?: (id: string) => void;
  readonly activation?: "automatic" | "manual"; readonly variant?: "inset" | "underline";
};

export function Tabs({ id, label, tabs, initialId, value, onChange,
  activation = "automatic", variant = "inset" }: TabsProps) {
  const [internal, setInternal] = useState(initialId ?? tabs.find(tab => !tab.disabled)?.id);
  const selected = value ?? internal;
  const [focused, setFocused] = useState<string>();
  const enabled = tabs.filter(tab => !tab.disabled);
  const stop = activation === "manual" && enabled.some(tab => tab.id === focused) ? focused : selected;
  const select = (tab: TabItem) => { setInternal(tab.id); onChange?.(tab.id); };
  return h("div", { class: `lf-tabs lf-tabs--${variant}` },
    h("div", { role: "tablist", "aria-label": label, "aria-orientation": "horizontal" },
      tabs.map(tab => h("button", {
        key: tab.id, type: "button", role: "tab", id: `${id}-tab-${tab.id}`,
        "aria-controls": `${id}-panel-${tab.id}`, "aria-selected": selected === tab.id,
        tabIndex: stop === tab.id ? 0 : -1, disabled: tab.disabled,
        onFocus: () => setFocused(tab.id), onClick: () => select(tab),
        onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
          const index = enabled.indexOf(tab);
          let next: number;
          switch (event.key) {
            case "ArrowRight": next = (index + 1) % enabled.length; break;
            case "ArrowLeft": next = (index - 1 + enabled.length) % enabled.length; break;
            case "Home": next = 0; break;
            case "End": next = enabled.length - 1; break;
            default: return;
          }
          event.preventDefault(); event.stopPropagation();
          const target = enabled[next];
          if (!target) return;
          if (activation === "automatic") select(target);
          document.getElementById(`${id}-tab-${target.id}`)?.focus();
        },
      }, tab.icon, tab.label))),
    tabs.map(tab => h("section", {
      key: tab.id, id: `${id}-panel-${tab.id}`, role: "tabpanel",
      "aria-labelledby": `${id}-tab-${tab.id}`, hidden: selected !== tab.id, tabIndex: 0,
    }, tab.content)));
}
