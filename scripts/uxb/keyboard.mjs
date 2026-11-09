import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arm, press, ready, signal } from "./trusted-keys.mjs";
import { measure } from "./metrics.mjs";

const [site, local, output] = process.argv.slice(2);
if (!site || !local || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node keyboard.mjs site-gallery-url local-gallery-url output");
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } });
const page = tab.page, results = [];
let failed = false;
await mkdir(output, { recursive: true });
try {
  for (const [app, url] of [["site", site], ["local", local]]) {
    for (const theme of ["light", "dark"]) {
      try {
      await tabs.repin(tab, { width: 1440, height: 900 });
      await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: false });
      await page._sendToTarget("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      await page.goto(`${url}?theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page._sendToTarget("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await ready(page, "#gallery[data-ready=true]");
      await page._sendToTarget("Page.bringToFront");
      await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
      await page.evaluate(() => {
        window.__qaKeys = [];
        document.addEventListener("keydown", event => window.__qaKeys.push({ key: event.key, trusted: event.isTrusted }), true);
        window.__qaRoot = document.querySelector("#gallery");
        document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute("tabindex");
      });
      const order = ["select", "#probe-default", "#probe-hover", "#probe-focus-visible",
        "#probe-active", "#probe-error", "#probe-empty", "#probe-selected", "footer a"];
      const focus = [];
      for (const selector of order) {
        await arm(page, { kind: "focus", selector });
        await press(page, "Tab"); await signal(page);
        const metric = await measure(page, selector);
        assert.equal(metric.focused, true, `${selector}: focus-visible`);
        assert.equal(metric.outlineWidth, 2, `${selector}: ring width`);
        assert.equal(metric.outlineOffset, 2, `${selector}: ring offset`);
        assert.equal(metric.height, 32, `${selector}: desktop box`);
        focus.push({ selector, ...metric });
      }
      // Reverse order is also browser-driven; no focus() substitutes a tested Tab.
      for (const selector of order.slice(0, -1).reverse()) {
        await arm(page, { kind: "focus", selector });
        await press(page, "Tab", 8); await signal(page);
      }
      results.push({ app, theme, kind: "tab-order-and-ring", pass: true, focus });
      await press(page, "Tab");
      await arm(page, { kind: "text", selector: "#probe-result", value: "확인 1회" });
      await press(page, "Enter"); await signal(page);
      await arm(page, { kind: "text", selector: "#probe-result", value: "확인 2회" });
      await press(page, " "); await signal(page);
      for (let i = 0; i < 6; i++) await press(page, "Tab");
      await arm(page, { kind: "attribute", selector: "#probe-selected", attribute: "aria-pressed", value: "false" });
      await press(page, " "); await signal(page);
      assert.equal(await page.evaluate(() => !!document.querySelector("#probe-selected svg")), false);
      await arm(page, { kind: "attribute", selector: "#probe-selected", attribute: "aria-pressed", value: "true" });
      await press(page, "Enter"); await signal(page);
      for (const selector of order.slice(0, 7).reverse()) {
        await arm(page, { kind: "focus", selector });
        await press(page, "Tab", 8); await signal(page);
      }
      results.push({ app, theme, kind: "button-toggle-activation", pass: true });
      const initialAX = await page._sendToTarget("Accessibility.getFullAXTree");
      assert.ok(initialAX.nodes.some(node => !node.ignored && node.role?.value === "main"));
      const namedControls = initialAX.nodes.filter(node => !node.ignored &&
        ["button", "textbox", "combobox", "link"].includes(node.role?.value));
      assert.ok(namedControls.length >= 9 && namedControls.every(node => node.name?.value?.trim()));
      await writeFile(join(output, `${app}-${theme}-initial-ax.json`), JSON.stringify(initialAX, null, 2));
      results.push({ app, theme, kind: "native-aria-tree", pass: true, controls: namedControls.length });
      const themeChecks = [];
      for (const mode of ["dark", "light", "system"]) {
        const current = await page.evaluate(() => document.querySelector("select").value);
        const indices = { system: 0, light: 1, dark: 2 };
        await arm(page, { kind: "attribute", selector: "html", attribute: "data-theme", value: mode });
        await press(page, " ");
        for (let i = 0; i < Math.abs(indices[mode] - indices[current]); i++)
          await press(page, indices[mode] > indices[current] ? "ArrowDown" : "ArrowUp");
        await press(page, "Enter"); await signal(page);
        for (const os of ["light", "dark"]) {
          await page._sendToTarget("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-color-scheme", value: os }],
          });
          const background = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
          const effective = mode === "system" ? os : mode;
          assert.equal(background, effective === "light" ? "rgb(255, 255, 255)" : "rgb(15, 15, 15)");
          themeChecks.push({ mode, os, background });
        }
      }
      // Native picker owns its popup. Trusted open/cancel keys must leave its
      // trigger focused; there is no custom overlay or saved account setting.
      await press(page, " "); await press(page, "Escape");
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("select")), true);
      const ax = await page._sendToTarget("Accessibility.getFullAXTree");
      const controls = ax.nodes.filter(node => !node.ignored && ["button", "textbox", "combobox", "link"].includes(node.role?.value));
      assert.ok(controls.length >= 9);
      assert.ok(controls.every(node => typeof node.name?.value === "string" && node.name.value.trim()));
      const semantics = await page.evaluate(() => ({
        labelled: [...document.querySelectorAll("input,button")].every(el => document.querySelector(`label[for="${el.id}"]`)),
        disabled: document.querySelector("#probe-disabled").disabled,
        busyDisabled: document.querySelector("#probe-loading").disabled,
        busy: document.querySelector("#probe-loading").getAttribute("aria-busy"),
        invalid: document.querySelector("#probe-error").getAttribute("aria-invalid"),
        descriptionExists: !!document.getElementById(document.querySelector("#probe-error").getAttribute("aria-describedby")),
        keys: window.__qaKeys, sameRoot: window.__qaRoot === document.querySelector("#gallery"),
      }));
      assert.ok(semantics.labelled && semantics.disabled && semantics.busyDisabled && semantics.descriptionExists && semantics.sameRoot);
      assert.equal(semantics.busy, "true"); assert.equal(semantics.invalid, "true");
      assert.ok(semantics.keys.length > 20 && semantics.keys.every(event => event.trusted));
      await writeFile(join(output, `${app}-${theme}-ax.json`), JSON.stringify(ax, null, 2));
      results.push({ app, theme, kind: "tab-activation-aria", pass: true, focus, semantics, themeChecks });
      console.log(`PASS ${app} ${theme} Tab/Shift+Tab/Enter/Space/AX`);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        failed = true;
        results.push({ app, theme, kind: "keyboard-case-failure", pass: false, name: error.name, message: error.message });
        console.error(error.stack);
        await press(page, "Escape");
      }
    }
    for (const profile of [{ id: "phone", width: 390, height: 844, touch: true, dpr: 3 },
      { id: "coarse", width: 1440, height: 900, touch: true, dpr: 1 }]) {
      await tabs.repin(tab, profile);
      await page.goto(`${url}?theme=light`, { waitUntil: "domcontentloaded" });
      await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width: profile.width, height: profile.height,
        mobile: profile.touch, deviceScaleFactor: profile.dpr });
      await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: true });
      await ready(page, "#gallery");
      const metrics = [];
      for (const selector of ["select", ...["default", "hover", "focus-visible", "active", "disabled", "loading", "error", "empty", "selected"].map(n => `#probe-${n}`)]) {
        const metric = await measure(page, selector);
        assert.equal(metric.height, 44); assert.equal(metric.fontSize, 13); assert.equal(metric.lineHeight, 20);
        metrics.push({ selector, ...metric });
      }
      const viewport = await page.evaluate(() => ({ coarse: matchMedia("(pointer:coarse)").matches,
        width: innerWidth, dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(viewport.coarse, true); assert.equal(viewport.width, profile.width);
      assert.equal(viewport.dpr, profile.dpr); assert.equal(viewport.overflow, false);
      results.push({ app, profile, kind: "touch-metrics", pass: true, metrics, viewport });
      console.log(`PASS ${app} ${profile.id} 44px/coarse/DPR`);
    }
  }
} catch (error) {
  if (!(error instanceof Error)) throw error;
  failed = true;
  results.push({ kind: "failure", pass: false, name: error.name, message: error.message });
  console.error(error.stack);
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ results }, null, 2));
  await press(page, "Escape");
  await page._sendToTarget("Page.close");
  await browser.close();
}
if (failed) process.exitCode = 1;
