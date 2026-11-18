import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement as h, act } from "react";
import { createRoot } from "react-dom/client";
import { all, byTag, buttonNamed, FakeEvent, installFakeDom, waitFor } from "./fake-dom.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots = new WeakMap();

/** Mount helper preserving the previous render(node, container) call shape. */
export function render(node, container) {
  if (node === null) {
    const root = roots.get(container);
    roots.delete(container);
    root?.unmount();
    return;
  }
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(node);
}

export { h, act, all, byTag, buttonNamed, FakeEvent, waitFor };

// Use the same React instance as the DOM renderer, even for the bundled local views.
export async function loadViews(exports, instrument = {}) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const result = await build({
    stdin: { contents: exports, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    banner: { js: `import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(${JSON.stringify(`${root}/site/package.json`)});` },
    jsx: "automatic", jsxImportSource: "react", logLevel: "silent",
    loader: { ".css": "empty" },
    nodePaths: [`${root}/site/node_modules`],
    plugins: [{
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^(react|react-dom|scheduler)(\/.*)?$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
        if (instrument.cloud) builder.onLoad({ filter: /local\/dashboard\/cloud\.ts$/ }, () => ({
          contents: "export const createCloudApi = (...args) => globalThis.__t10Cloud(...args);", loader: "ts",
        }));
        if (instrument.cloud) builder.onLoad({ filter: /local\/dashboard\/main\.tsx$/ }, () => ({
          contents: "export const App = () => null;", loader: "tsx",
        }));
        if (instrument.signedIn) builder.onLoad({ filter: /site\/src\/dashboard\/app\.tsx$/ }, async args => ({
          contents: `${await readFile(args.path, "utf8")}\nexport { SignedIn };`, loader: "tsx",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

export async function mount(t, Component, props) {
  const dom = installFakeDom();
  const container = dom.createElement("div");
  dom.body.appendChild(container);
  t.after(() => act(() => render(null, container)));
  const show = async next => act(() => render(h(Component, next), container));
  await show(props);
  return { dom, container, show };
}

// React tracks input values with its own setter; go through the prototype setter so
// a programmatic value change is seen as a genuine edit when the event dispatches.
function setNativeValue(field, value) {
  const prototype = field instanceof globalThis.HTMLTextAreaElement
    ? globalThis.HTMLTextAreaElement.prototype
    : field instanceof globalThis.HTMLSelectElement
      ? globalThis.HTMLSelectElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
}

// React derives onChange for checkboxes and radios from the click activation, and the
// browser's activation behavior updates checkedness outside React's value tracker.
export async function choose(field) {
  await act(() => { field.click(); });
}

export async function input(field, value, type = "input") {
  await act(() => {
    setNativeValue(field, value);
    field.dispatchEvent(new FakeEvent(type));
  });
}

export async function submit(form) {
  await act(() => form.dispatchEvent(new FakeEvent("submit")));
}
