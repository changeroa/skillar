const codes = Object.freeze({ Tab: 9, Enter: 13, Escape: 27, " ": 32, Home: 36, End: 35, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40 });

export async function press(page, key, modifiers = 0) {
  const code = key === " " ? "Space" : key;
  const windowsVirtualKeyCode = codes[key];
  if (!windowsVirtualKeyCode) throw new RangeError(`Unsupported trusted key ${key}`);
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  await page._sendToTarget("Input.dispatchKeyEvent", { ...event, type: "keyDown",
    ...(key === " " || key === "Enter" ? { text: key === "Enter" ? "\r" : " " } : {}) });
  await page._sendToTarget("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
}

export async function typeahead(page, text, code, windowsVirtualKeyCode) {
  await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyDown", key: text, text, code, windowsVirtualKeyCode });
  await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyUp", key: text, code, windowsVirtualKeyCode });
}

/** Register the exact DOM signal before the trusted action, never poll or sleep. */
export async function arm(page, condition) {
  await page.evaluate(condition => {
    window[condition.key ?? "__qaSignal"] = new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const onFocus = () => check();
      const timer = setTimeout(() => finish(Error(`State timeout: ${JSON.stringify(condition)}`)), 8000);
      function finish(error) {
        clearTimeout(timer); observer.disconnect(); document.removeEventListener("focusin", onFocus, true);
        error ? reject(error) : resolve();
      }
      function check() {
        const element = document.querySelector(condition.selector);
        if (condition.kind === "absent") {
          if (!element) finish();
          return;
        }
        if (!element) return;
        let pass;
        switch (condition.kind) {
          case "present": pass = true; break;
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

export async function signal(page, key = "__qaSignal") {
  await page.evaluate(key => window[key], key);
}

export async function ready(page, selector) {
  await arm(page, { kind: "present", selector });
  await signal(page);
  await page.evaluate(async () => { await document.fonts.ready; });
}
