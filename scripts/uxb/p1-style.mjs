import { P1_PAINT_FIELDS, P1_LOADER_FIELDS, checkP1Inventory } from "./p1-inventory.mjs";
import { p1Descendants, p1Excluded } from "./p1-descendants.mjs";
import { P1_TEXT_FIELDS, compareTextPaint } from "./p1-text-paint.mjs";
/** Fields required by the Phase B contract, including every independent edge. */
export const P1_STYLE_FIELDS = Object.freeze([
  "height", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "fontWeight", "fontFamily", "borderRadius",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "backgroundColor", "color", "opacity", "boxShadow", "outlineColor",
  "outlineWidth", "outlineStyle", "outlineOffset",
]);
const geometry = new Set(["height", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontSize", "lineHeight", "borderRadius", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "outlineWidth", "outlineOffset"]);

export async function readP1Style(page, selector, specimen) {
  const descriptors = specimen ? p1Descendants(specimen.component, specimen.state) : [];
  const excluded = specimen ? p1Excluded(specimen.component, specimen.state) : null;
  return page.evaluate(({ selector, fields, descriptors, textFields, excluded }) => {
    const node = document.querySelector(selector);
    if (!node) throw new RangeError(`Missing style target: ${selector}`);
    const css = getComputedStyle(node);
    // Paint channels are compared as the browser's raw computed declarations.
    // No canvas quantization: distinct oklab/lab serializations must fail.
    const opacityOf = part => {
      let opacity = 1;
      for (let ancestor = part; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity);
      return String(opacity);
    };
    const measure = part => {
      const paint = getComputedStyle(part), box = part.getBoundingClientRect();
      return { values: { ...Object.fromEntries(fields.map(field => [field, paint[field]])),
        opacity: opacityOf(part) },
        geometry: { width: box.width, height: box.height }, glyphs: [],
        visible: part.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) };
    };
    const values = measure(node).values;
    const painted = [...(node.matches("svg") ? [node] : []),
      ...node.querySelectorAll("svg,svg path,svg circle,svg line,svg polyline,svg polygon,svg rect,svg ellipse,svg text,svg use,svg g,.sonner-loading-bar,.lf-toast-loader__bar")]
      .filter(part => !(excluded && part.closest(excluded)));
    // Owner-adapted regions (named per component/state) are measured, never silently dropped.
    const excludedHeight = excluded ? [...node.querySelectorAll(excluded)]
      .reduce((sum, part) => sum + part.getBoundingClientRect().height, 0) : 0;
    const glyphs = painted.map(part => {
      const paint = getComputedStyle(part), loader = part.matches(".sonner-loading-bar,.lf-toast-loader__bar");
      const box = loader ? { width: parseFloat(paint.width), height: parseFloat(paint.height) } : part.getBBox();
      return { tag: loader ? "loader-bar" : part.tagName, width: box.width, height: box.height,
        viewBox: part.getAttribute("viewBox"), viewportWidth: paint.width, viewportHeight: paint.height,
        fill: loader ? paint.backgroundColor : paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth,
        opacity: opacityOf(part), fillOpacity: paint.fillOpacity, strokeOpacity: paint.strokeOpacity,
        dash: paint.strokeDasharray, visibility: paint.visibility, display: paint.display,
        fillRule: paint.fillRule, clipRule: paint.clipRule, strokeLinecap: paint.strokeLinecap,
        strokeLinejoin: paint.strokeLinejoin, strokeMiterlimit: paint.strokeMiterlimit,
        strokeDashoffset: paint.strokeDashoffset, transform: paint.transform, transformOrigin: paint.transformOrigin,
        path: part.getAttribute("d"), points: part.getAttribute("points"),
        ...(loader ? { transform: paint.transform, radius: paint.borderRadius, left: paint.left, top: paint.top } : {}) };
    }).sort((a, b) => a.tag === "loader-bar" && b.tag === "loader-bar" ? 0 :
      `${a.tag}|${a.viewBox}|${a.viewportWidth}|${a.path}|${a.points}`.localeCompare(`${b.tag}|${b.viewBox}|${b.viewportWidth}|${b.path}|${b.points}`));
    const rect = node.getBoundingClientRect();
    const family = node.closest("[data-component]")?.dataset.component;
    const kind = node.matches("[role=switch],.lf-switch__track") ? "thumb"
      : node.matches(".lf-radio__ring") || family === "Radio" ? "dot"
      : node.matches(".lf-avatar") || family === "Avatar" || node.parentElement?.matches("[role=img]") ? "avatar" : null;
    const parts = kind ? [...node.children].filter(part => part.matches("span,img")).map(part => {
      const box = part.getBoundingClientRect();
      return { role: kind === "avatar" ? part.matches("img") ? "image" : "fallback" : kind,
        x: box.x - rect.x, y: box.y - rect.y, style: measure(part) };
    }) : [];
    // Form controls paint their value or placeholder, not DOM text nodes.
    const controlText = part => {
      const value = part.value ?? "";
      const css = value === "" ? getComputedStyle(part, "::placeholder") : getComputedStyle(part);
      const text = (value === "" ? part.placeholder ?? "" : value).replace(/\s+/g, "");
      if (!text) return [];
      const own = value === "" ? Number(css.opacity) : 1;
      return [{ text, source: value === "" ? "placeholder" : "value", values: {
        ...Object.fromEntries(textFields.map(field => [field, css[field]])),
        opacity: String(Number(opacityOf(part)) * own) } }];
    };
    const product = !node.closest("#mit-ready") && node.matches(".lf-markdown,.lf-codeblock,.lf-toast,.lf-diff-scroll," +
      ".lf-combobox__input,.lf-combobox__popup,.lf-select-wrap,textarea.lf-textarea,input.lf-input");
    const descendants = descriptors.map(descriptor => {
      const selector = product ? descriptor.actual : descriptor.source;
      const scope = descriptor.scope === "specimen" ? node.closest("[data-specimen],section[data-component]") : node;
      const nodes = selector === ":scope" ? [node] : [...scope.querySelectorAll(selector)];
      const control = product ? descriptor.actualControl : descriptor.sourceControl;
      return { role: descriptor.role, expectedCount: descriptor.count, textOnly: descriptor.textOnly === true, styles: nodes.map(part => {
        const style = measure(part);
        if (control) return { ...style, textPaint: controlText(part) };
        const textRoot = product && descriptor.actualText ? part.querySelector(descriptor.actualText) : part;
        const walker = document.createTreeWalker(textRoot ?? part, NodeFilter.SHOW_TEXT);
        const textPaint = [];
        for (let textNode = descriptor.textPaint === false ? null : walker.nextNode(); textNode; textNode = walker.nextNode()) {
          const text = textNode.textContent.replace(/\s+/g, "");
          if (!text) continue;
          const parent = textNode.parentElement, css = getComputedStyle(parent);
          textPaint.push({ text, values: { ...Object.fromEntries(textFields.map(field => [field, css[field]])),
            opacity: opacityOf(parent) } });
        }
        // The labelled MIT narrow fixture includes the owner's line-number/sign
        // prefix as input. Product metadata is separately painted outside code.
        if (!product && descriptor.actualText && node.closest("#mit-ready")) {
          const prefix = textPaint.map(run => run.text).join("").match(/^1[−+=]/)?.[0] ?? "";
          let remaining = prefix.length;
          for (const run of textPaint) {
            const skip = Math.min(remaining, run.text.length); run.text = run.text.slice(skip); remaining -= skip;
          }
        }
        return { ...style, textPaint: textPaint.filter(run => run.text.length > 0) };
      }) };
    });
    return { values, rawValues: Object.fromEntries(fields.map(field => [field, css[field]])),
      text: node.textContent, geometry: { width: rect.width, height: rect.height },
      rawOpacity: css.opacity, glyphs, parts, descendants, excludedHeight, focusVisible: node.matches(":focus-visible"),
      focusWithin: node.matches(":focus-visible") || !!node.querySelector(":focus-visible"),
      visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) };
  }, { selector, fields: P1_STYLE_FIELDS, descriptors, textFields: P1_TEXT_FIELDS, excluded });
}

