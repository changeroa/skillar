/** Real trusted pointer events; never force pseudo-classes or click product actions. */
export async function p1Pointer(page, selector, state) {
  const point = await page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) throw new RangeError(`Missing pointer target: ${selector}`);
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    document.activeElement?.blur();
    window.__p1Pointer = [];
    const listeners = [];
    for (const type of ["pointermove", "pointerdown"]) {
      const listener = event => window.__p1Pointer.push({ type: event.type, trusted: event.isTrusted });
      document.addEventListener(type, listener, { capture: true, once: true });
      listeners.push([type, listener]);
    }
    window.__p1PointerCleanup = () => listeners.forEach(([type, listener]) =>
      document.removeEventListener(type, listener, { capture: true }));
    const box = node.getBoundingClientRect();
    // A target taller than the viewport is pointed at inside its visible part.
    return { x: box.left + box.width / 2, y: Math.max(box.top, 0) + Math.min(box.height / 2, 10) };
  }, selector);
  await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  if (state !== "rest")
    await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  if (state === "active") {
    // The release must not invoke a copy, toast action, native picker or mutation.
    await page.evaluate(() => document.addEventListener("click", event => {
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, once: true }));
    await page._sendToTarget("Input.dispatchMouseEvent",
      { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  }
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
    }
    await new Promise(requestAnimationFrame);
  });
  return page.evaluate(({ selector, state, point }) => {
    const node = document.querySelector(selector), hit = document.elementFromPoint(point.x, point.y);
    // Native radio/switch inputs overlay their painted sibling, sharing a label.
    const host = node.closest("label") ?? node;
    const disabled = host.matches(":disabled") || !!host.querySelector(":disabled");
    window.__p1PointerCleanup(); delete window.__p1PointerCleanup;
    return { requested: state, hover: host.matches(":hover"), active: host.matches(":active"),
      hitInside: host === hit || host.contains(hit), disabled, nativePicker: !!host.querySelector("select"),
      trustedPointer: window.__p1Pointer.length > 0 && window.__p1Pointer.every(event => event.trusted),
      events: window.__p1Pointer };
  }, { selector, state, point });
}

export async function releaseP1Pointer(page) {
  await page._sendToTarget("Input.dispatchMouseEvent",
    { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 });
}
