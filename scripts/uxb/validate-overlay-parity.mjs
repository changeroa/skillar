import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (!process.argv[2]) throw Error("Usage: node validate-overlay-parity.mjs evidence-directory");
const root = resolve(process.argv[2]);
const states = {
  "Dialog": [
    "closed",
    "comparison-open",
    "close-hover",
    "focus-visible",
    "scroll-end",
    "default-open",
    "disabled-action",
    "loading-action",
    "error-body",
    "empty-body",
    "nested-menu"
  ],
  "Confirm": [
    "closed",
    "open",
    "cancel-focus",
    "confirm-hover",
    "disabled",
    "loading",
    "error",
    "empty",
    "nested"
  ],
  "Dropdown": [
    "closed",
    "open",
    "hover",
    "focus-visible",
    "typeahead",
    "disabled-item",
    "disabled-trigger",
    "checked",
    "unchecked",
    "selection",
    "empty",
    "nested"
  ],
  "Tooltip": [
    "closed",
    "hover",
    "focus-visible",
    "hover-content",
    "escape-dismissed",
    "nested",
    "long"
  ],
  "Sheet": [
    "closed",
    "peek-open",
    "peek-close-hover",
    "peek-focus-visible",
    "peek-scroll-end",
    "peek-loading",
    "peek-empty",
    "peek-error",
    "sheet-open",
    "sheet-empty",
    "sheet-loading",
    "sheet-error",
    "nested-menu"
  ]
};

