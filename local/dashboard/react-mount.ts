// Minimal mount helper preserving the preact render(node, container) call shape.
// createRoot is created once per container and cached; flushSync keeps the initial
// render synchronous like preact's render was (tests assert immediately after render).
import { createElement as h, Fragment } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";

const roots = new WeakMap<Element, Root>();

export function render(node: ReactNode, container: Element): void {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  flushSync(() => root.render(h(Fragment as any, null, node)));
}