/** Explicit owner adaptations are passed as measured-property replacements, never blanket exemptions. */
export function compareP1Style(reference, actual, policy = {}) {
  const failures = [];
  if (!reference) return [{ field: "reference", expected: "REAL-DEMO or ACTUAL-PINNED-MIT", actual: null }];
  if (policy.inventory) for (const [side, style] of [["reference", reference], ["actual", actual]])
    failures.push(...checkP1Inventory(style, policy.inventory).map(failure => ({ ...failure, field: `${side}.${failure.field}` })));
  if (reference.visible !== actual.visible)
    failures.push({ field: "visible", expected: reference.visible, actual: actual.visible });
  for (const field of P1_STYLE_FIELDS) {
    const expected = policy[field] ?? reference.values[field], received = actual.values[field];
    if (expected === undefined || received === undefined) { failures.push({ field, expected, actual: received }); continue; }
    const tolerance = (field === "height" || field === "width") && policy[field] !== undefined ? .01 : 1;
    const normalizeShadow = value => value.replace(/rgba\([^)]*,\s*0\)\s[-.\dpx\s]+,?\s*/g, "")
      .replace(/rgba?\([^)]*\) 0px 0px 0px 0px(?: inset)?(?:,\s*)?/g, "").replace(/^,\s*/, "").replace(/,\s*$/, "").trim() || "none";
    const match = geometry.has(field) && Number.isFinite(parseFloat(expected)) && Number.isFinite(parseFloat(received))
      ? Math.abs(parseFloat(expected) - parseFloat(received)) <= tolerance
      : field === "boxShadow" ? normalizeShadow(expected) === normalizeShadow(received) : expected === received;
    if (!match) failures.push({ field, expected, actual: received });
  }
  if (reference.glyphs.length !== actual.glyphs.length) failures.push({ field: "glyphs.length", expected: reference.glyphs.length, actual: actual.glyphs.length });
  for (const [index, glyph] of reference.glyphs.entries()) {
    const painted = actual.glyphs[index];
    if (!painted) continue;
    for (const key of [...P1_PAINT_FIELDS, ...(glyph.tag === "loader-bar" ? P1_LOADER_FIELDS : [])]) {
      const expected = glyph[key], received = painted[key];
      const match = expected !== undefined && received !== undefined &&
        (typeof expected === "number" ? Math.abs(expected - received) <= 1 : expected === received);
      if (!match) failures.push({ field: `glyphs.${index}.${key}`, expected, actual: received });
    }
  }
  const referenceParts = reference.parts ?? [], actualParts = actual.parts ?? [];
  if (referenceParts.length !== actualParts.length)
    failures.push({ field: "parts.length", expected: referenceParts.length, actual: actualParts.length });
  for (const [index, part] of referenceParts.entries()) {
    const measured = actualParts[index];
    if (!measured) continue;
    for (const key of ["role", "x", "y"]) {
      const match = key === "role" ? part[key] === measured[key] : Math.abs(part[key] - measured[key]) <= 1;
      if (!match) failures.push({ field: `parts.${index}.${key}`, expected: part[key], actual: measured[key] });
    }
    failures.push(...compareP1Style(part.style, measured.style).map(failure => ({ ...failure, field: `parts.${index}.${failure.field}` })));
  }
  const expectedDescendants = reference.descendants ?? [], receivedDescendants = actual.descendants ?? [];
  failures.push(...compareTextPaint(reference.textPaint, actual.textPaint));
  if (expectedDescendants.length !== receivedDescendants.length)
    failures.push({ field: "descendants.length", expected: expectedDescendants.length, actual: receivedDescendants.length });
  for (const [index, part] of expectedDescendants.entries()) {
    const received = receivedDescendants[index];
    for (const [side, record] of [["reference", part], ["actual", received]]) {
      if (record?.styles.length !== part.expectedCount)
        failures.push({ field: `descendants.${part.role}.${side}.count`, expected: part.expectedCount, actual: record?.styles.length });
    }
    if (!received) continue;
    for (const [position, style] of part.styles.entries()) {
      if (!received.styles[position]) continue;
      if (part.textOnly) {
        // Box geometry of a text carrier differs by anatomy (overlay input vs span); its painted text does not.
        const prefix = `descendants.${part.role}.${position}`;
        if (style.visible !== received.styles[position].visible)
          failures.push({ field: `${prefix}.visible`, expected: style.visible, actual: received.styles[position].visible });
        failures.push(...compareTextPaint(style.textPaint, received.styles[position].textPaint)
          .map(failure => ({ ...failure, field: `${prefix}.${failure.field}` })));
        continue;
      }
      const overrides = policy.descendants?.[part.role] ?? {};
      failures.push(...compareP1Style(style, received.styles[position], overrides)
        .map(failure => ({ ...failure, field: `descendants.${part.role}.${position}.${failure.field}` })));
    }
  }
  return failures;
}
