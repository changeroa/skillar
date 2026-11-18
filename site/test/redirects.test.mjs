import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Cloudflare Pages _redirects: [source] [destination] [code?], code는 숫자만.
// 지원하지 않는 토큰(예: Netlify식 "301!")이 섞인 줄은 배포 시 통째로 무시된다.
const CODES = new Set(["200", "301", "302", "303", "307", "308"]);

async function rules() {
  const text = await readFile(new URL("../public/_redirects", import.meta.url), "utf8");
  return text.split(/\r?\n/).map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    .map(line => line.split(/\s+/));
}

test("every _redirects line follows the Cloudflare Pages syntax", async () => {
  for (const tokens of await rules()) {
    assert.ok(tokens.length === 2 || tokens.length === 3, `token count: ${tokens.join(" ")}`);
    const [source, destination, code] = tokens;
    assert.ok(source.startsWith("/"), `source must be a path: ${source}`);
    assert.ok(!source.includes("#"), `fragments are not evaluated in source: ${source}`);
    assert.ok(destination.startsWith("/") || destination.startsWith("https://") || destination.startsWith("http://"), `destination: ${destination}`);
    if (code !== undefined) assert.ok(CODES.has(code), `unsupported status token: ${code}`);
  }
});

test("/connect and everything under it permanently redirect to /connections/", async () => {
  const all = await rules();
  const plain = all.findIndex(([s, d, c]) => s === "/connect" && d === "/connections/" && c === "301");
  const nested = all.findIndex(([s, d, c]) => s === "/connect/*" && d === "/connections/" && c === "301");
  assert.notEqual(plain, -1, "/connect rule missing");
  assert.notEqual(nested, -1, "/connect/* rule missing");
  assert.ok(plain < nested, "the static rule must precede the splat rule");
});
