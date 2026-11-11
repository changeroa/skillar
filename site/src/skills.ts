import "./main.ts";
import "./skills/skills.css";
import "./ui/ui.css";
import "./skills/hosted-skills.css";
import { h, render } from "preact";
import { SkillsApp } from "./skills/app.ts";

const root = document.getElementById("skills-app");
if (root === null) throw new Error("The skills page has no #skills-app element.");
const mount = root;
let controller: AbortController | null = null;

function boot(): void {
  controller?.abort();
  controller = new AbortController();
  render(h(SkillsApp, { signal: controller.signal }), mount);
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
