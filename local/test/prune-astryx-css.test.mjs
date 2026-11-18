import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneAstryxCss } from "../dashboard/design/astryx-vendor/prune.mjs";

async function runPrune(t, { css, js = "", html = "" }) {
  const dir = await mkdtemp(join(tmpdir(), "prune-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cssPath = join(dir, "astryx.css");
  const outPath = join(dir, "out.css");
  const jsPath = join(dir, "bundle.js");
  const htmlPath = join(dir, "index.html");
  await writeFile(cssPath, css);
  await writeFile(jsPath, js);
  await writeFile(htmlPath, html);
  const stats = await pruneAstryxCss(cssPath, [jsPath], outPath, [htmlPath]);
  return { out: await readFile(outPath, "utf8"), stats };
}

const USED = `className: "xabc1234"`;

test("rules whose classes are all StyleX-atomic and unreferenced are pruned", async t => {
  const { out, stats } = await runPrune(t, {
    css: `.xabc1234 { color: red; }\n.xdef5678 { color: blue; }\n`,
    js: USED,
  });
  assert.ok(out.includes(".xabc1234"), "referenced atomic class kept");
  assert.ok(!out.includes(".xdef5678"), "unreferenced atomic class dropped");
  assert.equal(stats.dropped, 1);
  assert.equal(stats.kept, 1);
});

test("astryx-* hooks are pruning candidates like atomic hashes", async t => {
  const { out, stats } = await runPrune(t, {
    css: `.astryx-input-clear-button { color: red; }\n.xdef5678 { color: blue; }\n`,
    js: "",
  });
  assert.ok(!out.includes(".astryx-input-clear-button"), "unreferenced astryx hook pruned");
  assert.ok(!out.includes(".xdef5678"), "atomic class pruned");
  assert.equal(stats.dropped, 2);
});

test("a rule mixing preserved and unreferenced candidate classes is preserved", async t => {
  const { out } = await runPrune(t, {
    css: `.lf-tabs.xdef5678 { color: blue; }\n`,
    js: "",
  });
  assert.ok(out.includes(".lf-tabs.xdef5678"), "mixed rule kept whole");
});

test("dynamically composed lf-* classes are preserved even when unreferenced", async t => {
  const dynamic = ["lf-tabs", "lf-dialog", "lf-switch", "lf-avatar", "lf-select-wrap", "lf-field",
    "lf-gallery-text", "lf-gallery-radius", "lf-card", "lf-search"];
  const css = dynamic.map(name => `.${name} { color: red; }`).join("\n") + "\n";
  const { out, stats } = await runPrune(t, { css, js: "" });
  for (const name of dynamic) assert.ok(out.includes(`.${name} `), `${name} preserved`);
  assert.equal(stats.dropped, 0);
});

test("static-HTML-only shell classes are preserved even when unreferenced", async t => {
  const htmlOnly = ["app-shell", "hosted-screen", "app-topbar", "wordmark", "skip-link"];
  const css = htmlOnly.map(name => `.${name} { margin: 0; }`).join("\n") + "\n";
  const { out, stats } = await runPrune(t, { css, js: "", html: "" });
  for (const name of htmlOnly) assert.ok(out.includes(`.${name} `), `${name} preserved`);
  assert.equal(stats.dropped, 0);
});

test("rules without class selectors are always kept", async t => {
  const { out } = await runPrune(t, {
    css: `:root { --x-color: red; }\n[data-theme="dark"] .lf-surface { color: white; }\n`,
    js: "",
  });
  assert.ok(out.includes(":root"));
  assert.ok(out.includes('[data-theme="dark"] .lf-surface'));
});

test("an atomic class referenced only in static HTML survives", async t => {
  const { out } = await runPrune(t, {
    css: `.xabc1234 { color: red; }\n`,
    js: "",
    html: `<div class="xabc1234">static</div>`,
  });
  assert.ok(out.includes(".xabc1234"), "HTML-referenced atomic class kept");
});

test("a dropped rule is rescued when a kept rule consumes its custom property", async t => {
  const { out } = await runPrune(t, {
    css: `.xdef5678 { --x-gap: 8px; }\n.xabc1234 { gap: var(--x-gap); }\n`,
    js: USED,
  });
  assert.ok(out.includes("--x-gap: 8px"), "defining rule rescued for kept consumer");
});

test("keyframe animations are kept only while referenced by a kept rule", async t => {
  const css = `@keyframes spin { to { transform: rotate(360deg); } }\n` +
    `@keyframes fade { to { opacity: 0; } }\n` +
    `.xabc1234 { animation: spin 1s linear infinite; }\n`;
  const kept = await runPrune(t, { css, js: USED });
  assert.ok(kept.out.includes("@keyframes spin"), "used keyframes kept");
  assert.ok(!kept.out.includes("@keyframes fade"), "unused keyframes dropped");
  const dropped = await runPrune(t, { css, js: "" });
  assert.ok(!dropped.out.includes("@keyframes spin"), "keyframes dropped with their only consumer");
});

test("media blocks survive pruning of inner rules while one rule remains", async t => {
  const { out } = await runPrune(t, {
    css: `@media (min-width: 768px) {\n.xabc1234 { color: red; }\n.xdef5678 { color: blue; }\n}\n`,
    js: USED,
  });
  assert.ok(out.includes("@media (min-width: 768px)"));
  assert.ok(out.includes(".xabc1234"));
  assert.ok(!out.includes(".xdef5678"));
});

test("pruning refuses to write on unbalanced braces", async t => {
  const dir = await mkdtemp(join(tmpdir(), "prune-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cssPath = join(dir, "astryx.css");
  const outPath = join(dir, "out.css");
  const jsPath = join(dir, "bundle.js");
  await writeFile(cssPath, `.xabc1234 { color: red;\n`);
  await writeFile(jsPath, USED);
  await assert.rejects(
    pruneAstryxCss(cssPath, [jsPath], outPath),
    /unbalanced|brace/i,
    "unbalanced input fails the build");
});
