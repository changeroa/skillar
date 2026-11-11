import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { paintedFocus } from "./focus-paint.mjs";
import { applyViewport } from "./viewport.mjs";
import { press, ready } from "./trusted-keys.mjs";

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
    const inventory = await page.evaluate(known => {
      const original = new Set(Object.values(known).map(selector => document.querySelector(selector)));
      return [...document.querySelectorAll('[data-specimen] :is(button,input,select,textarea,[tabindex])')]
        .filter(node => !original.has(node) && !node.matches(":disabled") && node.tabIndex >= 0 &&
          node.getBoundingClientRect().height > 0)
        .map((node, index) => {
          node.dataset.p1Focus = String(index);
          const specimen = node.closest("[data-specimen]");
          return { name: `${specimen.dataset.component}-${specimen.dataset.state}-${index}`,
            selector: `[data-p1-focus="${index}"]` };
        });
    }, targets);
    const allTargets = [...Object.entries(targets).map(([name, selector]) => ({ name, selector })), ...inventory];
    for (const { name, selector } of allTargets) {
      try {
        await press(page, "Tab");
        const normal = await paintedFocus(page, selector, `${out}/${surface}-${name}-${width}-${theme}`);
        assert.equal(normal.pass, true, `${name} must visibly paint 2px keyboard focus at 3:1`);
        {
          await page.evaluate(() => {
            const style = document.createElement("style"); style.id = "p1-focus-mutation";
            style.textContent = "#gallery :focus-visible,#gallery :has(:focus-visible),#gallery :focus-visible+*{outline:none!important;box-shadow:none!important}";
            document.head.append(style);
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
  assert.ok(candidates.length > 0, "Focus inventory must not disappear");
  const invisible = await page.evaluate(() => {
    const style = document.createElement("style"); style.id = "p1-invisible-focus";
    style.textContent = '#p1-textarea-default:focus-visible{outline:2px solid var(--lf-background)!important;outline-offset:2px!important;box-shadow:0 0 0 2px var(--lf-background),0 0 0 4px var(--lf-background)!important}';
    document.head.append(style); return "#p1-textarea-default";
  });
  try {
    const mutation = await paintedFocus(page, { selector: invisible, kind: "textarea" },
      `${out}/invisible-focus-mutation`);
    assert.equal(mutation.pass, false, "A same-background focus indicator must not pass");
    results[0] = { ...results[0], invisibleFocusMutation: { ...mutation, rejected: true } };
  } finally { await page.evaluate(() => document.querySelector("#p1-invisible-focus").remove()); }
  return results;
}
