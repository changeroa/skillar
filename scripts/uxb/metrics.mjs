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
    return {
      width: rect.width, height: rect.height,
      paddingTop: parseFloat(style.paddingTop), paddingRight: parseFloat(style.paddingRight),
      paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
      fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight),
      fontWeight: style.fontWeight, radius: parseFloat(style.borderTopLeftRadius),
      borderWidth: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor,
      color: style.color, background: style.backgroundColor,
      outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor, outlineStyle: style.outlineStyle,
      focused: element.matches(":focus-visible"), hovered: element.matches(":hover"),
      active: element.matches(":active"), disabled: element.matches(":disabled"),
      busy: element.getAttribute("aria-busy"), invalid: element.getAttribute("aria-invalid"),
      selected: element.getAttribute("aria-pressed"),
    };
  }, selector);
}
