import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "../../../local/dashboard/design/skillar-theme/dist/theme.css";
import "../../../local/dashboard/styles.css";
import { render } from "../react-mount";
import "./embed.css";
import "../main";
import {} from "react";
import { Dashboard } from "./app";

const root = document.getElementById("dashboard-app");
if (root === null) throw new Error("The dashboard page has no #dashboard-app element.");
const mount = root;
let controller: AbortController | null = null;

function boot(): void {
  controller?.abort();
  controller = new AbortController();
  render(<Dashboard signal={controller.signal} />, mount);
}

function clear(): void {
  controller?.abort();
  controller = null;
  render(null, mount);
}

addEventListener("pagehide", clear);
addEventListener("pageshow", event => {
  if (event.persisted) boot();
});
boot();
