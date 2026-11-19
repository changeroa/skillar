import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { iconMarkup } from "../../shared/dist/icons.js";

const page = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
// 정적 HTML의 인라인 아이콘은 공통 아이콘 맵(shared/icons.ts)과 항상 같아야 한다.
// 같은 뜻=같은 아이콘 약속이 파일 하나에서 나오는지 고정하는 회귀 테스트다.
const expectIcon = (html, name, context) => {
  assert.ok(html.includes(iconMarkup(name)), `${context}: ${name} 아이콘이 공통 맵의 마크업과 달라졌습니다`);
};

test("connections page static icons come from the shared icon map", () => {
  const html = page("connections/index.html");
  expectIcon(html, "clock", "사이드바 세션");
  expectIcon(html, "layout-grid", "사이드바 스킬");
  expectIcon(html, "plug", "사이드바 연결");
  expectIcon(html, "search", "이동 버튼");
  expectIcon(html, "copy", "명령 복사");
  expectIcon(html, "log-out", "로그아웃");
  expectIcon(html, "key-round", "개인 액세스 토큰 만들기");
  expectIcon(html, "chevron-right", "공개 화살표");
  expectIcon(html, "monitor", "테마 시스템");
  expectIcon(html, "sun", "테마 라이트");
  expectIcon(html, "moon", "테마 다크");
});

test("icon-only controls keep an accessible name and matching tooltip", () => {
  const html = page("connections/index.html");
  for (const match of html.matchAll(/<button[^>]*class="[^"]*icon-button[^"]*"[^>]*>/g)) {
    const tag = match[0];
    const label = /aria-label="([^"]+)"/.exec(tag)?.[1];
    const title = /title="([^"]+)"/.exec(tag)?.[1];
    assert.ok(label, `아이콘만 남은 버튼에 aria-label이 없습니다: ${tag}`);
    assert.equal(title, label, `툴팁이 aria-label과 다릅니다: ${tag}`);
  }
  const jump = /(<button id="app-jump"[^>]*>)/.exec(html)?.[1] ?? "";
  assert.match(jump, /aria-label="이동…"/);
  assert.match(jump, /title="이동…"/);
});

test("landing, login and 404 static icons come from the shared icon map", () => {
  const landing = page("index.html");
  expectIcon(landing, "user", "예시 카드 세션 요청");
  expectIcon(landing, "book-open", "예시 카드 검색/읽기");
  expectIcon(landing, "file-text", "예시 카드 기록");
  expectIcon(landing, "arrow-up-right", "소스/문서 링크");
  const login = page("login/index.html");
  expectIcon(login, "arrow-left", "skillar로 돌아가기");
  expectIcon(login, "arrow-up-right", "문서 링크");
  expectIcon(login, "shield", "계정 정보와 기록 범위");
  expectIcon(login, "arrow-right", "Google로 계속하기");
  expectIcon(page("404.html"), "house", "홈으로");
});
