import type { Route, View } from "../state";
import { Icon, type IconName } from "./icons";
import { CommandPalette } from "../foundation/shell/command-palette";

// 2차 declutter: 화면이 세션·스킬 둘로 좁혀져 그룹 구분이 사라졌다. 대시보드는 스킬 화면으로 재정의.
export const DESTINATIONS: readonly { view: View; label: string; icon: IconName }[] = [
  { view: "sessions", label: "세션", icon: "sessions" },
  { view: "dashboard", label: "스킬", icon: "dashboard" },
];

export function destination(route: Route, view: View): Route {
  return { ...route, view, sessionId: undefined, peek: undefined, event: undefined };
}

export function CommandJump({ route, navigate, close }: {
  readonly route: Route; readonly navigate: (next: Route) => void; readonly close: () => void;
}) {
  return <CommandPalette id="pe-command" onClose={close} commands={DESTINATIONS.map(item => ({
    id: item.view, label: item.label, icon: <Icon name={item.icon} />,
    onSelect: () => navigate(destination(route, item.view)),
  }))} />;
}
