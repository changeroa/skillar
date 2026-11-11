/** Complete required computed-style contract, shared by ready and non-ready gates. */
export const componentStyleFields = [
  "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "fontWeight", "borderRadius",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "outlineColor", "outlineStyle", "outlineWidth", "outlineOffset", "boxShadow",
];

export function compareComponentStyle(actual, expected) {
  return componentStyleFields.map(field => ({
    field, actual: actual?.[field], expected: expected?.[field],
    pass: actual?.[field] !== undefined && expected?.[field] !== undefined &&
      actual[field] === expected[field],
  }));
}

/** Missing and hidden expected nodes remain failed observations, never omissions. */
export function readComponentStyles(root, selector, fields) {
  const nodes = selector === ":scope" ? [root] : [...root.querySelectorAll(selector)];
  if (!nodes.length) return [{ missing: true, actual: null }];
  return nodes.map((node, index) => ({
    index, missing: !node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
    actual: Object.fromEntries(fields.map(field => [field, getComputedStyle(node)[field]])),
  }));
}