const load = async name => JSON.parse(await readFile(`${root}/${name}.json`, "utf8"));
const sources = await load("sources"), products = await load("products");
const fields = [
  "fontFamily", "fontSize", "lineHeight", "fontWeight", "letterSpacing", "color", "backgroundColor",
  ...["Top", "Right", "Bottom", "Left"].flatMap(side => [`border${side}Width`, `border${side}Color`, `border${side}Style`]),
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "boxShadow", "opacity",
  "outlineWidth", "outlineColor", "outlineStyle", "outlineOffset", "webkitFontSmoothing",
];
const key = row => `${row.family}/${row.state}/${row.theme}`;
const checks = [], cases = [], errors = [];
const sourceIndex = new Map(sources.map(row => [key(row), row]));
const mitProvenance = new Map(await Promise.all(
  [...new Set(sources.filter(row => row.kind === "mit").map(row => row.provenance))]
    .map(async path => [path, JSON.parse(await readFile(path, "utf8"))]),
));
const approvedMitStates = {
  Confirm: ["disabled", "loading", "error", "empty", "nested"],
  Dialog: ["default-open", "disabled-action", "loading-action", "error-body", "empty-body", "nested-menu"],
  Dropdown: ["empty"],
  Sheet: ["peek-error", "sheet-loading", "sheet-error"],
};
const productIndex = new Map(products.map(row => [`${key(row)}/${row.app}`, row]));
const transparent = value => value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value ?? "");
function shadow(value) {
  return value?.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+) \/ ([\d.]+)\)/g, (_,r,g,b,a) =>
    `rgba(${Math.round(Number(r)*255)}, ${Math.round(Number(g)*255)}, ${Math.round(Number(b)*255)}, ${Number(a)})`)
    .replace(/rgba\(0,\s*0,\s*0,\s*0\) 0px 0px 0px(?: 0px)?(?:, )?/g, "").trim().replace(/,\s*$/, "") || "none";
}
function canonical(value, field, node) {
  if (field === "boxShadow") return shadow(value);
  const border = /^border(Top|Right|Bottom|Left)(Color|Style)$/.exec(field);
  if (border && node?.styles[`border${border[1]}Width`] === "0px") return "no painted border";
  if (field.startsWith("outline") && field !== "outlineStyle" && node?.styles.outlineStyle === "none") return "no painted outline";
  return value;
}
function add(context, part, field, source, actual, expected, origin = "measured-source", reason) {
  const numeric = typeof expected === "number" && typeof actual === "number";
  const pass = expected !== undefined && actual !== undefined && (numeric ? Math.abs(expected - actual) <= 1 : expected === actual);
  const row = { id: context.id, part, field, source, expected, actual, origin, reason, pass };
  checks.push(row); if (!pass) errors.push(row);
}
const controlTarget = product => product.coarse || product.viewport[0] <= 768 ? 44 : 32;
function geometry(context, name, a, b) {
  const { source, product } = context, side = source.family === "Sheet";
  const target = controlTarget(product);
  const control = ["BUTTON", "INPUT", "SELECT", "SUMMARY", "A"].includes(b.tag);
  const spinnerOnly = b.tag === "BUTTON" && product.parts.spinner &&
    ["action", "confirm"].includes(name);
  const squareControl = b.tag === "BUTTON" && (/close/i.test(name) ||
    Math.abs(a.box.width - a.box.height) < 1 || spinnerOnly);
  for (const dimension of ["width", "height"]) {
    let expected = a.box[dimension], origin = "measured-source", reason;
    const actual = b.box[dimension];
    if (a.tag === "svg" || a.tag === "SVG") expected = parseFloat(a.styles[dimension]) || expected;
    const actualLayout = b.tag.toLowerCase() === "svg" ? parseFloat(b.styles[dimension]) || actual : actual;
    if ((control && dimension === "height") || (squareControl && dimension === "width")) {
      expected = target; origin = "approved-native-replacement";
      reason = "Owner override: exactly 32px mouse/desktop, 44px pointer:coarse or width <=768px; upstream target size never wins.";
    } else if (!side && ["Dialog", "Confirm"].includes(source.family) &&
      ["heading", "title", "subtitle", "parentTitle", "actualFocus"].includes(name) &&
      dimension === "width" && b.tag !== "BUTTON" && source.parts.close) {
      expected = a.box.width + source.parts.close.box.width - target;
      origin = "approved-native-replacement";
      reason = "Heading space follows the owner close target rather than the upstream 36px control.";
    } else if (side && source.state !== "closed" && (["surface", "header", "body", "footer", "title", "headerInset"].includes(name) || name === "actualFocus" && b.tag === "H2")) {
      origin = "approved-native-replacement";
      reason = "Preserved ordinary Sheet geometry; source trace/filter caller composition is not copied.";
      if (name === "surface") expected = dimension === "width" ? (source.state.startsWith("sheet-") ? product.viewport[0] : Math.min(440, product.viewport[0])) : product.viewport[1] * (source.state.startsWith("sheet-") ? .85 : 1);
      else if (name === "title" || name === "actualFocus" && b.tag === "H2") {
        const header = product.parts.header;
        expected = dimension === "height" ? parseFloat(b.styles.lineHeight) : header.box.width - parseFloat(header.styles.paddingLeft) - parseFloat(header.styles.paddingRight) - product.parts.close.box.width - 16;
      } else if (dimension === "width") expected = product.surface.box.width - parseFloat(product.surface.styles.borderLeftWidth) - parseFloat(product.surface.styles.borderRightWidth);
      else if (name === "body") expected = product.surface.box.height - (product.parts.header?.box.height ?? 0) - (product.parts.footer?.box.height ?? 0);
      else if (name === "header") expected = Math.max(parseFloat(product.parts.title?.styles.lineHeight ?? "0"), target) + parseFloat(b.styles.paddingTop) + parseFloat(b.styles.paddingBottom) + parseFloat(b.styles.borderBottomWidth);
      else if (name === "footer") expected = target + parseFloat(b.styles.paddingTop) + parseFloat(b.styles.paddingBottom) + parseFloat(b.styles.borderTopWidth);
      else expected = dimension === "width" ? product.parts.header.box.width : product.parts.header.box.height;
    } else if (context.source.family === "Sheet" && context.source.state === "closed") {
      origin = "approved-native-replacement"; reason = "Source table-row caller versus unchanged R1 primary Button opener.";
      expected = dimension === "height" ? target : product.approved?.openerIntrinsicWidth - (product.approved?.contractVersion === 2 ? 0 : 8);
    } else if (name.toLowerCase().includes("icon") && expected !== actualLayout) {
      origin = "approved-native-replacement"; reason = "Retained public R1 glyph size for native control frame.";
      expected = product.approved?.glyphSize;
    }
    add(context, name, dimension, a.box[dimension], actualLayout, expected, origin, reason);
  }
}
function comparePart(context, name, original, b) {
  if (!original || !b) {
    add(context, name, "presence", !!original, !!b, !!original);
    return;
  }
  const { source, product } = context;
  const isSheetOpener = source.family === "Sheet" && source.state === "closed";
  const primaryRecipe = { ...product.approved?.primaryButton };
  for (const side of ["Top", "Right", "Bottom", "Left"]) primaryRecipe[`padding${side}`] = "8px";
  for (const corner of ["TopLeft", "TopRight", "BottomLeft", "BottomRight"]) primaryRecipe[`border${corner}Radius`] = "4px";
  const semanticName = name === "actualFocus" ? Object.entries(source.parts).find(([,v]) => v?.focus)?.[0] ?? name : name;
  const outerName = semanticName.replace(/Control$/, "");
  const outer = source.parts?.[outerName];
  const inner = source.parts?.[`${semanticName}Control`];
  for (const field of fields) {
    let a = original, expected = original.styles[field], origin = "measured-source", reason;
    if (isSheetOpener) {
      expected = primaryRecipe[field]; origin = "approved-native-replacement";
      reason = "Unchanged published R1 primary Button recipe; source caller is a table row.";
    } else if (inner && /^padding/.test(field)) {
      a = inner; expected = inner.styles[field]; reason = "Measured inner Button inset of flattened DIV menuitem.";
    } else if (/Control$/.test(semanticName) && outer) {
      if (/Radius$|^border|boxShadow/.test(field) || field === "backgroundColor" && transparent(expected)) {
        a = outer; expected = outer.styles[field]; reason = "Measured outer semantic menuitem paint after native Button flattening.";
      }
      if (field === "opacity") { expected = String(outer.styles.opacity); reason = "Measured disabled/focus wrapper opacity retained by flattened native control."; }
    }
    if (source.family === "Sheet" && source.state !== "closed" && name === "body" && /^padding/.test(field)) {
      expected = "16px"; origin = "approved-native-replacement"; reason = "Approved ordinary Sheet body inset, not trace/filter caller widget inset.";
    }
    if (source.family === "Sheet" && name === "header" && source.parts.headerInset && /^padding/.test(field)) {
      a = source.parts.headerInset; expected = a.styles[field]; reason = "Measured header inner-row inset flattened into native header.";
    }
    if (source.family === "Sheet" && !source.state.startsWith("sheet-") && name === "header" && /^padding/.test(field)) {
      expected = "16px"; origin = "approved-native-replacement"; reason = "Approved ordinary single-row Sheet header, not the trace caller's multi-row header.";
    }
    if (source.family === "Sheet" && !source.state.startsWith("sheet-") && name === "title") {
      const replacements = { fontSize: "16px", lineHeight: "24px", fontWeight: "400", letterSpacing: "normal" };
      if (field in replacements) { expected = replacements[field]; origin = "approved-native-replacement"; reason = "Visible native Sheet heading replaces source sr-only label."; }
    }
    if (source.family === "Tooltip" && ["surface", "trigger", "actualFocus"].includes(name) &&
      b.focusVisible && field === "boxShadow" && shadow(expected) !== shadow(b.styles[field])) {
      expected = product.approved?.focusInset; origin = "approved-native-replacement"; reason = "Unchanged R1 inset-2 focus preset replaces caller legacy offset ring.";
    }
    if (source.family === "Dropdown" && b.focus && !a.focus &&
      ["menuitem", "menuitemcheckbox"].includes(b.role) && field === "backgroundColor" && !/disabled/.test(name)) {
      expected = product.approved?.accent; origin = "approved-native-replacement"; reason = "Native first-enabled-item/typeahead focus entry paints the approved accent.";
    }
    if (source.family === "Dropdown" && source.state === "empty" &&
      ["surface", "actualFocus"].includes(name) && b.focusVisible && field.startsWith("outline")) {
      expected = product.approved?.menuFocusOutline?.[field]; origin = "approved-native-replacement";
      reason = "Explicit token 2px inset outline keeps the focused empty native menu visible; actual source outline is retained separately.";
    }
    if (expected === undefined || b.styles[field] === undefined) {
      add(context, name, field, original.styles[field], b.styles[field], undefined, origin, "Required computed-style field missing");
      continue;
    }
    const focusOutline = source.family === "Dropdown" && source.state === "empty" &&
      ["surface", "actualFocus"].includes(name) && b.focusVisible ? product.approved?.menuFocusOutline : {};
    const comparableSource = canonical(expected, field, { ...a, styles: { ...a.styles, ...(isSheetOpener ? primaryRecipe : {}), ...focusOutline, [field]: expected } });
    const comparableActual = canonical(b.styles[field], field, b);
    add(context, name, field, original.styles[field], comparableActual, comparableSource, origin, reason);
  }
  geometry(context, name, original, b);
}

