import { press } from "./trusted-keys.mjs";
import { paintedFocus } from "./focus-paint.mjs";

/** Keyboard modality is established before reading every real focus target. */
export async function measureTableFocus(page, selector = [
  ".lf-table-surface :is(button,a,input,select,[tabindex])",
  ".lf-table-toolbar :is(button,input,select)", ".lf-facet-panel :is(button,input)",
].join(","), output) {
  // Tab intentionally dismisses a menu; use its native roving-focus key instead.
  await press(page, selector.includes(".lf-menu") ? "ArrowDown" : "Tab");
  const result = await page.evaluate(selector => {
    const minimum = matchMedia("(pointer:coarse)").matches || innerWidth <= 768 ? 44 : 32;
    const nodes = [...document.querySelectorAll(selector)].filter(node =>
      (node.tabIndex >= 0 || node.matches('[role="menuitemcheckbox"],[role="menuitem"]')) &&
      !node.disabled && node.getClientRects().length && !node.closest("[hidden]"));
    const readings = nodes.map((node, index) => {
      node.dataset.qaFocusProbe = String(index);
      node.focus({ preventScroll: true });
      const paint = node.matches('input[type="checkbox"],input[type="radio"]') ? node.nextElementSibling :
        node.matches("select") ? node.closest(".lf-select-wrap") : node;
      const css = getComputedStyle(paint);
      const box = node.getBoundingClientRect();
      const focused = document.activeElement === node && node.matches(":focus-visible");
      return { tag: node.tagName, label: node.getAttribute("aria-label") ?? node.textContent.slice(0, 40),
        height: box.height, width: box.width, focused,
        outline: [css.outlineWidth, css.outlineStyle, css.outlineColor, css.outlineOffset],
        shadow: css.boxShadow, pass: focused && box.width >= minimum - 1 &&
          (node.matches("button,input,select") ? Math.abs(box.height - minimum) <= .01 : box.height >= minimum - 1) };
    });
    return { minimum, readings, pass: readings.length > 0 && readings.every(reading => reading.pass),
      failures: readings.filter(reading => !reading.pass) };
  }, selector);
  try {
    for (const [index, reading] of result.readings.entries()) {
      reading.pixels = await paintedFocus(page, `[data-qa-focus-probe="${index}"]`, output && `${output}-${index}`);
      reading.pass &&= reading.pixels.pass;
    }
    result.failures = result.readings.filter(reading => !reading.pass);
    result.pass = result.readings.length > 0 && !result.failures.length;
    return result;
  } finally {
    await page.evaluate(() => document.querySelectorAll("[data-qa-focus-probe]")
      .forEach(node => node.removeAttribute("data-qa-focus-probe")));
  }
}
