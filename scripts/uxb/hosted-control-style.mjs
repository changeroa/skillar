import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

export const numericFields = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "fontWeight",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "opacity",
];
export const colorFields = [
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "backgroundColor", "color",
];
export const metricFields = [
  "height", ...numericFields, ...colorFields, "focusVisible", "outlineWidth", "outlineStyle",
  "outlineOffset", "outlineColor", "shadows", "disabled", "checked",
];

export async function measureHostedStyle(page, target) {
  return page.evaluate(({ selector, paddingSelector, numericFields, colorFields }) => {
    const node = document.querySelector(selector);
    if (!node?.checkVisibility()) throw Error(`Invisible style target: ${selector}`);
    const css = getComputedStyle(node);
    const padding = getComputedStyle(document.querySelector(paddingSelector));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function color(value) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }
    const shadows = css.boxShadow === "none" ? [] : css.boxShadow.split(/,(?![^()]*\))/).flatMap(value => {
      const ink = value.match(/(?:rgba?|color|oklch|oklab)\([^)]*\)/)?.[0];
      if (!ink) throw Error(`Unsupported computed shadow: ${value}`);
      const rgba = color(ink);
      const lengths = value.replace(ink, "").replace("inset", "").trim().split(/\s+/).map(parseFloat);
      while (lengths.length < 4) lengths.push(0);
      if (rgba[3] === 0 || lengths.every(length => length === 0)) return [];
      return [{ inset: value.includes("inset"), lengths, color: rgba }];
    });
    const paintedOutline = !["none", "hidden"].includes(css.outlineStyle) && parseFloat(css.outlineWidth) > 0;
    return {
      height: node.getBoundingClientRect().height,
      ...Object.fromEntries(numericFields.map(key => [key, parseFloat((key.startsWith("padding") ? padding : css)[key])])),
      ...Object.fromEntries(colorFields.map(key => [key, color(css[key])])),
      focusVisible: node.matches(":focus-visible"),
      outlineWidth: paintedOutline ? parseFloat(css.outlineWidth) : 0,
      outlineStyle: paintedOutline ? css.outlineStyle : "none",
      outlineOffset: paintedOutline ? parseFloat(css.outlineOffset) : 0,
      outlineColor: paintedOutline ? color(css.outlineColor) : null,
      shadows,
      disabled: Boolean(node.disabled),
      checked: node.matches(":checked") || node.getAttribute("aria-checked") === "true",
    };
  }, { selector: target.selector, paddingSelector: target.paddingSelector ?? target.selector, numericFields, colorFields });
}

export function assertHostedStyle(actual, expected, context = "hosted control") {
  for (const side of [actual, expected]) {
    for (const key of metricFields) assert.ok(Object.hasOwn(side, key), `${context}: missing ${key}`);
    for (const key of ["height", ...numericFields, "outlineWidth", "outlineOffset"])
      assert.ok(Number.isFinite(side[key]), `${context}: invalid numeric ${key}`);
    for (const key of colorFields) assert.ok(Array.isArray(side[key]) && side[key].length === 4, `${context}: invalid ${key}`);
  }
  const differences = metricFields.flatMap(key => isDeepStrictEqual(actual[key], expected[key]) ? [] :
    [{ property: key, expected: expected[key], actual: actual[key] }]);
  assert.deepEqual(differences, [], context);
}

export function assertDemoConcordance(source, record, policy) {
  const fields = record.styles;
  for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontSize", "lineHeight", "fontWeight", "opacity"]) {
    assert.ok(Number.isFinite(parseFloat(fields[key])), `${record.id}: missing Demo ${key}`);
    assert.equal(source[key], parseFloat(fields[key]), `${record.id}: pinned/Demo ${key}`);
  }
  for (const [shorthand, properties] of [
    ["borderRadius", ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]],
    ["borderWidth", ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]],
  ]) {
    assert.match(fields[shorthand], /^\d+(?:\.\d+)?px$/, `${record.id}: uniform Demo ${shorthand}`);
    for (const property of properties) assert.equal(source[property], parseFloat(fields[shorthand]), `${record.id}: pinned/Demo ${property}`);
  }
  const match = fields.borderColor.match(/^rgba?\(([\d., ]+)\)$/);
  assert.ok(match, `${record.id}: token-exact Demo border color`);
  const parts = match[1].split(",").map(Number);
  const color = [...parts.slice(0, 3), Math.round((parts[3] ?? 1) * 255)];
  for (const property of colorFields.filter(key => key.startsWith("border"))) assert.deepEqual(source[property], color, `${record.id}: pinned/Demo ${property}`);
  assert.equal(source.height, policy.width === 390 && policy.control !== "checkbox" ? 44 : parseFloat(fields.height),
    `${record.id}: Demo height with absolute touch override`);
}

export function expectedHostedStyle(source, policy) {
  const expected = structuredClone(source);
  const overrides = [];
  if (policy.interactive) {
    expected.height = policy.control === "checkbox" ? 24 : policy.width === 390 ? 44 : 32;
    overrides.push({ property: "height", value: expected.height, reason: policy.control === "checkbox" ?
      "Existing native 24px checkbox inside its named 44px choice" : "Absolute owner 32px mouse / 44px touch control" });
  }
  if (policy.control === "danger-quiet") {
    expected.color = policy.destructive;
    overrides.push({ property: "color", value: policy.destructive, reason: "Existing native destructive-quiet semantic ink" });
  }
  if (policy.state === "focus-visible") {
    Object.assign(expected, { focusVisible: true, outlineWidth: 2, outlineStyle: "solid",
      outlineOffset: 2, outlineColor: policy.accent, shadows: [] });
    overrides.push({ property: "focus ring", value: { width: 2, offset: 2, color: policy.accent },
      reason: "Contrasting primary-accent outline; replaces the source neutral shadow, never typography or padding" });
  }
  return { expected, overrides };
}
