import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const page = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

// 세션 화면은 독립 /sessions/ 페이지다. /skills의 구 읽기 근거 탭 경로(?tab=evidence, #/ 해시)는
// /sessions/로 리다이렉트하고, 현재 메뉴는 시각·보조기술 모두에서 구분되어야 한다.
test("skills page redirects legacy evidence routes to /sessions/ and marks the current menu", () => {
  const html = page("skills/index.html");
  assert.ok(!html.includes('id="skills-tab-evidence"'), "읽기 근거 탭 링크가 남아 있으면 안 됩니다");
  assert.ok(html.includes('location.replace("/sessions/"'), "구 읽기 근거 경로를 /sessions/로 리다이렉트해야 합니다");
  assert.ok(html.includes('<a href="/skills/" aria-current="page">'), "스킬 메뉴가 현재 페이지로 표시되어야 합니다");
});

test("sessions page mounts the embedded view and marks the current menu", () => {
  const html = page("sessions/index.html");
  assert.ok(html.includes('id="sessions-app"'), "세션 앱 루트가 필요합니다");
  assert.ok(html.includes('<a href="/sessions/" aria-current="page">'), "세션 메뉴가 현재 페이지로 표시되어야 합니다");
  const css = page("src/account.css");
  assert.ok(css.includes('[aria-current="page"]'), "현재 메뉴의 시각 구분 규칙이 필요합니다");
});
