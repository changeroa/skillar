import { press } from "./trusted-keys.mjs";

/** Keyboard modality is established before reading every real focus target. */
export async function measureTableFocus(page, selector = [
  ".lf-table-surface :is(button,a,input,select,[tabindex])",
  ".lf-table-toolbar :is(button,input,select)", ".lf-facet-panel :is(button,input)",
].join(",")) {
  // Tab intentionally dismisses a menu; use its native roving-focus key instead.
  await press(page, selector.includes(".lf-menu") ? "ArrowDown" : "Tab");
  return page.evaluate(selector => {
    const minimum = matchMedia("(pointer:coarse)").matches || innerWidth <= 768 ? 44 : 32;
    const nodes = [...document.querySelectorAll(selector)].filter(node =>
      (node.tabIndex >= 0 || node.matches('[role="menuitemcheckbox"],[role="menuitem"]')) &&
      !node.disabled && node.getClientRects().length && !node.closest("[hidden]"));
    const readings = nodes.map(node => {
      node.focus({ preventScroll: true });
      const paint = node.matches('input[type="checkbox"],input[type="radio"]') ? node.nextElementSibling :
        node.matches("select") ? node.closest(".lf-select-wrap") : node;
      const css = getComputedStyle(paint);
      const shadow = [...css.boxShadow.matchAll(/(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px/g)]
        .some(match => Number(match[5]) >= 2 && !/rgba\([^)]*, 0\)/.test(match[1]));
      const outline = css.outlineStyle !== "none" && Number.parseFloat(css.outlineWidth) >= 2 &&
        !/rgba\([^)]*, 0\)/.test(css.outlineColor);
      const box = node.getBoundingClientRect();
      const focused = document.activeElement === node && node.matches(":focus-visible");
      return { tag: node.tagName, label: node.getAttribute("aria-label") ?? node.textContent.slice(0, 40),
        height: box.height, width: box.width, focused,
        outline: [css.outlineWidth, css.outlineStyle, css.outlineColor, css.outlineOffset],
        shadow: css.boxShadow, pass: focused && (outline || shadow) &&
          box.height >= minimum - 1 && box.width >= minimum - 1 };
    });
    return { minimum, readings, pass: readings.length > 0 && readings.every(reading => reading.pass),
      failures: readings.filter(reading => !reading.pass) };
  }, selector);
}
