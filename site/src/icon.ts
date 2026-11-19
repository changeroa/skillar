import {createElement as h} from "react";
import { iconMarkup, type SkillarIcon } from "../../shared/dist/icons.js";

// 공통 아이콘 맵(shared/icons.ts)의 React 렌더러. 아이콘은 장식으로만 쓴다:
// 뜻은 나란히 있는 텍스트나 aria-label이 담당한다.
export const iconEl = (name: SkillarIcon, size = 16, className = "icon") =>
  h("svg", { className, width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false",
    fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
    dangerouslySetInnerHTML: { __html: iconMarkup(name) } });
