import { randomUUID } from "node:crypto";

export class HarnessError extends Error {
  constructor(message) {
    super(`HARNESS ERROR: ${message}`);
    this.name = "HarnessError";
  }
}

export async function focusTrustedInput(page) {
  await page._sendToTarget("Page.bringToFront");
  await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page._sendToTarget("Runtime.evaluate", { expression: "window.focus()", returnByValue: true });
  if (!await page.evaluate(() => document.hasFocus()))
    throw new HarnessError("document.hasFocus() is false; trusted input cannot be tested");
}

export async function createTrustedInput(page) {
  const binding = `__vqaKeydown_${randomUUID().replaceAll("-", "")}`;
  await page._sendToTarget("Runtime.enable");
  await page._sendToTarget("Runtime.addBinding", { name: binding });
  let receive = null, delivered = 0;
  const unsubscribe = page.cdp.on("Runtime.bindingCalled", event => {
    if (event.name === binding) receive?.(JSON.parse(event.payload));
  });
  const focus = async () => {
    await focusTrustedInput(page);
    return page.evaluate(name => {
      window.__vqaKeydownCounters ??= {};
      if (!(name in window.__vqaKeydownCounters)) {
        window.__vqaKeydownCounters[name] = 0;
        window.addEventListener("keydown", event => {
          const count = ++window.__vqaKeydownCounters[name];
          window[name](JSON.stringify({ key: event.key, count, trusted: event.isTrusted }));
        }, { capture: true });
      }
      return window.__vqaKeydownCounters[name];
    }, binding);
  };
  return {
    focus,
    get delivered() { return delivered; },
    async press(parameters) {
      const before = await focus();
      let timer;
      // The binding receipt survives Enter navigating away from this document.
      const received = new Promise((resolve, reject) => {
        receive = event => { if (event.key === parameters.key) resolve(event); };
        timer = setTimeout(() => reject(new HarnessError(
          `window keydown counter did not increase after ${parameters.key} (before=${before}, no receipt)`)), 15000);
      });
      try {
        const [event] = await Promise.all([received,
          page._sendToTarget("Input.dispatchKeyEvent", { ...parameters, type: "keyDown" })]);
        if (event.count <= before || !event.trusted)
          throw new HarnessError(`window keydown counter did not increase with trusted input after ${parameters.key}: ${before} -> ${event.count}, trusted=${event.trusted}`);
        delivered++;
        await page._sendToTarget("Input.dispatchKeyEvent", { ...parameters, type: "keyUp" });
      } finally { receive = null; clearTimeout(timer); }
    },
    async dispose() {
      unsubscribe();
      await page._sendToTarget("Runtime.removeBinding", { name: binding });
    },
  };
}
