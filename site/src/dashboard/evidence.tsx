// 읽기 근거 탭(원문82): /skills/?tab=evidence 또는 #/ 해시에서 구 대시보드의
// LocalViews 임베드를 그대로 재사용한다. 행 단위 데이터 병합은 후속 PR.
import "@astryxdesign/core/reset.css";
import "./astryx-source.css";
import "../../../local/dashboard/design/skillar-theme/dist/theme.css";
import "../../../local/dashboard/styles.css";
import "./embed.css";
import {createElement as h} from "react";
import { render } from "../react-mount";
import { Dashboard } from "./app";

const root = document.getElementById("skills-app");
// 읽기 근거 탭(원문82)의 기본 화면은 로컬 스킬 뷰(KPI 3 + 스킬·버전 표): 해시가 없으면 #/dashboard로 보낸다.
// #/sessions 등 명시 해시는 그대로 존중한다.
if (new URLSearchParams(location.search).get("tab") === "evidence" && !location.hash.startsWith("#/")) {
  history.replaceState(null, "", `${location.pathname}?tab=evidence#/dashboard`);
}
const evidence = new URLSearchParams(location.search).get("tab") === "evidence" || location.hash.startsWith("#/");
if (root !== null && evidence) {
  let controller: AbortController | null = null;
  const boot = (): void => {
    controller?.abort();
    controller = new AbortController();
    render(h(Dashboard, { signal: controller.signal }), root);
  };
  const clear = (): void => {
    controller?.abort();
    controller = null;
    render(null, root);
  };
  addEventListener("pagehide", clear);
  addEventListener("pageshow", event => { if (event.persisted) boot(); });
  boot();
}
