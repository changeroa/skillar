import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { paintedFocus } from "./focus-paint.mjs";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";

export async function p1Focus(page, { base, out, surface }) {
  await mkdir(out, { recursive: true });
  const results = [];
  const targets = {
    textarea: '#p1-textarea-default',
    combobox: '#p1-combo',
    multiselect: '#p1-multi',
    radio: '[data-component="Radio"][data-state="unchecked-enabled"] input',
    switch: '[data-component="Switch"][data-state="default-default-unchecked-enabled"] input',
    toast: '[data-component="Toast"][data-state="default"] .lf-toast__dismiss',
    code: '[data-component="CodeBlock"][data-state="default"] pre',
    period: '[data-component="TimePeriodSelect"] select',
  };
  for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
    await applyViewport(page, { width, height: 900, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
    await page.goto(`${base}/__gallery.html?p1&atomic&theme=${theme}`, { waitUntil: "domcontentloaded" });
    await ready(page, "#p1-combo");
    await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; } });
    for (const [name, selector] of Object.entries(targets)) {
      try {
        const normal = await paintedFocus(page, selector, `${out}/${surface}-${name}-${width}-${theme}`);
        assert.equal(normal.pass, true, `${name} must visibly paint 2px keyboard focus at 3:1`);
        if (name === "textarea") {
          await page.evaluate(() => {
            const style = document.createElement("style"); style.id = "p1-focus-mutation";
            style.textContent = "#gallery :focus-visible{outline:none!important;box-shadow:none!important}"; document.head.append(style);
          });
          const mutant = await paintedFocus(page, selector, `${out}/${surface}-${name}-${width}-${theme}-no-ring`);
          await page.evaluate(() => document.querySelector("#p1-focus-mutation").remove());
          assert.equal(mutant.pass, false, "validator must reject a missing painted focus ring");
          assert.equal(mutant.adjacentContrastingPairs, 0);
          results.push({ surface, name: `${name}-negative-control`, width, theme, status: "PASS", ...mutant });
        }
        results.push({ surface, name, width, theme, status: "PASS", ...normal });
      } catch (error) {
        await page.evaluate(() => document.querySelector("#p1-focus-mutation")?.remove());
        results.push({ surface, name, width, theme, status: "FAIL", error: String(error) });
      }
    }
  }
  return results;
}
