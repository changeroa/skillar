/** Fields required by the Phase B contract, including every independent edge. */
export const P1_STYLE_FIELDS = Object.freeze([
  "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "fontWeight", "fontFamily", "borderRadius",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "backgroundColor", "color", "opacity", "boxShadow", "outlineColor",
  "outlineWidth", "outlineStyle", "outlineOffset",
]);
const geometry = new Set(["height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "borderRadius", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "outlineWidth", "outlineOffset"]);

export async function readP1Style(page, selector) {
  return page.evaluate(({ selector, fields }) => {
    const node = document.querySelector(selector);
    if (!node) throw new RangeError(`Missing style target: ${selector}`);
    const css = getComputedStyle(node);
    const values = Object.fromEntries(fields.map(field => [field, css[field]]));
    let opacity = 1;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity);
    values.opacity = String(opacity);
    const glyphs = [...node.querySelectorAll("svg,svg path,svg circle,svg line,svg polyline,svg rect,.sonner-loading-bar,.lf-toast-loader__bar")].map(part => {
      const paint = getComputedStyle(part), loader = part.matches(".sonner-loading-bar,.lf-toast-loader__bar");
      const box = loader ? { width: parseFloat(paint.width), height: parseFloat(paint.height) } : part.getBBox();
      return { tag: loader ? "loader-bar" : part.tagName, width: box.width, height: box.height,
        viewBox: part.getAttribute("viewBox"), viewportWidth: paint.width, viewportHeight: paint.height,
        fill: loader ? paint.backgroundColor : paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth,
        opacity: paint.opacity, fillOpacity: paint.fillOpacity, strokeOpacity: paint.strokeOpacity,
        dash: paint.strokeDasharray, visibility: paint.visibility, display: paint.display,
        path: part.getAttribute("d"), points: part.getAttribute("points"),
        ...(loader ? { transform: paint.transform, radius: paint.borderRadius, left: paint.left, top: paint.top } : {}) };
    }).sort((a, b) => a.tag === "loader-bar" && b.tag === "loader-bar" ? 0 :
      `${a.tag}|${a.viewBox}|${a.viewportWidth}|${a.path}|${a.points}`.localeCompare(`${b.tag}|${b.viewBox}|${b.viewportWidth}|${b.path}|${b.points}`));
    return { values, rawOpacity: css.opacity, glyphs, focusVisible: node.matches(":focus-visible"), visible: node.checkVisibility({ checkOpacity: true }) };
  }, { selector, fields: P1_STYLE_FIELDS });
}

/** Explicit owner adaptations are passed as measured-property replacements, never blanket exemptions. */
export function compareP1Style(reference, actual, policy = {}) {
  const failures = [];
  if (!reference) return [{ field: "reference", expected: "REAL-DEMO or ACTUAL-PINNED-MIT", actual: null }];
  for (const field of P1_STYLE_FIELDS) {
    const expected = policy[field] ?? reference.values[field], received = actual.values[field];
    if (expected === undefined || received === undefined) { failures.push({ field, expected, actual: received }); continue; }
    const tolerance = field === "height" && policy.height !== undefined ? .01 : 1;
    const normalizeShadow = value => value.replace(/rgba\([^)]*,\s*0\)\s[-.\dpx\s]+,?\s*/g, "").replace(/^,\s*/, "").trim() || "none";
    const match = geometry.has(field) && Number.isFinite(parseFloat(expected)) && Number.isFinite(parseFloat(received))
      ? Math.abs(parseFloat(expected) - parseFloat(received)) <= tolerance
      : field === "boxShadow" ? normalizeShadow(expected) === normalizeShadow(received) : expected === received;
    if (!match) failures.push({ field, expected, actual: received });
  }
  if (reference.glyphs.length !== actual.glyphs.length) failures.push({ field: "glyphs.length", expected: reference.glyphs.length, actual: actual.glyphs.length });
  for (const [index, glyph] of reference.glyphs.entries()) {
    const painted = actual.glyphs[index];
    if (!painted) continue;
    for (const key of Object.keys(glyph)) {
      const expected = glyph[key], received = painted[key];
      const match = typeof expected === "number" ? Math.abs(expected - received) <= 1 : expected === received;
      if (!match) failures.push({ field: `glyphs.${index}.${key}`, expected, actual: received });
    }
  }
  return failures;
}
