// Build-time pruning of Astryx StyleX stylesheets: keeps only the atomic
// classes actually referenced by the built JS/HTML, so the shipped CSS tracks
// the components in use instead of shipping every Astryx component's styles.
//
// StyleX compiles class names to static string literals in the JS output, so a
// substring scan of the emitted JS (plus static HTML entry points) is the
// reference set. Pruning is restricted to rules whose every class selector is
// a StyleX-atomic hash or astryx-* hook (the Astryx-owned families): lf-*
// classes, HTML-only hooks and any rule mixing them are preserved even when
// the corpus never mentions them, because runtime composition or static HTML
// can reference classes a source scan cannot see. The algorithm over-keeps on
// ambiguity: a rule is kept when ANY of its classes is used, rules without
// class selectors (html/:root/[data-...]) are always kept, @media/@layer
// blocks are pruned recursively and kept while any inner rule survives, and
// rules defining a custom property that a kept rule consumes via var() are
// rescued to a fixpoint. Parsing is structural (brace matching), so both the
// vendored pretty file and Vite-minified site assets are handled.
//
// Safety: the pruner refuses to write (failing the build) when braces come out
// unbalanced or a class the corpus references would lose its last rule.

import { readFile, writeFile } from "node:fs/promises";

function splitItems(text) {
  // Top-level statements: comments (end at *​/), at-statements (end at ;),
  // and prelude + balanced-brace blocks (rules, @media/@layer blocks).
  const items = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) { items.push(text.slice(start, i + 1)); start = i + 1; }
    } else if (depth === 0 && text[i] === ";" && !text.slice(start, i).includes("{")) {
      if (text.slice(start, i + 1).trim()) items.push(text.slice(start, i + 1));
      start = i + 1;
    } else if (depth === 0 && text[i] === "/" && text[i + 1] === "*" && !text.slice(start, i).trim()) {
      const end = text.indexOf("*/", i + 2);
      if (end >= 0) { items.push(text.slice(start, end + 2)); start = end + 2; i = end + 1; }
    }
  }
  const tail = text.slice(start);
  if (tail.trim()) items.push(tail);
  return items;
}

function ruleClasses(selector) {
  return [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]);
}

// Pruning candidates are limited to the Astryx-owned class families: StyleX
// atomic hashes (x[0-9a-z]{5,8}) and astryx-* target hooks. Every other class
// (lf-*, app-shell, hosted-screen, wordmark, skip links, ...) is preserved
// even when the corpus never mentions it, because runtime composition or
// static HTML can reference classes a source scan cannot see.
const ATOMIC = /^(?:x[0-9a-z]{5,8}|astryx-[\w-]+)$/;

function keepRule(rule, corpus) {
  const brace = rule.indexOf("{");
  if (brace < 0) return true;
  const classes = ruleClasses(rule.slice(0, brace));
  if (!classes.length) return true; // html/[data-...] selectors
  if (classes.some(name => !ATOMIC.test(name))) return true; // named class: preserve
  return classes.some(name => corpus.includes(name));
}

function pruneContent(text, js, stats) {
  const out = [];
  for (const item of splitItems(text)) {
    const trimmed = item.trimStart();
    if (!trimmed) continue; // whitespace-only segments: keeps re-pruning idempotent
    if (trimmed.includes("{") && (trimmed.startsWith("@media") || trimmed.startsWith("@layer") || trimmed.startsWith("@supports"))) {
      const brace = item.indexOf("{");
      const inner = pruneContent(item.slice(brace + 1, item.endsWith("}") ? -1 : undefined), js, stats);
      if (inner.trim()) out.push(item.slice(0, brace + 1).trimStart() + inner + "}");
      continue;
    }
    if (trimmed.startsWith("@property") || trimmed.startsWith("@keyframes")) {
      out.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("@") || !trimmed.includes("{")) {
      out.push(trimmed); // comments, @layer name declarations, @charset
      continue;
    }
    if (keepRule(trimmed, js)) { stats.kept++; out.push(trimmed); }
    else { stats.dropped++; stats.droppedItems.push(item); }
  }
  return out.join("\n");
}

export async function pruneAstryxCss(cssPath, jsPaths, outPath, htmlPaths = []) {
  const css = await readFile(cssPath, "utf8");
  let js = "";
  for (const path of jsPaths) js += await readFile(path, "utf8");
  for (const path of htmlPaths) js += await readFile(path, "utf8");
  const stats = { kept: 0, dropped: 0, droppedItems: [] };
  let result = pruneContent(css, js, stats);

  // CSS custom-property flow: a kept rule can consume var(--x-*) that only a
  // dropped rule defines (parent sets, child consumes). Rescue those defining
  // rules to a fixpoint so no kept consumer loses its variable source.
  let rescued = 0;
  for (;;) {
    const consumed = new Set([...result.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]));
    const defined = new Set([...result.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    const missing = [...consumed].filter(name => !defined.has(name));
    if (!missing.length) break;
    let progress = false;
    const stillMissing = new Set(missing);
    for (let i = stats.droppedItems.length - 1; i >= 0 && stillMissing.size; i--) {
      const item = stats.droppedItems[i];
      const defines = [...item.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]);
      if (defines.some(name => stillMissing.has(name))) {
        result += "\n" + item.trim();
        stats.droppedItems.splice(i, 1);
        for (const name of defines) stillMissing.delete(name);
        rescued++; progress = true;
      }
    }
    if (!progress) break; // variable comes from outside this file (theme layers)
  }
  stats.rescued = rescued;
  stats.dropped = stats.droppedItems.length;

  // Second pass: drop @property/@keyframes definitions nothing references.
  const keptItems = splitItems(result);
  const bodyWithout = index => keptItems.filter((_, other) => other !== index).join("\n");
  const finalItems = keptItems.filter((item, index) => {
    const trimmed = item.trimStart();
    if (!trimmed.startsWith("@property") && !trimmed.startsWith("@keyframes")) return true;
    const name = trimmed.match(/^@\w+\s+([\w-]+)/)?.[1];
    if (!name) return true;
    if (bodyWithout(index).includes(name) || js.includes(name)) return true;
    stats.droppedDefs = (stats.droppedDefs || 0) + 1;
    return false;
  });
  result = finalItems.map(item => item.trimStart()).join("\n");

  if (result.split("{").length !== result.split("}").length) {
    throw new Error(`prune-astryx-css: unbalanced braces (${stats.kept} kept) - refusing to write`);
  }
  // Every class the JS references must still have a rule.
  const allClasses = new Set(ruleClasses(css));
  const missingClasses = [...allClasses].filter(name => js.includes(name) && !new RegExp(`\\.${name}\\b`).test(result));
  if (missingClasses.length) {
    throw new Error(`prune-astryx-css: dropped used classes: ${missingClasses.slice(0, 5).join(", ")}`);
  }
  await writeFile(outPath, result);
  return { ...stats, droppedItems: undefined, rawBefore: css.length, rawAfter: result.length };
}
