import { h, type ComponentChildren } from "preact";
import { CodeBlock } from "./code-block";

const listItem = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

/** `_text_` / `*text*` emphasis only; intraword underscores (snake_case) stay literal. */
function inline(text: string): ComponentChildren {
  const parts: ComponentChildren[] = [];
  const pattern = /(?<![\w*])([_*])(?![\s*_])(.+?)(?<!\s)\1(?![\w*])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(h("em", { key: match.index }, match[2]));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}

/** One list level; deeper-indented marker lines become a nested list inside the preceding item. */
function list(lines: readonly string[], key: number): ComponentChildren {
  const indent = listItem.exec(lines[0] ?? "")?.[1]?.length ?? 0;
  const items: { text: string; nested: string[] }[] = [];
  for (const line of lines) {
    const match = listItem.exec(line);
    if (match && (match[1]?.length ?? 0) <= indent) items.push({ text: match[3] ?? "", nested: [] });
    else items.at(-1)?.nested.push(line);
  }
  const ordered = /^\s*\d/.test(lines[0] ?? "");
  return h(ordered ? "ol" : "ul", { key }, items.map((item, row) => h("li", { key: row }, inline(item.text),
    item.nested.length > 0 ? list(item.nested, row) : null)));
}

/** Escaped text nodes only. Raw HTML, URLs and remote media are never executed. */
export function MarkdownViewer({ text }: { readonly text: string }) {
  const lines = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const key = index++;
    if (line.trim() === "") continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(h("h3", { key, "data-level": heading[1]?.length }, inline(heading[2] ?? ""))); continue; }
    if (line.startsWith("```")) {
      const code = [];
      while (index < lines.length && !lines[index]?.startsWith("```")) code.push(lines[index++]);
      index++;
      blocks.push(h("div", { key, class: "lf-markdown__code" },
        h(CodeBlock, { value: code.join("\n"), language: line.slice(3).trim() || "text" })));
      continue;
    }
    if (listItem.test(line) && !/^\s/.test(line)) {
      const items = [line];
      while (index < lines.length && (lines[index] ?? "").trim() !== "" &&
        (listItem.test(lines[index] ?? "") || /^\s+\S/.test(lines[index] ?? ""))) items.push(lines[index++] ?? "");
      blocks.push(list(items, key));
      continue;
    }
    const paragraph = [line];
    while (index < lines.length && lines[index]?.trim() && !/^(?:#{1,6}\s|```|[-*]\s|\d+[.)]\s)/.test(lines[index] ?? "")) paragraph.push(lines[index++] ?? "");
    // Match the upstream renderer's literal HTML text without creating an HTML
    // parser or giving its source tags paragraph semantics.
    blocks.push(line.trimStart().startsWith("<") ? `${paragraph.join("\n")}\n` : h("p", { key }, inline(paragraph.join("\n"))));
  }
  return <div class="lf-markdown">{blocks}</div>;
}
