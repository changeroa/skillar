import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { all, byTag, buttonNamed, FakeEvent, installFakeDom, waitFor } from "./fake-dom.mjs";

export { h, render, act, all, byTag, buttonNamed, FakeEvent, waitFor };

// Use the same Preact instance as the DOM renderer, even for the bundled local views.
export async function loadViews(exports, instrument = {}) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const result = await build({
    stdin: { contents: exports, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    banner: { js: `import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(${JSON.stringify(`${root}/site/package.json`)});` },
    jsx: "automatic", jsxImportSource: "preact", logLevel: "silent",
    loader: { ".css": "empty" },
    plugins: [{
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^preact(?:\/.*)?$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
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
  const prototype = Object.getPrototypeOf(dom.body);
  const textContent = Object.getOwnPropertyDescriptor(prototype, "textContent");
  if (textContent.set === undefined) Object.defineProperty(prototype, "textContent", {
    get: textContent.get,
    set(value) {
      for (const child of [...this.childNodes]) this.removeChild(child);
      this.appendChild(this.ownerDocument.createTextNode(value));
    },
    configurable: true,
  });
  globalThis.location ??= { origin: "https://skillar.sh", hash: "", href: "https://skillar.sh/skills/" };
  dom.head = dom.createElement("head");
  dom.head.append = child => dom.head.appendChild(child);
  dom.documentElement.appendChild(dom.head);
  const container = dom.createElement("div");
  dom.body.appendChild(container);
  t.after(() => act(() => render(null, container)));
  const show = async next => act(() => render(h(Component, next), container));
  await show(props);
  return { dom, container, show };
}

export async function input(field, value, type = "input") {
  await act(() => {
    field.value = value;
    field.dispatchEvent(new FakeEvent(type));
  });
}

export async function submit(form) {
  await act(() => form.dispatchEvent(new FakeEvent("submit")));
}
