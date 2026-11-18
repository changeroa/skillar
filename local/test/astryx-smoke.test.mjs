import test from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./helpers/dashboard-dom.mjs";

test("astryx Button renders under the jsdom harness", async () => {
  const dom = { root: installDom()() };
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { Theme } = await import("@astryxdesign/core/theme");
  const { Button } = await import("@astryxdesign/core/Button");
  const { skillarTheme } = await import("../dashboard/design/skillar-theme/dist/skillar.js");
  const root = createRoot(dom.root);
  flushSync(() => root.render(React.createElement(Theme, { theme: skillarTheme },
    React.createElement(Button, { label: "Google로 시작하기", variant: "primary" }))));
  const btn = dom.root.querySelector("button");
  assert.ok(btn, "button exists");
  assert.equal(btn.textContent.includes("Google로 시작하기"), true, "label rendered: " + btn.textContent);
  flushSync(() => root.unmount());
});
