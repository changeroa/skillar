import { h } from "preact";
import { TableFacet } from "../../../local/dashboard/foundation/table/facets";

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
  return h("aside", { class: "ui-facets lf-facet-panel", "aria-label": title },
    h("p", { class: "note" }, scope),
    groups.map(group => h(TableFacet<string>, {
      key: group.id, label: group.label,
      choices: group.values.map(value => ({ value: value.id, label: value.label, count: value.count })),
      selected: selected[group.id] ?? [], change: values => onChange(group.id, values ?? []),
    })));
}
