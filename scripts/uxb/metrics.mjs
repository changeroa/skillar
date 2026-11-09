export function metricFailures(actual, expected, tolerance = 1) {
  const failures = [];
  for (const [property, value] of Object.entries(expected)) {
    const measured = actual[property];
    const valid = typeof value === "number"
      ? typeof measured === "number" && Math.abs(measured - value) <= tolerance
      : measured === value;
    if (!valid) failures.push({ property, expected: value, actual: measured });
  }
  return failures;
}

export async function measure(page, selector) {
  return page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) throw Error(`Missing specimen: ${selector}`);
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const semantic = element.querySelector("select") ?? element;
    return {
      width: rect.width, height: rect.height,
      paddingTop: parseFloat(style.paddingTop), paddingRight: parseFloat(style.paddingRight),
      paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
      fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight),
      fontFamily: style.fontFamily, fontWeight: style.fontWeight, radius: parseFloat(style.borderTopLeftRadius),
      borderWidth: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor,
      color: style.color, background: style.backgroundColor,
      outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor, outlineStyle: style.outlineStyle,
      focused: semantic.matches(":focus-visible"), hovered: element.matches(":hover"),
      active: semantic.matches(":active"), disabled: semantic.matches(":disabled") ||
        Boolean(element.closest("label")?.querySelector("input:disabled")),
      busy: semantic.getAttribute("aria-busy"), invalid: semantic.getAttribute("aria-invalid"),
      selected: semantic.getAttribute("aria-pressed"),
    };
  }, selector);
}