function additionalNativePart(context, name, b) {
  const { source, product } = context;
  const alias = name.replace(/Control$/, "");
  if (/Control$/.test(name) && source.parts[alias]) {
    comparePart(context, name, source.parts[alias], b);
    return;
  }
  const wrapper = ["headerContent", "heading", "body"].includes(name);
  const glyph = /Icon$|^icon$/.test(name);
  if (!wrapper && !glyph) {
    add(context, name, "source part coverage", undefined, true, undefined, "measured-source", "Owned semantic part lacks measured source or approved native structural projection");
    return;
  }
  const parent = glyph ? source.parts[name.replace(/Icon$/, "")] ?? source.parts.close ?? source.surface
    : source.parts.header ?? source.surface;
  for (const field of fields) {
    let expected = parent.styles[field];
    if (field === "backgroundColor") expected = "rgba(0, 0, 0, 0)";
    if (/^padding|Width$/.test(field) && !field.startsWith("outline")) expected = "0px";
    if (/^border.*Style$/.test(field)) expected = "solid";
    if (/Radius$/.test(field)) expected = "0px";
    if (field === "boxShadow") expected = "none";
    if (field === "opacity") expected = "1";
    if (field === "outlineStyle") expected = "none";
    if (field === "outlineWidth") expected = "3px";
    if (field === "outlineOffset") expected = "0px";
    if (field === "outlineColor") expected = parent.styles.color;
    if (name === "icon" && ["color", "outlineColor"].includes(field)) {
      expected = product.approved?.iconForeground ?? sourceIndex.get(`Tooltip/closed/${source.theme}`)?.parts.icon?.styles.color;
    }
    const expectedNode = { ...parent, effectiveOpacity: parent.effectiveOpacity, styles: { ...parent.styles, [field]: expected } };
    for (const side of ["Top", "Right", "Bottom", "Left"]) expectedNode.styles[`border${side}Width`] = "0px";
    add(context, name, field, `Inherited from measured ${parent.tag}; native unpainted ${glyph ? "R1 glyph" : "structural wrapper"}`,
      canonical(b.styles[field], field, b), expected === undefined ? undefined : canonical(expected, field, expectedNode),
      "approved-native-replacement", "Native structure has no independent border, padding, background, or ring; inherited type and paint remain asserted.");
  }
  let width, height;
  if (glyph) width = height = name === "icon" && product.surface.box.width === 24 ? 12 : 14;
  else if (source.family === "Dropdown" && name === "body") {
    width = source.surface.box.width - ["Left", "Right"].reduce((n,s) => n + parseFloat(source.surface.styles[`border${s}Width`]) + parseFloat(source.surface.styles[`padding${s}`]), 0);
    height = source.surface.box.height - ["Top", "Bottom"].reduce((n,s) => n + parseFloat(source.surface.styles[`border${s}Width`]) + parseFloat(source.surface.styles[`padding${s}`]), 0);
  } else if (source.family === "Sheet") {
    const h = product.parts.header;
    width = h.box.width - parseFloat(h.styles.paddingLeft) - parseFloat(h.styles.paddingRight);
    height = Math.max(parseFloat(product.parts.title.styles.lineHeight), controlTarget(product));
    if (name === "heading") { width -= controlTarget(product) + 16; height = parseFloat(product.parts.title.styles.lineHeight); }
  } else if (name === "heading") {
    width = source.parts.title.box.width + (source.parts.close?.box.width ?? controlTarget(product)) - controlTarget(product);
    height = source.parts.title.box.height;
  } else {
    const h = source.parts.header;
    width = h.box.width - parseFloat(h.styles.paddingLeft) - parseFloat(h.styles.paddingRight);
    height = h.box.height - parseFloat(h.styles.paddingTop) - parseFloat(h.styles.paddingBottom) - parseFloat(h.styles.borderTopWidth) - parseFloat(h.styles.borderBottomWidth);
  }
  add(context, name, "width", undefined, parseFloat(b.styles.width) || b.box.width, width, "approved-native-replacement", "Explicit R1 glyph or measured parent-content geometry.");
  add(context, name, "height", undefined, parseFloat(b.styles.height) || b.box.height, height, "approved-native-replacement", "Explicit R1 glyph or measured parent-content geometry.");
}

