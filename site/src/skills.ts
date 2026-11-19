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

// 구 읽기 근거 탭은 독립 세션 화면(/sessions/)으로 옮겼다. 이 페이지는 게시 스킬만 마운트한다
// (?tab=evidence와 #/ 해시는 index.html의 인라인 스크립트가 /sessions/로 보낸다).
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
