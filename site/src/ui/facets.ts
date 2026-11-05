import { h } from "preact";

export type FacetGroup = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly { readonly id: string; readonly label: string; readonly count: number }[];
};

export function FacetPanel({ title, scope, groups, selected, onChange }: {
  readonly title: string;
  readonly scope: string;
  readonly groups: readonly FacetGroup[];
  readonly selected: Readonly<Record<string, readonly string[]>>;
  readonly onChange: (group: string, values: readonly string[]) => void;
}) {
  return h("aside", { class: "ui-facets", "aria-label": title },
    h("p", { class: "note" }, scope),
    groups.map(group => h("fieldset", { key: group.id },
      h("legend", null, group.label),
      group.values.map(value => {
        const chosen = selected[group.id] ?? [];
        return h("label", { class: "ui-choice", key: value.id },
          h("input", { type: "checkbox", checked: chosen.includes(value.id),
            onChange: () => onChange(group.id, chosen.includes(value.id)
              ? chosen.filter(id => id !== value.id) : [...chosen, value.id]) }),
          h("span", null, value.label), h("span", { class: "ui-facet-count" }, value.count));
      }))));
}
