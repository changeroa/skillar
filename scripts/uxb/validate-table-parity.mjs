import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tableStates } from "./table-states.mjs";

// Compare painted parts with real Demo observations, never business-data pixels.
const text = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color"];
const padding = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
const shape = ["backgroundColor", "borderTopWidth", "borderBottomWidth", "borderRadius"];
const tableFamilies = new Set(["DataTable", "Row", "SortableHeader", "Density"]);
export const tableContentExclusions = [
  "Business text, row/column counts, values, counts, optional captions and total-range text.",
  "Text-driven widths, table/viewport width, column model widths, list/container height and page placement.",
  "Source sticky-column backing surfaces versus caller-owned non-sticky columns.",
  "Unpainted inherited wrapper fonts and zero-width border colors; borders are compared where painted.",
  "Demo all-values-selected/no-filter versus facade empty-selection/no-filter: checkbox paint is matched by actual checked/disabled state.",
  "Known-total first/last actions and controlled busy disabling: shape uses Demo navigation; enabled/disabled paint uses the matching real Demo control.",
  "Owner 32px mouse/44px touch targets, keyboard-operable rows/sort/menu items and a visible 2px focus indicator.",
];
const numeric = value => Number.parseFloat(value);
const checked = part => String(part.checked) === "true";

export function compareTableCase(actual, reference, references, { colors, minimum = 32 }) {
  const assertions = [];
  const a = actual.semantic.parts, r = reference.semantic.parts;
  const id = `${actual.app}/${actual.theme}/${actual.family}/${actual.state}`;
  const normalize = (property, value) => {
    if (/color$/i.test(property)) return colors[value] ?? `UNMEASURED:${value}`;
    if (property === "fontFamily") return value.replaceAll('"', "");
    return value;
  };
  const check = (part, property, value, expected, tolerance = 0) => {
    const pass = value !== undefined && expected !== undefined &&
      (tolerance ? Math.abs(numeric(value) - numeric(expected)) <= tolerance :
        JSON.stringify(normalize(property, value)) === JSON.stringify(normalize(property, expected)));
    assertions.push({ part, property, actual: value, expected, pass });
  };
  const styles = (part, keys, source = r[part]) => {
    if (!a[part] || !source) {
      check(part, "actualPresent", Boolean(a[part]), true);
      check(part, "referencePresent", Boolean(source), true); return;
    }
    for (const property of keys) check(part, property, a[part].styles[property], source.styles[property]);
    // Busy Select opacity is compared against the matching disabled Demo variant below.
    if (keys.includes("fontSize") && part !== "select")
      check(part, "effectiveOpacity", a[part].effectiveOpacity, source.effectiveOpacity);
    for (const edge of ["Top", "Right", "Bottom", "Left"])
      if (keys.includes(`border${edge}Width`) && numeric(source.styles[`border${edge}Width`]) > 0)
        check(part, `border${edge}Color`, a[part].styles[`border${edge}Color`], source.styles[`border${edge}Color`]);
  };
  const height = (part, expected) => check(part, "height", a[part]?.box.height, expected, 1);
  const control = part => check(part, "height", a[part]?.box.height, minimum, .01);
  const glyph = part => {
    styles(part, ["color"]); height(part, r[part]?.box.height);
    check(part, "width", a[part]?.box.width, r[part]?.box.width, 1);
    for (const key of ["x", "y", "width", "height"])
      check(part, `glyph.${key}`, a[part]?.glyphBox?.[key], r[part]?.glyphBox?.[key], 0.01);
  };
  const shadows = value => [...value.matchAll(/(rgba?\([^)]*\))([^,]*)/g)]
    .map(([, color, geometry]) => [colors[color], geometry.trim()])
    .filter(([color]) => color?.[3] > 0);
  const shadow = (part, source = r[part]) =>
    check(part, "visibleShadow", shadows(a[part]?.styles.boxShadow ?? ""), shadows(source?.styles.boxShadow ?? ""));
  const box = part => {
    styles(part, shape); styles(part, ["borderLeftWidth", "borderRightWidth"]);
  };
  for (const property of ["theme", "viewport", "dpr", "coarse"])
    check("context", property, actual.semantic[property], reference.semantic[property]);
  if (tableFamilies.has(actual.family) && !(actual.family === "Density" && actual.state === "open")) {
    styles("header", [...text, ...padding, ...shape]);
    height("header", minimum + 8);
    if (actual.family === "SortableHeader") {
      styles("sortButton", text, r.header);
      control("sortButton");
      if (actual.state !== "unsorted") glyph("sortIndicator");
      else check("sortIndicator", "absent", Boolean(a.sortIndicator), false);
    } else {
      styles("cell", [...text, ...padding, "borderBottomWidth"]);
      styles("row", ["backgroundColor"]);
      const interactive = Boolean(a.row?.focusable || a.checkbox);
      height("row", Math.max(r.row.box.height, interactive ? minimum + numeric(r.cell.styles.borderBottomWidth) : 0));
      if (actual.state === "loading") {
        box("placeholder"); height("placeholder", r.placeholder.box.height);
        styles("placeholder", ["opacity"]);
      }
    }
  }
  if (actual.family === "Toolbar" && actual.state === "default") for (const part of ["columnsTrigger", "densityTrigger"]) {
    styles(part, [...text, ...padding]); box(part); control(part);
    if (part === "densityTrigger") check(part, "width", a[part].box.width, minimum, 1);
  }
  if (actual.family === "Toolbar" && actual.state === "search") {
    styles("searchClear", ["color", ...padding, ...shape]); control("searchClear"); glyph("searchClearGlyph");
    check("searchClear", "width", a.searchClear.box.width, minimum, .01);
  }
  if (actual.family === "Density" && actual.state === "open") {
    box("container"); shadow("container");
    styles("heading", [...text, ...padding]); height("heading", r.heading.box.height);
    styles("item", [...text, ...padding, ...shape]); control("item");
    glyph("itemCheck"); styles("separator", ["backgroundColor"]); height("separator", r.separator.box.height);
    height("container", r.container.box.height + 3 * (minimum - 32));
  }
  if (actual.family === "ColumnVisibility") {
    box("container"); shadow("container"); styles("itemLabel", text);
    for (const part of ["item", "enabledItem"]) {
      styles(part, [...padding, ...shape]); control(part);
    }
    styles("enabledLabel", text); styles("enabledCheckbox", [...shape, "borderLeftWidth", "borderRightWidth", "color"]);
    height("enabledCheckbox", r.enabledCheckbox.box.height);
    check("enabledCheckbox", "width", a.enabledCheckbox.box.width, r.enabledCheckbox.box.width, .01);
    check("enabledCheckbox", "effectiveOpacity", a.enabledCheckbox.effectiveOpacity, r.enabledCheckbox.effectiveOpacity);
    check("checkbox", "outerInset", a.checkbox.box.left - a.container.box.left,
      r.checkbox.box.left - r.container.box.left, 1);
  }
  if (actual.family === "FacetPanel") {
    styles("heading", [...text, ...padding, ...shape]); control("heading");
    if (a.clear || r.clear) {
      styles("clear", [...text, ...padding, ...shape]); control("clear"); glyph("clearGlyph");
    }
    if (actual.state !== "collapsed") {
      styles("modeTrack", [...padding, "backgroundColor", "borderRadius"]);
      height("modeTrack", minimum + numeric(r.modeTrack.styles.paddingTop) + numeric(r.modeTrack.styles.paddingBottom));
      for (const part of ["modeActive", "modeInactive"]) {
        styles(part, [...text, ...padding, "borderRadius"]); control(part);
      }
      styles("modeInactive", ["backgroundColor"]);
      styles("modeFill", ["backgroundColor", "borderRadius"]); shadow("modeFill");
      styles("input", [...text, ...padding, ...shape]); control("input");
      if (actual.state === "empty") {
        styles("empty", [...text, ...padding, ...shape]);
        check("checkbox", "absent", Boolean(a.checkbox), false);
      } else if (actual.state !== "text") {
        styles("choiceLabel", text);
        check("choiceLabel", "checkboxGap", a.choiceLabel.box.left - a.checkbox.box.right,
          r.choiceLabel.box.left - r.checkbox.box.right, 1);
      }
    }
  }
  if (actual.family === "Pagination") {
    styles("label", text); styles("select", [...text, ...padding]); box("select"); control("select");
    check("select", "width", a.select.box.width, r.select.box.width, 1);
    const opacity = references.flatMap(item => item.theme === actual.theme && item.family === "Pagination" ?
      [item.semantic.parts.previous, item.semantic.parts.next] : []).find(part => part.disabled === a.select.disabled)?.effectiveOpacity;
    check("select", "effectiveOpacity", a.select.effectiveOpacity, opacity);
    for (const part of ["previous", "next"]) {
      const source = [reference, ...references].filter(item => item.theme === actual.theme && item.family === "Pagination")
        .map(item => item.semantic.parts[part]).find(node => node.disabled === a[part].disabled);
      styles(part, [...text, ...padding, ...shape], source); control(part);
      check(part, "width", a[part].box.width, minimum, 1);
      check(part, "effectiveOpacity", a[part].effectiveOpacity, source.effectiveOpacity);
      glyph(`${part}Glyph`);
    }
  }
  if (r.checkbox && !a.checkbox) check("checkbox", "actualPresent", false, true);
  if (a.checkbox) {
    const componentCheckbox = references.filter(item => item.theme === actual.theme && item.family === actual.family)
      .map(item => item.semantic.parts.checkbox).find(Boolean);
    const source = [reference, ...references].filter(item => item.theme === actual.theme &&
      (item.family === actual.family || item.family === "Row"))
      .map(item => item.semantic.parts.checkbox).find(part => part &&
        checked(part) === checked(a.checkbox) && part.disabled === a.checkbox.disabled &&
        part.box.width === componentCheckbox.box.width);
    styles("checkbox", [...shape, "borderLeftWidth", "borderRightWidth", ...(checked(a.checkbox) ? ["color"] : [])], source);
    height("checkbox", source?.box.height);
    check("checkbox", "width", a.checkbox.box.width, source?.box.width, 0.01);
    check("checkbox", "effectiveOpacity", a.checkbox.effectiveOpacity, source?.effectiveOpacity);
  }
  return { id, pass: assertions.length > 0 && assertions.every(item => item.pass), assertions,
    failures: assertions.filter(item => !item.pass), exclusions: tableContentExclusions };
}

