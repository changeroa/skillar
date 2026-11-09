/** The clipboard seam is local-fixture-only; the hosted Demo is never mocked. */
export async function captureClipboardState(page, { selector, actionSelector, action }) {
  const wanted = action === "copy-error" ? "failed" : action;
  await page.evaluate(({ selector, wanted }) => {
    if (!["127.0.0.1", "localhost"].includes(location.hostname))
      throw Error("Clipboard state fixtures are restricted to localhost");
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let complete;
    window.__uxbRestoreClipboard = () => {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
      complete?.();
      delete window.__uxbRestoreClipboard;
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => {
        if (wanted === "failed") return Promise.reject(new Error("Fixture clipboard permission denied"));
        if (wanted === "copying") return new Promise(resolve => { complete = resolve; });
        return Promise.resolve();
      },
    } });
    window.__uxbClipboardSignal = new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => { observer.disconnect(); reject(Error(`Missing clipboard state ${wanted}`)); }, 8000);
      function check() {
        const root = document.querySelector(selector);
        if (root?.getAttribute("data-copy-state") !== wanted) return;
        observer.disconnect(); clearTimeout(timer); resolve();
      }
      observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      check();
    });
  }, { selector, wanted });
  const restore = () => page.evaluate(() => window.__uxbRestoreClipboard());
  try {
    const point = await page.evaluate(selector => {
      const button = document.querySelector(selector);
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, actionSelector ?? `${selector} button`);
    await page._sendToTarget("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await page.evaluate(() => window.__uxbClipboardSignal);
    await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    const visible = await page.evaluate(({ selector, wanted }) => {
      const root = document.querySelector(selector), button = root.querySelector("button");
      if (wanted === "copying") return button.disabled && button.getAttribute("aria-busy") === "true";
      if (wanted === "failed") return !button.disabled && root.querySelector('[role="status"]').textContent.length > 0;
      return !button.disabled && !button.querySelector("rect") && Boolean(button.querySelector("svg path"));
    }, { selector, wanted });
    if (!visible) throw Error(`Clipboard fixture did not expose ${wanted}`);
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}
