import {createElement as h} from "react";
import { TableFacet } from "../../../local/dashboard/foundation/table/facets";

export type FacetGroup = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly { readonly id: string; readonly label: string; readonly count: number }[];
  /** 설정하면 선택지 대신 한 줄 안내를 보여 주는 비활성 그룹. */
  readonly disabledNote?: string;
};

export function FacetPanel({ title, scope, groups, selected, onChange }: {
  readonly title: string;
  readonly scope?: string;
  readonly groups: readonly FacetGroup[];
  readonly selected: Readonly<Record<string, readonly string[]>>;
  readonly onChange: (group: string, values: readonly string[]) => void;
}) {
  return h("aside", { className: "ui-facets lf-facet-panel", "aria-label": title },
    scope !== undefined && h("p", { className: "note" }, scope),
    groups.map(group => group.disabledNote !== undefined
      ? h("fieldset", { key: group.id, className: "lf-facet", disabled: true },
        h("legend", null, h("span", { className: "lf-facet-heading" }, group.label)),
        h("p", { className: "note" }, group.disabledNote))
      : h(TableFacet<string>, {
        key: group.id, label: group.label,
        choices: group.values.map(value => ({ value: value.id, label: value.label, count: value.count })),
        selected: selected[group.id] ?? [], change: values => onChange(group.id, values ?? []),
      })));
}
