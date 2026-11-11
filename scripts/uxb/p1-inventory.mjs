import { p1Descendants } from "./p1-descendants.mjs";
/** Source-reviewed, fixed anatomy. Never derive this inventory from visible DOM. */
export const P1_PAINT_FIELDS = Object.freeze([
  "tag", "width", "height", "viewBox", "viewportWidth", "viewportHeight",
  "fill", "stroke", "strokeWidth", "opacity", "fillOpacity", "strokeOpacity",
  "dash", "visibility", "display", "path", "points",
]);
export const P1_LOADER_FIELDS = Object.freeze(["transform", "radius", "left", "top"]);

function paintInventory(component, state) {
  switch (component) {
    case "Textarea": case "DateRangeInput": return { glyphs: [], parts: [] };
    case "Combobox": case "MultiSelect": case "TimePeriodSelect":
      return { glyphs: ["path", "svg"], parts: [] };
    case "Switch": return { glyphs: [], parts: ["thumb"] };
    case "Radio": return { glyphs: [], parts: ["dot"] };
    case "Avatar": return { glyphs: [], parts: [state === "image" ? "image" : "fallback"] };
    case "Spinner": return { glyphs: ["path", "svg"], parts: [] };
    case "Toast":
      return { glyphs: state === "loading" ? Array(12).fill("loader-bar") :
        state === "default" ? ["line", "line", "svg"] : ["line", "line", "path", "svg", "svg"], parts: [] };
    case "CodeBlock": return { glyphs: ["path", "rect", "svg"], parts: [] };
    case "MarkdownViewer": case "DiffViewer": return { glyphs: [], parts: [] };
    default: throw new RangeError(`Unknown P1 component/state: ${component}/${state}`);
  }
}

export function p1Inventory(component, state) {
  return { ...paintInventory(component, state),
    descendants: p1Descendants(component, state).map(part => part.role) };
}

export function checkP1Inventory(style, inventory) {
  const failures = [];
  for (const [kind, expected] of Object.entries(inventory)) {
    const actual = (style[kind] ?? []).map(part => kind === "glyphs" ? part.tag : part.role);
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      failures.push({ field: `${kind}.inventory`, expected, actual });
  }
  return failures;
}
