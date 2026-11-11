import assert from "node:assert/strict";
import test from "node:test";
import { all, byTag, loadViews, mount } from "./helpers/t10-dom.mjs";

const { MarkdownViewer } = await loadViews('export * from "./local/dashboard/foundation/viewers/index.ts";');

const allowedTags = new Set(["div", "h3", "p", "em", "ul", "ol", "li", "section", "header", "span", "button", "pre", "code", "svg", "path", "rect"]);
const linkAttributes = ["href", "src", "srcdoc", "action", "formaction", "xlink:href", "style"];

/** Every element the viewer produced, excluding the mount container. */
const rendered = container => all(container, node => node !== container);
const eventHandlers = container => rendered(container)
  .flatMap(node => [...node.attributes.keys()].filter(name => name.startsWith("on")));

test("hostile HTML blocks stay literal text with no executable elements or attributes", async t => {
  // Given
  const text = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"><script>alert(2)</script></svg>',
    '<iframe src="javascript:alert(1)" srcdoc="<script>alert(1)</script>"></iframe>',
    "<style>body{display:none}</style>",
    '<object data="data:text/html,<script>alert(1)</script>"></object><embed src=x>',
    '<form action="javascript:alert(1)"><button formaction=x>go</button></form>',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><link rel=stylesheet href=x>',
  ].join("\n\n");
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.deepEqual(rendered(container).map(node => node.localName).filter(tag => !allowedTags.has(tag)), []);
  assert.deepEqual(byTag(container, "svg").length + byTag(container, "button").length, 0);
  assert.deepEqual(eventHandlers(container), []);
  for (const block of text.split("\n\n")) assert.ok(container.textContent.includes(block), block);
});

test("inline HTML, entities and style injection inside prose stay literal", async t => {
  // Given
  const text = 'Hello <b onmouseover="alert(1)">bold</b> &lt;i&gt; &amp;amp; &#60;script&#62; <span style="position:fixed">x</span>';
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.deepEqual(rendered(container).map(node => node.localName), ["div", "p"]);
  assert.equal(byTag(container, "p")[0].textContent, text);
  assert.deepEqual(eventHandlers(container), []);
});

test("links of every protocol render as text, never as navigable elements", async t => {
  // Given
  const text = [
    "[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](data:text/html;base64,PHNjcmlwdD4=)",
    "[d](vbscript:msgbox(1)) [e](//evil.example) [f](https://example.com)",
    "<javascript:alert(1)> <https://example.com> ![img](https://example.com/x.png)",
  ].join("\n\n");
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.equal(byTag(container, "a").length + byTag(container, "img").length, 0);
  assert.deepEqual(rendered(container).filter(node => linkAttributes.some(name => node.hasAttribute(name))), []);
  assert.ok(container.textContent.includes("[a](javascript:alert(1))"));
});

test("hostile fence info strings render as escaped labels, including prototype keys", async t => {
  // Given
  const languages = ["__proto__", "constructor", "extend", '"><img src=x onerror=alert(1)>'];
  const text = languages.map(language => `\`\`\`${language}\nx = 1\n\`\`\``).join("\n\n");
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.deepEqual(byTag(container, "section").map(node => node.getAttribute("data-language")), languages.map(value => value.toLowerCase()));
  assert.deepEqual(byTag(container, "header").map(node => byTag(node, "span")[0].textContent), languages);
  assert.deepEqual(byTag(container, "code").map(node => node.textContent), languages.map(() => "x = 1"));
  assert.equal(byTag(container, "img").length, 0);
});

test("an emphasis bomb of unclosed openers renders literally without a quadratic scan", { timeout: 5000 }, async t => {
  // Given
  const text = `${"_a ".repeat(150_000)}${"*a ".repeat(150_000)}${"_a *a ".repeat(1000)}_*_*_*x*_*_*_`;
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  assert.equal(byTag(container, "p")[0].textContent.length, text.length);
  assert.ok(byTag(container, "em").length <= 1);
});

test("very deep list nesting is capped while every item is kept", { timeout: 5000 }, async t => {
  // Given
  const text = Array.from({ length: 2000 }, (_, depth) => `${" ".repeat(depth)}- item ${depth}`).join("\n");
  // When
  const { container } = await mount(t, MarkdownViewer, { text });
  // Then
  const depthOf = node => node.parentNode === container ? 0 : (["ul", "ol"].includes(node.localName) ? 1 : 0) + depthOf(node.parentNode);
  assert.equal(byTag(container, "li").length, 2000);
  assert.equal(Math.max(...byTag(container, "ul").map(depthOf)), 16);
});
