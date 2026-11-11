/**
 * Owner-approved native controls: the inner input/select is the real hit target.
 * Its paint is compared through text runs; this contract proves it is mounted,
 * shown and on top. A select overlay is transparent by design (its value is painted
 * by a sibling span); every other inner control paints its own text.
 */
export const P1_NATIVE = Object.freeze({
  Textarea: ":scope", DateRangeInput: ":scope", Combobox: ":scope > input",
  MultiSelect: ":scope > input", TimePeriodSelect: ":scope > select",
});

export async function readP1Native(page, selector, component) {
  const inner = P1_NATIVE[component];
  if (!inner) return null;
  return page.evaluate(({ selector, inner }) => {
    const root = document.querySelector(selector);
    if (!root) throw new RangeError(`Missing native root: ${selector}`);
    const control = inner === ":scope" ? root : root.querySelector(inner);
    if (!control) return { present: false };
    control.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const css = getComputedStyle(control), outer = root.getBoundingClientRect(), box = control.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(root).borderTopWidth) || 0;
    const covers = ["left", "top"].every(edge => box[edge] <= outer[edge] + border + 1) &&
      ["right", "bottom"].every(edge => box[edge] >= outer[edge] - border - 1);
    const hit = document.elementFromPoint(outer.left + outer.width / 2, outer.top + outer.height / 2);
    return { present: true, tag: control.tagName, visibility: css.visibility, display: css.display,
      pointerEvents: css.pointerEvents, opacity: css.opacity, covers, hit: hit === control,
      shown: control.checkVisibility({ checkVisibilityCSS: true }) };
  }, { selector, inner });
}

export function checkP1Native(record, component) {
  if (!P1_NATIVE[component]) return [];
  if (!record?.present) return [{ field: "native.present", expected: true, actual: false }];
  const expected = { visibility: "visible", pointerEvents: "auto", covers: true, hit: true, shown: true };
  const failures = Object.entries(expected).filter(([field, value]) => record[field] !== value)
    .map(([field, value]) => ({ field: `native.${field}`, expected: value, actual: record[field] }));
  // Text-painting controls must not be transparent (disabled dims to 0.5); the select overlay must be.
  const transparent = record.opacity === "0", overlay = component === "TimePeriodSelect";
  if (transparent !== overlay) failures.push({ field: "native.opacity", expected: overlay ? "0" : "> 0", actual: record.opacity });
  if (record.display === "none") failures.push({ field: "native.display", expected: "not none", actual: record.display });
  return failures;
}
