import { arm, press, signal } from "./trusted-keys.mjs";

/**
 * Opens a listbox with trusted keys and lands the active option on "Beta"
 * (Alpha is selected, "Disabled" is skipped). Hover/active then put a trusted
 * pointer on that same active row, so no interaction changes the selection.
 */
const sides = {
  product: {
    trigger: root => `${root} input[role=combobox]`, popup: root => `${root} .lf-combobox__popup`,
    keys: () => ["ArrowDown", "ArrowDown"], active: () => 'li[data-active="true"]',
  },
  mit: {
    trigger: (_root, component) => `[data-component="${component}"] [role=combobox]`,
    popup: (_root, component) => component === "Combobox"
      ? "[data-radix-popper-content-wrapper] [role=listbox]" : "[data-radix-popper-content-wrapper] [role=dialog]",
    // Radix Select opens on the selected option; cmdk highlights its first item on open.
    keys: component => component === "Combobox" ? ["ArrowDown", "ArrowDown"] : ["Enter", "ArrowDown"],
    active: component => component === "Combobox" ? "[role=option][data-highlighted]" : "[cmdk-item][data-selected=true]",
  },
};

export function p1PopupSelector(side, root, component) { return sides[side].popup(root, component); }

export async function closeP1Popup(page, side, root, component) {
  const popup = sides[side].popup(root, component);
  if (!await page.evaluate(selector => !!document.querySelector(selector), popup)) return;
  await arm(page, { kind: "absent", selector: popup });
  await press(page, "Escape");
  await signal(page);
}

export async function openP1Popup(page, { side, root, component, interaction }) {
  const config = sides[side];
  await closeP1Popup(page, side, root, component);
  await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await page.evaluate(selector => {
    const trigger = document.querySelector(selector);
    if (!trigger) throw new RangeError(`Missing popup trigger ${selector}`);
    trigger.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    trigger.focus({ preventScroll: true });
  }, config.trigger(root, component));
  const active = `${config.popup(root, component)} ${config.active(component)}`;
  const keys = config.keys(component);
  for (const [index, key] of keys.entries()) {
    const last = index === keys.length - 1;
    await arm(page, last ? { kind: "text", selector: active, value: "Beta" } : { kind: "present", selector: active });
    await press(page, key);
    await signal(page);
  }
  // Entry fades/slides are finite; compare the settled popup.
  await page.evaluate(() => {
    for (const animation of document.getAnimations())
      if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
  });
  const pointer = { requested: interaction, trustedPointer: true, hover: false, active: false, events: [] };
  if (interaction !== "rest") {
    const point = await page.evaluate(selector => {
      window.__p1Pointer = [];
      for (const type of ["pointermove", "pointerdown"]) document.addEventListener(type,
        event => window.__p1Pointer.push({ type: event.type, trusted: event.isTrusted }), { capture: true, once: true });
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, active);
    await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    if (interaction === "active") {
      // The press must never choose the option: the click is cancelled and the release lands outside.
      await page.evaluate(() => document.addEventListener("click", event => {
        event.preventDefault(); event.stopImmediatePropagation();
      }, { capture: true, once: true }));
      await page._sendToTarget("Input.dispatchMouseEvent",
        { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    }
    Object.assign(pointer, await page.evaluate(selector => {
      const row = document.querySelector(selector);
      return { hover: row?.matches(":hover") ?? false, active: row?.matches(":active") ?? false,
        stillActive: row?.textContent === "Beta",
        trustedPointer: window.__p1Pointer.length > 0 && window.__p1Pointer.every(event => event.trusted),
        events: window.__p1Pointer };
    }, active));
  }
  return { selector: config.popup(root, component), pointer };
}
