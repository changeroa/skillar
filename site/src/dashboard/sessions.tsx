// 독립 세션 화면(/sessions/): 구 읽기 근거 탭의 LocalViews 임베드를 그대로 재사용한다.
// 기본 화면은 세션 목록(#/sessions)이다. 행 단위 데이터 병합은 후속 PR.
import "@astryxdesign/core/reset.css";
import "./astryx-source.css";
import "../../../local/dashboard/design/skillar-theme/dist/theme.css";
import "../../../local/dashboard/styles.css";
import "./embed.css";
import {createElement as h} from "react";
import { render } from "../react-mount";
import { Dashboard } from "./app";

const root = document.getElementById("sessions-app");
// 기본 화면은 세션 목록: 해시가 없으면 #/sessions로 보낸다. #/dashboard 등 명시 해시는 그대로 존중한다.
if (!location.hash.startsWith("#/")) {
  history.replaceState(null, "", `${location.pathname}#/sessions`);
}
if (root !== null) {
  let controller: AbortController | null = null;
  const boot = (): void => {
    controller?.abort();
    controller = new AbortController();
    render(h(Dashboard, { signal: controller.signal, emptyView: "sessions" }), root);
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
