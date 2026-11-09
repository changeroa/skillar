const codes = Object.freeze({ Tab: 9, Enter: 13, Escape: 27, " ": 32, Home: 36, End: 35, ArrowUp: 38, ArrowDown: 40 });

export async function press(page, key, modifiers = 0) {
  const code = key === " " ? "Space" : key;
  const windowsVirtualKeyCode = codes[key];
  if (!windowsVirtualKeyCode) throw new RangeError(`Unsupported trusted key ${key}`);
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  await page._sendToTarget("Input.dispatchKeyEvent", { ...event, type: "keyDown",
    ...(key === " " || key === "Enter" ? { text: key === "Enter" ? "\r" : " " } : {}) });
  await page._sendToTarget("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
}

/** Register the exact DOM signal before the trusted action, never poll or sleep. */
export async function arm(page, condition) {
  await page.evaluate(condition => {
    window.__qaSignal = new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const onFocus = () => check();
      const timer = setTimeout(() => finish(Error(`State timeout: ${JSON.stringify(condition)}`)), 8000);
      function finish(error) {
        clearTimeout(timer); observer.disconnect(); document.removeEventListener("focusin", onFocus, true);
        error ? reject(error) : resolve();
      }
      function check() {
        const element = document.querySelector(condition.selector);
        if (!element) return;
        let pass;
        switch (condition.kind) {
          case "focus": pass = document.activeElement === element; break;
          case "attribute": pass = element.getAttribute(condition.attribute) === condition.value; break;
          case "text": pass = element.textContent === condition.value; break;
          default: finish(Error("Unknown DOM signal")); return;
        }
        if (pass) finish();
      }
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("focusin", onFocus, true);
      check();
    });
  }, condition);
}

export async function signal(page) {
  await page.evaluate(() => window.__qaSignal);
}

export async function ready(page, selector) {
  await page.evaluate(selector => new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { observer.disconnect(); reject(Error(`Missing ${selector}`)); }, 15000);
    function check() {
      if (!document.querySelector(selector)) return;
      observer.disconnect(); clearTimeout(timer); resolve();
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  }), selector);
  await page.evaluate(async () => { await document.fonts.ready; });
}
