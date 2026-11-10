import { render } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { CommandPalette } from "../../local/dashboard/foundation/shell/command-palette";

const destinations = [
  ["dashboard", "대시보드", "/dashboard/"],
  ["sessions", "세션", "/dashboard/#/sessions"],
  ["skills", "스킬", "/skills/"],
  ["connections", "연결", "/connections/"],
  ["account", "계정", "/login/"],
] as const;

let disposePalette: (() => void) | undefined;

export function mountCommandPalette(opener: HTMLButtonElement): () => void {
  disposePalette?.();
  const mount = document.createElement("div");
  mount.setAttribute("data-command-mount", "true");
  document.body.append(mount);
  function Palette() {
    const [open, setOpen] = useState(false);
    useLayoutEffect(() => {
      const show = () => {
        if (!document.body.classList.contains("app-shell")) return;
        const drawer = document.querySelector<HTMLDialogElement>("#app-drawer");
        if (drawer?.open) {
          drawer.close();
          document.querySelector("#app-menu")?.setAttribute("aria-expanded", "false");
        }
        setOpen(true);
      };
      const shortcut = (event: KeyboardEvent) => {
        if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" ||
          !document.body.classList.contains("app-shell")) return;
        event.preventDefault(); setOpen(value => !value);
      };
      opener.addEventListener("click", show);
      window.addEventListener("keydown", shortcut);
      return () => {
        opener.removeEventListener("click", show);
        window.removeEventListener("keydown", shortcut);
      };
    }, []);
    return open ? <CommandPalette id="app-command" onClose={() => setOpen(false)} commands={
      destinations.map(([id, label, href]) => ({ id, label, onSelect: () => window.location.assign(href) }))
    } /> : null;
  }
  render(<Palette />, mount);
  const dispose = () => {
    render(null, mount); mount.remove();
    if (disposePalette === dispose) disposePalette = undefined;
  };
  disposePalette = dispose;
  return dispose;
}
