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
      JSON.stringify(actual[field]) === JSON.stringify(expected[field]),
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

/** Run in Chromium for both stored source strings and actual computed styles.
 * CSS Typed OM preserves auto/percentage height instead of substituting data height.
 * Invisible outlines and transparent zero shadows are canonical non-paint.
 */
export function normalizeComponentStyle(css, height) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  const color = value => {
    if (!value || !CSS.supports("color", value)) throw Error(`Missing style color: ${value}`);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const padding = (css.padding ?? "0px").split(/\s+/);
  const sides = ["Top", "Right", "Bottom", "Left"];
  const values = { height, fontSize: css.fontSize, lineHeight: css.lineHeight,
    fontWeight: css.fontWeight, borderRadius: css.borderRadius };
  for (const [index, side] of sides.entries()) {
    values[`padding${side}`] = css[`padding${side}`] ??
      padding[index] ?? padding[index % 2] ?? padding[0];
    values[`border${side}Width`] = css[`border${side}Width`] ?? css.borderWidth ?? css.borderTopWidth;
    values[`border${side}Color`] = color(css[`border${side}Color`] ?? css.borderColor ?? css.borderTopColor);
  }
  const outline = css.outline?.match(/(.+)\s+(none|solid|dashed|dotted|double)\s+([\d.]+px)$/);
  const outlineStyle = css.outlineStyle ?? outline?.[2];
  const paintedOutline = outlineStyle && !["none", "hidden"].includes(outlineStyle);
  Object.assign(values, {
    outlineStyle: paintedOutline ? outlineStyle : "none",
    outlineWidth: paintedOutline ? css.outlineWidth ?? outline?.[3] : "0px",
    outlineOffset: paintedOutline ? css.outlineOffset : "0px",
    outlineColor: paintedOutline ? color(css.outlineColor ?? outline?.[1]) : null,
  });
  if (css.boxShadow === undefined) throw Error("Missing boxShadow");
  values.boxShadow = css.boxShadow === "none" ? [] :
    css.boxShadow.split(/,(?![^()]*\))/).flatMap(layer => {
      const ink = layer.match(/(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\([^)]*\)/)?.[0];
      if (!ink) throw Error(`Unsupported shadow: ${layer}`);
      const rgba = color(ink), lengths = layer.replace(ink, "").match(/-?[\d.]+px/g)?.map(parseFloat);
      return rgba[3] === 0 || lengths?.every(n => n === 0) ? [] :
        [{ color: rgba, lengths, inset: layer.includes("inset") }];
    });
  return values;
}