for (const [family, list] of Object.entries(states)) for (const state of list) for (const theme of ["light", "dark"]) {
  const base = `${family}/${state}/${theme}`, source = sourceIndex.get(base);
  for (const app of ["site", "local"]) {
    const id = `${base}/${app}`, product = productIndex.get(id), start = errors.length;
    const context = { id, source, product };
    if (!product) {
      errors.push({ id, field: "product coverage", pass: false }); cases.push({ id, verdict: "FAIL", reason: "Product evidence missing" }); continue;
    }
    if (!source || source.kind === "unavailable" || !source.surface) {
      cases.push({ id, verdict: "FAIL", sourceKind: "unavailable", reason: source?.reason ?? "No actual source reference", routesChecked: source?.routesChecked });
      continue;
    }
    if (!["demo", "mit"].includes(source.kind) || source.kind === "mit" &&
      (!approvedMitStates[family]?.includes(state) ||
       mitProvenance.get(source.provenance)?.sha !== "69181812b87169df157841fce1314ec96ecd2c5a" ||
       !source.provenance)) {
      errors.push({ id, field: "source provenance", pass: false }); cases.push({ id, verdict: "FAIL", reason: "Disallowed supplementary source" }); continue;
    }
    comparePart(context, "surface", source.surface, product.surface);
    for (const [name, a] of Object.entries(source.parts)) comparePart(context, name, a, product.parts[name]);
    for (const [name, b] of Object.entries(product.parts)) if (b && !(name in source.parts)) additionalNativePart(context, name, b);
    if (["closed", "escape-dismissed"].includes(state)) {
      add(context, "state", "overlay absence", source.observed?.overlayCount, product.observed?.open, false, "approved-native-replacement", "Actual closed-state absence, with opener styles fully asserted.");
    }
    if (state.includes("focus-visible") || state === "cancel-focus") {
      add(context, "state", "actual focus-visible", source.active?.focusVisible, product.active?.focusVisible, true);
      if (source.active && product.active) {
        let a = source.active;
        if (family === "Dropdown") a = Object.values(source.parts).find(p => p?.focus) ?? a;
        comparePart(context, "actualFocus", a, product.active);
      }
    }
    if (product.active && !(state.includes("focus-visible") || state === "cancel-focus")) {
      const nativeHeading = ["Dialog", "Sheet"].includes(family) && product.active.tag === "H2";
      const reference = nativeHeading ? source.parts.title : source.active;
      if (reference) comparePart(context, "actualFocus", reference, product.active);
      else add(context, "actualFocus", "source focus coverage", null, product.active.tag, undefined, "measured-source", "Focused node has no measured or approved counterpart");
    }
    if (family === "Dialog" && state === "nested-menu") {
      add(context, "state", "nested first enabled item focus", source.active?.role, product.active?.role, "menuitem");
    }
    if (family === "Dialog" && !["closed", "close-hover", "focus-visible", "nested-menu"].includes(state)) {
      add(context, "state", "initial native heading", source.active?.tag, product.active?.tag, "H2", "approved-native-replacement", "WAI initial static heading focus.");
      add(context, "actualFocus", "outlineStyle", source.parts.title?.styles.outlineStyle, product.active?.styles.outlineStyle, "none", "approved-native-replacement", "Static heading must not acquire a browser/gallery halo.");
      add(context, "actualFocus", "boxShadow", source.parts.title?.styles.boxShadow, shadow(product.active?.styles.boxShadow), "none", "approved-native-replacement", "Static heading has no focus shadow.");
    }
    cases.push({ id, verdict: errors.length === start ? "PASS" : "FAIL", sourceKind: source.kind, measuredParts: Object.keys(source.parts), errors: errors.length - start });
  }
}
const result = {
  fields, cases, assertions: checks, errors,
  measuredChecks: checks.filter(c => c.origin === "measured-source").length,
  replacementChecks: checks.filter(c => c.origin === "approved-native-replacement").length,
  checks: checks.length, passed: checks.filter(c => c.pass).length,
  passCases: cases.filter(c => c.verdict === "PASS").length,
  failCases: cases.filter(c => c.verdict === "FAIL").length,
  unavailableCases: cases.filter(c => c.sourceKind === "unavailable").length,
};
await writeFile(`${root}/measured-validation.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checks: result.checks, passCases: result.passCases, failCases: result.failCases, unavailableCases: result.unavailableCases, errors: errors.slice(0, 20), totalErrors: errors.length }));
if (result.failCases) process.exitCode = 1;
