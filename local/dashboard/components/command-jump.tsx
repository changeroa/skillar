import type { Route, View } from "../state";
import { Icon, type IconName } from "./icons";
import { CommandPalette } from "../foundation/shell/command-palette";

export const DESTINATIONS: readonly { view: View; label: string; icon: IconName; group: string }[] = [
  { view: "sessions", label: "세션", icon: "sessions", group: "관찰" },
  { view: "dashboard", label: "대시보드", icon: "dashboard", group: "분석" },
  { view: "flow", label: "흐름", icon: "flow", group: "분석" },
  { view: "workspaces", label: "작업 공간", icon: "workspaces", group: "분석" },
  { view: "heatmap", label: "활동", icon: "activity", group: "분석" },
];

export function destination(route: Route, view: View): Route {
  return { ...route, view, sessionId: undefined, flowId: undefined, peek: undefined, event: undefined };
}

export function CommandJump({ route, navigate, close }: {
  readonly route: Route; readonly navigate: (next: Route) => void; readonly close: () => void;
}) {
  return <CommandPalette id="pe-command" onClose={close} commands={DESTINATIONS.map(item => ({
    id: item.view, label: item.label, icon: <Icon name={item.icon} />,
    onSelect: () => navigate(destination(route, item.view)),
  }))} />;
}