export function compareTableMatrix({ cases, references, colors }) {
  const key = item => `${item.theme}/${item.family}/${item.state}`;
  const expected = Object.entries(tableStates).flatMap(([family, states]) =>
    states.flatMap(state => ["light", "dark"].map(theme => `${theme}/${family}/${state}`)));
  const actualKeys = cases.map(item => `${item.app}/${key(item)}`);
  const expectedKeys = ["site", "local"].flatMap(app => expected.map(item => `${app}/${item}`));
  if (references.length !== expected.length || cases.length !== expectedKeys.length ||
    expected.some(item => !references.some(reference => key(reference) === item)) ||
    new Set(actualKeys).size !== expectedKeys.length || expectedKeys.some(item => !actualKeys.includes(item)))
    throw Error("Missing or duplicate shipped state/theme/renderer in table matrix");
  const results = cases.map(item => compareTableCase(item,
    references.find(reference => key(reference) === key(item)), references,
    { colors, minimum: item.semantic.coarse || item.semantic.viewport[0] <= 768 ? 44 : 32 }));
  const components = Object.fromEntries([...new Set(cases.map(item => item.family))].map(family => {
    const matches = results.filter((_, index) => cases[index].family === family);
    return [family, { passed: matches.filter(item => item.pass).length, total: matches.length }];
  }));
  return { passed: results.filter(item => item.pass).length, total: results.length,
    assertions: results.reduce((sum, item) => sum + item.assertions.length, 0), components, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error("Usage: node validate-table-parity.mjs input.json output.json");
  const report = compareTableMatrix(JSON.parse(await readFile(input, "utf8")));
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: report.total,
    assertions: report.assertions, components: report.components }));
  if (report.passed !== report.total) process.exitCode = 1;
}
