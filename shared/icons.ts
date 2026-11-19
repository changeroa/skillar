/**
 * skillar 공통 아이콘 맵. 모든 화면(로컬 대시보드, 호스팅 연결, 정적 페이지)이
 * 같은 뜻에 같은 아이콘을 쓰도록 하는 단일 소스다.
 *
 * lucide 항목은 lucide-react v1.75.0(node_modules/lucide-react/dist/esm/icons/*.mjs의
 * __iconData.node)에서 추출한 SVG 노드 데이터다. 스타일은 lucide와 같다:
 * 24x24, fill none, stroke currentColor, stroke-width 2, linecap/linejoin round.
 * legacy 항목은 대시보드 기존 자체 아이콘을 같은 형식으로 옮긴 것이다.
 */

export interface IconNode {
  readonly tag: "path" | "circle" | "rect" | "line" | "polyline" | "polygon";
  readonly attrs: Readonly<Record<string, string>>;
}

export const iconNodes = {
  "clock": [
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M12 6v6l4 2"
      }
    }
  ],
  "layout-grid": [
    {
      "tag": "rect",
      "attrs": {
        "width": "7",
        "height": "7",
        "x": "3",
        "y": "3",
        "rx": "1"
      }
    },
    {
      "tag": "rect",
      "attrs": {
        "width": "7",
        "height": "7",
        "x": "14",
        "y": "3",
        "rx": "1"
      }
    },
    {
      "tag": "rect",
      "attrs": {
        "width": "7",
        "height": "7",
        "x": "14",
        "y": "14",
        "rx": "1"
      }
    },
    {
      "tag": "rect",
      "attrs": {
        "width": "7",
        "height": "7",
        "x": "3",
        "y": "14",
        "rx": "1"
      }
    }
  ],
  "book-open": [
    {
      "tag": "path",
      "attrs": {
        "d": "M12 5v16"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"
      }
    }
  ],
  "search": [
    {
      "tag": "path",
      "attrs": {
        "d": "m21 21-4.34-4.34"
      }
    },
    {
      "tag": "circle",
      "attrs": {
        "cx": "11",
        "cy": "11",
        "r": "8"
      }
    }
  ],
  "user": [
    {
      "tag": "path",
      "attrs": {
        "d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
      }
    },
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "7",
        "r": "4"
      }
    }
  ],
  "arrow-up-right": [
    {
      "tag": "path",
      "attrs": {
        "d": "M7 7h10v10"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M7 17 17 7"
      }
    }
  ],
  "external-link": [
    {
      "tag": "path",
      "attrs": {
        "d": "M15 3h6v6"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M10 14 21 3"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      }
    }
  ],
  "minus": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 12h14"
      }
    }
  ],
  "circle-check": [
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m16 9-5.5 5.5L8 12"
      }
    }
  ],
  "circle-x": [
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m15 9-6 6"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m9 9 6 6"
      }
    }
  ],
  "list": [
    {
      "tag": "path",
      "attrs": {
        "d": "M3 5h.01"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M3 12h.01"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M3 19h.01"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M8 5h13"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M8 12h13"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M8 19h13"
      }
    }
  ],
  "funnel": [
    {
      "tag": "path",
      "attrs": {
        "d": "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"
      }
    }
  ],
  "calendar": [
    {
      "tag": "path",
      "attrs": {
        "d": "M8 2v3"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M16 2v3"
      }
    },
    {
      "tag": "rect",
      "attrs": {
        "x": "3",
        "y": "3",
        "width": "18",
        "height": "18",
        "rx": "2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M3 9h18"
      }
    }
  ],
  "terminal": [
    {
      "tag": "path",
      "attrs": {
        "d": "M12 19h8"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m4 17 6-6-6-6"
      }
    }
  ],
  "plug": [
    {
      "tag": "path",
      "attrs": {
        "d": "M12 22v-5"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M15 8V2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M9 8V2"
      }
    }
  ],
  "copy": [
    {
      "tag": "rect",
      "attrs": {
        "width": "14",
        "height": "14",
        "x": "8",
        "y": "8",
        "rx": "2",
        "ry": "2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
      }
    }
  ],
  "key-round": [
    {
      "tag": "path",
      "attrs": {
        "d": "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
      }
    },
    {
      "tag": "circle",
      "attrs": {
        "cx": "16.5",
        "cy": "7.5",
        "r": ".5",
        "fill": "currentColor"
      }
    }
  ],
  "shield-check": [
    {
      "tag": "path",
      "attrs": {
        "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m9 12 2 2 4-4"
      }
    }
  ],
  "shield": [
    {
      "tag": "path",
      "attrs": {
        "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
      }
    }
  ],
  "eye": [
    {
      "tag": "path",
      "attrs": {
        "d": "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
      }
    },
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "12",
        "r": "3"
      }
    }
  ],
  "eye-off": [
    {
      "tag": "path",
      "attrs": {
        "d": "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M14.084 14.158a3 3 0 0 1-4.242-4.242"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m2 2 20 20"
      }
    }
  ],
  "chevron-right": [
    {
      "tag": "path",
      "attrs": {
        "d": "m9 18 6-6-6-6"
      }
    }
  ],
  "chevron-down": [
    {
      "tag": "path",
      "attrs": {
        "d": "m6 9 6 6 6-6"
      }
    }
  ],
  "sun": [
    {
      "tag": "circle",
      "attrs": {
        "cx": "12",
        "cy": "12",
        "r": "4"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M12 2v2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M12 20v2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m4.93 4.93 1.41 1.41"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m17.66 17.66 1.41 1.41"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M2 12h2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M20 12h2"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m6.34 17.66-1.41 1.41"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m19.07 4.93-1.41 1.41"
      }
    }
  ],
  "moon": [
    {
      "tag": "path",
      "attrs": {
        "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      }
    }
  ],
  "monitor": [
    {
      "tag": "rect",
      "attrs": {
        "width": "20",
        "height": "14",
        "x": "2",
        "y": "3",
        "rx": "2"
      }
    },
    {
      "tag": "line",
      "attrs": {
        "x1": "8",
        "x2": "16",
        "y1": "21",
        "y2": "21"
      }
    },
    {
      "tag": "line",
      "attrs": {
        "x1": "12",
        "x2": "12",
        "y1": "17",
        "y2": "21"
      }
    }
  ],
  "log-out": [
    {
      "tag": "path",
      "attrs": {
        "d": "m16 17 5-5-5-5"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M21 12H9"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
      }
    }
  ],
  "plus": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 12h14"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M12 5v14"
      }
    }
  ],
  "house": [
    {
      "tag": "path",
      "attrs": {
        "d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
      }
    }
  ],
  "file-text": [
    {
      "tag": "path",
      "attrs": {
        "d": "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M14 2v5a1 1 0 0 0 1 1h5"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M10 9H8"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M16 13H8"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M16 17H8"
      }
    }
  ],
  "arrow-left": [
    {
      "tag": "path",
      "attrs": {
        "d": "m12 19-7-7 7-7"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "M19 12H5"
      }
    }
  ],
  "arrow-right": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 12h14"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m12 5 7 7-7 7"
      }
    }
  ],
  "x": [
    {
      "tag": "path",
      "attrs": {
        "d": "M18 6 6 18"
      }
    },
    {
      "tag": "path",
      "attrs": {
        "d": "m6 6 12 12"
      }
    }
  ],
  "check": [
    {
      "tag": "path",
      "attrs": {
        "d": "M20 6 9 17l-5-5"
      }
    }
  ],
  "flow": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 3v12a4 4 0 0 0 4 4h10M5 7h10a4 4 0 0 1 4 4v8M2 3h6M16 16l3 3 3-3"
      }
    }
  ],
  "workspaces": [
    {
      "tag": "path",
      "attrs": {
        "d": "M3 7h7l2-3h9v16H3z"
      }
    }
  ],
  "activity": [
    {
      "tag": "path",
      "attrs": {
        "d": "M3 12h4l3-8 4 16 3-8h4"
      }
    }
  ],
  "columns": [
    {
      "tag": "path",
      "attrs": {
        "d": "M3 3h18v18H3zM9 3v18M15 3v18"
      }
    }
  ],
  "density": [
    {
      "tag": "path",
      "attrs": {
        "d": "M4 6h16M4 10h16M4 14h16M4 18h16"
      }
    }
  ],
  "sort": [
    {
      "tag": "path",
      "attrs": {
        "d": "m8 4-3 3-3-3M5 4v16m11 0 3-3 3 3M19 4v16"
      }
    }
  ],
  "tree": [
    {
      "tag": "path",
      "attrs": {
        "d": "M4 4v12a2 2 0 0 0 2 2h6M4 10h8M12 4h8M12 10h8M12 18h8"
      }
    }
  ],
  "timeline": [
    {
      "tag": "path",
      "attrs": {
        "d": "M4 3v18M8 5h9v4H8zM12 13h9v4h-9z"
      }
    }
  ],
  "graph": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 5h4v4H5zM15 15h4v4h-4zM9 7h8v8M7 9v8h8"
      }
    }
  ],
  "file": [
    {
      "tag": "path",
      "attrs": {
        "d": "M14 2H4v20h16V8zM14 2v6h6"
      }
    }
  ],
  "model": [
    {
      "tag": "path",
      "attrs": {
        "d": "M4 8h16v12H4zM9 12v2M15 12v2M9 17h6M12 8V3M10 3h4M1 12h3M20 12h3"
      }
    }
  ],
  "tool": [
    {
      "tag": "path",
      "attrs": {
        "d": "M14.7 6.3a5 5 0 0 0-6.4 6.4L2 19l3 3 6.3-6.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z"
      }
    }
  ],
  "error": [
    {
      "tag": "path",
      "attrs": {
        "d": "m12 3 10 18H2zM12 9v4M12 17h.01"
      }
    }
  ],
  "play": [
    {
      "tag": "path",
      "attrs": {
        "d": "m7 4 14 8-14 8z"
      }
    }
  ],
  "stop": [
    {
      "tag": "path",
      "attrs": {
        "d": "M5 5h14v14H5z"
      }
    }
  ],
  "native": [
    {
      "tag": "path",
      "attrs": {
        "d": "m13 2-9 12h7l-1 8 10-13h-7z"
      }
    }
  ],
  "braces": [
    {
      "tag": "path",
      "attrs": {
        "d": "M8 3H6v6l-3 3 3 3v6h2M16 3h2v6l3 3-3 3v6h-2"
      }
    }
  ],
  "previous": [
    {
      "tag": "path",
      "attrs": {
        "d": "M6 10l6-6 6 6M12 4v16"
      }
    }
  ],
  "next": [
    {
      "tag": "path",
      "attrs": {
        "d": "M6 14l6 6 6-6M12 4v16"
      }
    }
  ]
} as const satisfies Record<string, readonly IconNode[]>;

export type SkillarIcon = keyof typeof iconNodes;

/** svg 안쪽 마크업만 반환한다. 정적 데이터이므로 innerHTML에 넣어도 안전하다. */
export function iconMarkup(name: SkillarIcon): string {
  return iconNodes[name]
    .map((node) => {
      const attrs = Object.entries(node.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${node.tag} ${attrs}/>`;
    })
    .join("");
}

/** 완성된 <svg> 문자열. 바닐라 TS(연결 화면 등)에서 innerHTML로 넣을 때 쓴다. */
export function iconSvg(
  name: SkillarIcon,
  options: { readonly size?: number; readonly className?: string; readonly decorative?: boolean } = {},
): string {
  const size = options.size ?? 16;
  const cls = options.className ? ` class="${options.className}"` : "";
  const a11y = options.decorative === false ? ' role="img"' : ' aria-hidden="true" focusable="false"';
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24"${a11y} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(name)}</svg>`;
}
