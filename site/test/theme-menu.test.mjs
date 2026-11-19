import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const page = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

// 테마 메뉴는 기본 닫힘: display 지정이 [hidden]의 UA 규칙을 덮어쓰는 회귀 방지(실인증 리뷰 d).
test("theme menu stays closed on load: hidden attribute beats the display rule", () => {
  for (const path of ["skills/index.html", "connections/index.html", "dashboard/index.html"]) {
    const html = page(path);
    assert.ok(html.includes('id="theme-menu"') && /id="theme-menu"[^>]*\shidden/.test(html), `${path}: theme-menu가 hidden으로 시작해야 합니다`);
  }
  const css = page("src/shell.css");
  assert.ok(css.includes(".theme-picker__menu[hidden]"), "shell.css에 [hidden] 우선 규칙이 필요합니다");
});
