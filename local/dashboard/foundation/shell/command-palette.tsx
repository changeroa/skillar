import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Dialog } from "../overlays/dialog";
import { Input } from "../controls/fields";

export type Command = {
  readonly id: string; readonly label: string; readonly onSelect: () => void;
  readonly icon?: ComponentChildren; readonly disabled?: boolean;
};

/** Exactly one caller owns visibility and the global shortcut subscription. */
export function CommandPalette({ id, commands, onClose }: {
  readonly id: string; readonly commands: readonly Command[]; readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const choices = commands.filter(item => item.label.toLocaleLowerCase("ko").includes(query.trim().toLocaleLowerCase("ko")));
  const enabled = choices.filter(item => !item.disabled);
  const current = enabled[active];
  return <Dialog id={id} open title="화면 이동" size="command" onClose={onClose} initialFocusId={`${id}-input`}>
    <div class="lf-command">
      <Input id={`${id}-input`} label="이동할 화면" type="text" role="combobox" variant="command"
        aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={current ? `${id}-option-${current.id}` : undefined}
        autoComplete="off" placeholder="화면 이름 검색" value={query}
        onInput={event => { setQuery(event.currentTarget.value); setActive(0); }}
        onKeyDown={event => {
          if (event.isComposing) return;
          let next: number;
          switch (event.key) {
            case "ArrowDown": next = active + 1; break;
            case "ArrowUp": next = active - 1; break;
            case "Home": next = 0; break;
            case "End": next = enabled.length - 1; break;
            case "Enter":
              event.preventDefault(); event.stopPropagation();
              if (current) { onClose(); current.onSelect(); }
              return;
            default: return;
          }
          event.preventDefault(); event.stopPropagation();
          const index = enabled.length ? (next + enabled.length) % enabled.length : 0;
          setActive(index);
          const option = enabled[index];
          if (option) document.getElementById(`${id}-option-${option.id}`)?.scrollIntoView({ block: "nearest" });
        }} />
      <div id={`${id}-list`} role="listbox" aria-label="이동할 화면">
        {choices.length > 0 && <div class="lf-command__items" role="group" aria-label="이동">
        <div class="lf-command__group" aria-hidden="true">이동</div>
        {choices.map(item => <button key={item.id} id={`${id}-option-${item.id}`} type="button"
          role="option" tabIndex={-1} disabled={item.disabled} aria-selected={item === current}
          onPointerMove={() => { if (!item.disabled) setActive(enabled.indexOf(item)); }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { onClose(); item.onSelect(); }}>{item.icon}<span>{item.label}</span></button>)}
        </div>}
        {!choices.length && <p role="status" class="lf-command__empty">일치하는 화면이 없습니다.</p>}
      </div>
    </div>
  </Dialog>;
}
