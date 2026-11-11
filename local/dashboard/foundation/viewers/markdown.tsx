import { h } from "preact";
import { CodeBlock } from "./code-block";

/** Escaped text nodes only. Raw HTML, URLs and remote media are never executed. */
export function MarkdownViewer({ text }: { readonly text: string }) {
  const lines = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const key = index++;
    if (line.trim() === "") continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(h("h3", { key, "data-level": heading[1]?.length }, heading[2])); continue; }
    if (line.startsWith("```")) {
      const code = [];
      while (index < lines.length && !lines[index]?.startsWith("```")) code.push(lines[index++]);
      index++;
      blocks.push(h(CodeBlock, { key, value: code.join("\n"), language: line.slice(3).trim() || "text" }));
      continue;
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      const items = [line];
      while (index < lines.length && /^(?:[-*]|\d+\.)\s+/.test(lines[index] ?? "")) items.push(lines[index++] ?? "");
      blocks.push(h(/^\d/.test(line) ? "ol" : "ul", { key },
        items.map((item, row) => h("li", { key: row }, item.replace(/^(?:[-*]|\d+\.)\s+/, "")))));
      continue;
    }
    const paragraph = [line];
    while (index < lines.length && lines[index]?.trim() && !/^(?:#{1,6}\s|```|[-*]\s|\d+\.\s)/.test(lines[index] ?? "")) paragraph.push(lines[index++] ?? "");
    // Match the upstream renderer's literal HTML text without creating an HTML
    // parser or giving its source tags paragraph semantics.
    blocks.push(line.trimStart().startsWith("<") ? `${paragraph.join("\n")}\n` : h("p", { key }, paragraph.join("\n")));
  }
  return <div class="lf-markdown">{blocks}</div>;
}
