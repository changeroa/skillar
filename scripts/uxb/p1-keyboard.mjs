import assert from "node:assert/strict";
import { arm, signal, press, ready } from "./trusted-keys.mjs";

export async function p1Keyboard(page, base) {
  const results = [];
  await page.goto(`${base}/__gallery.html?p1&atomic`, { waitUntil: "domcontentloaded" });
  await ready(page, "#p1-combo");
  await page._sendToTarget("Page.bringToFront");
  await page.evaluate(() => document.querySelector("#p1-combo").focus());
  await arm(page, { kind: "attribute", selector: "#p1-combo", attribute: "aria-expanded", value: "true" });
  await press(page, "ArrowDown"); await signal(page);
  const first = await page.evaluate(() => {
    const input = document.querySelector("#p1-combo"), active = document.getElementById(input.getAttribute("aria-activedescendant"));
    return { focused: document.activeElement === input, active: active?.textContent, visual: active?.dataset.active,
      disabled: active?.getAttribute("aria-disabled") };
  });
  assert.deepEqual(first, { focused: true, active: "Alpha", visual: "true", disabled: null });
  results.push("Combobox ArrowDown keeps focus and active descendant matches paint");
  await arm(page, { kind: "attribute", selector: "#p1-combo", attribute: "aria-activedescendant", value: "p1-combo-option-2" });
  await press(page, "ArrowDown"); await signal(page);
  assert.equal(await page.evaluate(() => document.querySelector("#p1-combo-option-2").dataset.active), "true");
  results.push("Combobox skips disabled option");
  await arm(page, { kind: "attribute", selector: "#p1-combo", attribute: "aria-expanded", value: "false" });
  await press(page, "Enter"); await signal(page);
  assert.equal(await page.evaluate(() => document.querySelector("#p1-combo").value), "Beta");
  results.push("Combobox Enter commits selection");
  await press(page, "ArrowDown");
  await arm(page, { kind: "attribute", selector: "#p1-combo", attribute: "aria-expanded", value: "false" });
  await press(page, "Escape"); await signal(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), "p1-combo");
  results.push("Escape closes without stealing input focus");
  await page.evaluate(() => document.querySelector("#p1-multi").focus());
  await arm(page, { kind: "attribute", selector: "#p1-multi", attribute: "aria-expanded", value: "true" });
  await press(page, "ArrowDown"); await signal(page);
  await arm(page, { kind: "attribute", selector: "#p1-multi", attribute: "aria-activedescendant", value: "p1-multi-option-2" });
  await press(page, "ArrowDown"); await signal(page);
  await arm(page, { kind: "attribute", selector: "#p1-multi-option-2", attribute: "aria-selected", value: "true" });
  await press(page, "Enter"); await signal(page);
  assert.deepEqual(await page.evaluate(() => ({
    selected: [...document.querySelectorAll("#p1-multi-list [aria-selected=true]")].map(n => n.textContent),
    focused: document.activeElement.id, active: document.getElementById(document.querySelector("#p1-multi").getAttribute("aria-activedescendant"))?.dataset.active,
    multi: document.querySelector("#p1-multi-list").getAttribute("aria-multiselectable"),
  })), { selected: ["Alpha", "Beta"], focused: "p1-multi", active: "true", multi: "true" });
  results.push("MultiSelect accumulates values and active descendant matches paint");
  await press(page, "Tab");
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "p1-multi");
  results.push("MultiSelect Tab leaves naturally");
  const toast = '[data-component="Toast"][data-state="success"]';
  const action = `${toast} .lf-button`;
  await page.evaluate(selector => document.querySelector(selector).focus(), action);
  await arm(page, { kind: "text", selector: `${toast} [role=status]`, value: "Undone Your changes are saved." });
  await press(page, "Enter"); await signal(page);
  assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), action), true);
  assert.equal(await page.evaluate(selector => document.querySelector(`${selector} [aria-live]`).getAttribute("aria-live"), toast), "polite");
  results.push("Toast action announces politely and leaves focus unchanged");
  return results.map(name => ({ name, status: "PASS" }));
}
