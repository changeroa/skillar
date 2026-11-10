import { useId } from "preact/hooks";
import { DropdownMenu } from "../overlays/menu";
import { tableStyles } from "./styles";

export function ColumnVisibility({ columns, hidden, onChange, onReset, allowEmpty = false }: {
  readonly columns: readonly { readonly id: string; readonly label: string; readonly hideable?: boolean }[];
  readonly hidden: readonly string[]; readonly onChange: (hidden: readonly string[]) => void;
  readonly onReset?: () => void; readonly allowEmpty?: boolean;
}) {
  tableStyles();
  const id = useId();
  const visible = columns.filter(column => !hidden.includes(column.id));
  return <DropdownMenu id={`columns-${id}`} label={`열 ${visible.length}/${columns.length}`} buttonIcon="columns" width="wide"
    items={[...columns.map(column => ({
      id: column.id, label: column.label, checked: !hidden.includes(column.id),
      disabled: column.hideable === false || (!allowEmpty && visible.length === 1 && visible[0]?.id === column.id),
      onSelect: () => onChange(hidden.includes(column.id) ? hidden.filter(value => value !== column.id) : [...hidden, column.id]),
    })), ...(onReset ? [{ id: "restore", label: "기본 열 복원", separatorBefore: true, onSelect: onReset }] : [])]} />;
}

export const TABLE_DENSITIES = [
  { value: "compact", label: "촘촘하게" }, { value: "normal", label: "보통 간격" }, { value: "spacious", label: "넓은 간격" },
] as const;

export function TableDensity({ value, onChange, comfortable = false }: {
  readonly value: string; readonly onChange: (value: string) => void; readonly comfortable?: boolean;
}) {
  const id = useId();
  return <DropdownMenu id={`density-${id}`} label="행 간격" heading="행 간격" checkPosition="start" icon="rows"
    items={TABLE_DENSITIES.map(option => {
      const next = comfortable && option.value === "spacious" ? "comfortable" : option.value;
      return { id: next, label: option.label, checked: value === next, onSelect: () => onChange(next) };
    })} />;
}
