import assert from "node:assert/strict";
import { arm, signal, press, ready, typeahead } from "./trusted-keys.mjs";

// Gallery options: 0 Alpha, 1 Disabled (aria-disabled), 2 Beta, 3 Gamma.
const LABELS = Object.freeze(["Alpha", "Disabled", "Beta", "Gamma"]);

async function expectActive(page, id, index) {
  assert.deepEqual(await page.evaluate(id => {
    const input = document.getElementById(id), active = document.getElementById(input.getAttribute("aria-activedescendant"));
    return { focused: document.activeElement === input, expanded: input.getAttribute("aria-expanded"),
      id: active?.id, text: active?.textContent, visual: active?.dataset.active, disabled: active?.getAttribute("aria-disabled") ?? null,
      painted: [...document.querySelectorAll(`#${id}-list [data-active=true]`)].map(node => node.id) };
  }, id), { focused: true, expanded: "true", id: `${id}-option-${index}`, text: LABELS[index], visual: "true", disabled: null,
    painted: [`${id}-option-${index}`] });
}

async function step(page, id, key, index) {
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-activedescendant", value: `${id}-option-${index}` });
  await press(page, key); await signal(page);
  await expectActive(page, id, index);
}

async function closeWithEscape(page, id) {
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-expanded", value: "false" });
  await press(page, "Escape"); await signal(page);
}

/** Trusted pointer click at the input centre: opens without an active option. */
async function pointerOpen(page, id) {
  const point = await page.evaluate(id => {
    const node = document.getElementById(id); node.scrollIntoView({ block: "center", behavior: "instant" });
    const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, id);
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-expanded", value: "true" });
  for (const type of ["mousePressed", "mouseReleased"])
    await page._sendToTarget("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  await signal(page);
  assert.deepEqual(await page.evaluate(id => ({ focused: document.activeElement.id,
    active: document.getElementById(id).getAttribute("aria-activedescendant") }), id), { focused: id, active: null });
}

/** WAI-ARIA combobox listbox navigation: open-direction entry, Home/End, wrap, disabled skip. */
async function listboxNavigation(page, id, results, name) {
  await page.evaluate(id => document.getElementById(id).focus(), id);
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-activedescendant", value: `${id}-option-3` });
  await press(page, "ArrowUp"); await signal(page);
  await expectActive(page, id, 3);
  results.push(`${name} closed ArrowUp opens on the last enabled option`);
  await step(page, id, "ArrowUp", 2);
  await step(page, id, "ArrowUp", 0);
  results.push(`${name} ArrowUp skips the disabled option`);
  await step(page, id, "ArrowUp", 3);
  results.push(`${name} ArrowUp wraps from first to last`);
  await step(page, id, "ArrowDown", 0);
  results.push(`${name} ArrowDown wraps from last to first`);
  await step(page, id, "End", 3);
  await step(page, id, "Home", 0);
  results.push(`${name} Home and End move to the first and last enabled options`);
  await step(page, id, "ArrowDown", 2);
  results.push(`${name} ArrowDown skips the disabled option`);
  await closeWithEscape(page, id);
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-activedescendant", value: `${id}-option-0` });
  await press(page, "ArrowDown"); await signal(page);
  await expectActive(page, id, 0);
  results.push(`${name} closed ArrowDown opens on the first enabled option`);
  await closeWithEscape(page, id);
  await pointerOpen(page, id);
  await step(page, id, "ArrowUp", 3);
  results.push(`${name} ArrowUp after pointer open activates the last enabled option`);
  await closeWithEscape(page, id);
  await pointerOpen(page, id);
  await step(page, id, "ArrowDown", 0);
  results.push(`${name} ArrowDown after pointer open activates the first enabled option`);
  // Typing clears the active option; "a" keeps Alpha, Beta and Gamma enabled.
  await arm(page, { kind: "attribute", selector: `#${id}`, attribute: "aria-activedescendant", value: null });
  await typeahead(page, "a", "KeyA", 65); await signal(page);
  assert.equal(await page.evaluate(id => document.getElementById(id).value, id), "a");
  await step(page, id, "ArrowUp", 3);
  results.push(`${name} ArrowUp after filtering activates the last enabled match`);
  await closeWithEscape(page, id);
}

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
  await listboxNavigation(page, "p1-combo", results, "Combobox");
  await listboxNavigation(page, "p1-multi", results, "MultiSelect");
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
