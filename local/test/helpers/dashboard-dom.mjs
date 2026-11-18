// jsdom-backed DOM host for local dashboard rendering tests, shared with the site harness.
// No component, hook, or event handler is mocked.
import { installFakeDom } from "../../../site/test/helpers/fake-dom.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export function descendants(node) {
  if (node.nodeType !== 1) return [];
  return [node, ...Array.from(node.childNodes).flatMap(descendants)];
}

export function installDom() {
  const document = installFakeDom();
  globalThis.HTMLDetailsElement = document.defaultView.HTMLDetailsElement;
  return () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
  };
}
