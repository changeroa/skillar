import "./prism-manual";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-toml";
import type { ComponentChildren } from "preact";

/** Token trees contain strings, not trusted HTML. Every leaf is a Preact text node. */
function tokenNodes(tokens: Prism.TokenStream): ComponentChildren {
  if (typeof tokens === "string") return tokens;
  if (Array.isArray(tokens)) return tokens.map((token, index) =>
    typeof token === "string" ? token : <span key={index} data-token={token.type}>{tokenNodes(token.content)}</span>);
  return <span data-token={tokens.type}>{tokenNodes(tokens.content)}</span>;
}
export function SyntaxText({ value, language }: { readonly value: string; readonly language: string }) {
  const grammar = Prism.languages[language.toLowerCase()];
  return <>{grammar ? tokenNodes(Prism.tokenize(value, grammar)) : value}</>;
}
