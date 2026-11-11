import { CopyButton } from "../controls/copy-button";
import { SyntaxText } from "./syntax";
const languageNames: Readonly<Record<string, string>> = {
  text: "text", javascript: "JavaScript", typescript: "TypeScript", python: "Python",
  json: "JSON", markdown: "Markdown", css: "CSS", markup: "HTML", bash: "Bash", toml: "TOML",
};

export function CodeBlock({ value, language = "text", label = "코드", variant = "default" }: {
  readonly value: string; readonly language?: string; readonly label?: string;
  readonly variant?: "default" | "read-only";
}) {
  return <section class={`lf-codeblock lf-codeblock--${variant}`} data-language={language.toLowerCase()} aria-label={label}>
    {variant === "read-only"
      ? <div class="lf-codeblock__copy"><CopyButton value={value} label={label} /></div>
      : <header><span>{Object.hasOwn(languageNames, language.toLowerCase()) ? languageNames[language.toLowerCase()] : language}</span><CopyButton value={value} label={label} /></header>}
    <pre tabIndex={0} aria-label={label}><code><SyntaxText value={value} language={language} /></code></pre>
  </section>;
}
