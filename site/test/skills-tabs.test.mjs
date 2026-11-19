import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const page = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

// /skills 탭(게시 스킬/읽기 근거)은 현재 탭이 시각·보조기술 모두에서 구분되어야 한다(실인증 리뷰 c).
test("skills tabs expose a selected state: aria-current in JS and a distinct visual rule in CSS", () => {
  const html = page("skills/index.html");
  assert.ok(html.includes('id="skills-tab-posts"') && html.includes('id="skills-tab-evidence"'), "탭 링크 두 개가 있어야 합니다");
  const js = page("src/skills.ts");
  assert.ok(js.includes('setAttribute("aria-current", "page")'), "skills.ts가 활성 탭에 aria-current를 설정해야 합니다");
  const css = page("src/account.css");
  assert.ok(css.includes(".skills-tabs a.button[aria-current=\"page\"]"), "선택된 탭의 시각 구분 규칙이 필요합니다");
});
