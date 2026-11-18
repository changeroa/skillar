import "./main.ts";
import { render } from "./react-mount";
import "./skills/skills.css";
import "./ui/ui.css";
import "./skills/hosted-skills.css";
import {createElement as h} from "react";
import { SkillsApp } from "./skills/app.ts";

const root = document.getElementById("skills-app");
if (root === null) throw new Error("The skills page has no #skills-app element.");
const mount = root;
let controller: AbortController | null = null;

// 읽기 근거 탭(원문82): /skills/?tab=evidence 또는 #/ 해시는 구 대시보드 임베드가
// src/dashboard/evidence.ts에서 마운트한다. 여기서는 게시 스킬 탭만 마운트한다.
function evidenceMode(): boolean {
  return new URLSearchParams(location.search).get("tab") === "evidence" || location.hash.startsWith("#/");
}

function boot(): void {
  controller?.abort();
  controller = new AbortController();
  const evidence = evidenceMode();
  if (evidence) document.getElementById("skills-tab-evidence")?.setAttribute("aria-current", "page");
  else document.getElementById("skills-tab-posts")?.setAttribute("aria-current", "page");
  render(evidence ? null : h(SkillsApp, { signal: controller.signal }), mount);
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
