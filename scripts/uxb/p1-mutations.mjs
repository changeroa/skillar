import assert from "node:assert/strict";
import { readP1Style, compareP1Style } from "./p1-style.mjs";
import { p1Pointer, releaseP1Pointer } from "./p1-pointer.mjs";
import { checkP1Inventory, p1Inventory } from "./p1-inventory.mjs";
import { p1OwnerPolicy } from "./p1-policy.mjs";
import { checkP1Native, readP1Native } from "./p1-native.mjs";

/**
 * Every closed state of the five native-backed controls: hiding, blanking or exposing any part of the
 * fixed inventory (inner input/select, value/placeholder text, badge, chevron, second date field,
 * picker indicator) must fail the inventory itself, independent of the separate native contract.
 * Rules are injected as author CSS so pseudo-elements (placeholder, picker indicator) are reachable.
 */
const CONTROL_PROBES = {
  Combobox: { states: ["default", "disabled", "error", "empty"], root: ".lf-combobox__input",
    inner: ".lf-combobox__input > input", text: ".lf-combobox__value", chevron: ".lf-combobox__input > span:last-child svg" },
  MultiSelect: { states: ["selected", "empty", "disabled"], root: ".lf-combobox__input",
    inner: ".lf-combobox__input > input", text: ".lf-combobox__value", chevron: ".lf-combobox__input > span:last-child svg" },
  TimePeriodSelect: { states: ["default"], root: ".lf-select-wrap", inner: ".lf-select-wrap > select",
    text: ".lf-select-value", badge: ".lf-select-badge", chevron: ".lf-select-wrap > svg" },
  Textarea: { states: ["default", "empty", "disabled", "error", "code"], root: "textarea", inner: "textarea", text: "textarea" },
  DateRangeInput: { states: ["default", "disabled", "error"], root: ".lf-date-range input", inner: ".lf-date-range input",
    text: ".lf-date-range input", second: ".lf-field + .lf-field input[data-date-range-field]" },
};

async function controlTextMutations(page) {
  const rows = [];
  for (const [component, probe] of Object.entries(CONTROL_PROBES)) for (const state of probe.states) {
    const scope = `[data-component="${component}"][data-state="${state}"]`, selector = `${scope} ${probe.root}`;
    const specimen = { component, state }, inventory = p1Inventory(component, state);
    const original = await readP1Style(page, selector, specimen);
    assert.deepEqual(checkP1Inventory(original, inventory), [], `${component}/${state} inventory baseline`);
    // The transparent select overlay is judged against a painting source trigger, as in the gate:
    // the reference copy carries the source's nonzero opacity, so the unmutated baseline is clean.
    const reference = structuredClone(original);
    for (const part of reference.descendants.filter(part => part.transparent))
      for (const style of part.styles) style.hit.opacity = "1";
    assert.deepEqual(compareP1Style(reference, original, { inventory }), [], `${component}/${state} self-comparison baseline`);
    assert.deepEqual(checkP1Native(await readP1Native(page, selector, component), component), [], `${component} native baseline`);
    const empty = await page.evaluate(selector => {
      const node = document.querySelector(selector);
      return "value" in node && node.value === "" && node.placeholder !== "";
    }, `${scope} ${probe.inner}`);
    const text = probe.text === probe.inner && empty ? `${probe.text}::placeholder` : probe.text;
    const select = component === "TimePeriodSelect";
    const probes = [[probe.inner, "visibility", "hidden"], [probe.inner, "display", "none"],
      [probe.inner, "pointer-events", "none"], [probe.inner, "opacity", select ? "1" : "0"],
      [text, "color", "transparent"], [text, "-webkit-text-fill-color", "transparent"],
      ...(probe.badge ? [[probe.badge, "opacity", "0"], [probe.badge, "display", "none"]] : []),
      ...(probe.chevron ? [[probe.chevron, "opacity", "0"], [probe.chevron, "display", "none"]] : []),
      ...(probe.second ? [[probe.second, "visibility", "hidden"], [probe.second, "display", "none"],
        [probe.second, "opacity", "0"], [probe.second, "color", "transparent"],
        [`${probe.inner}::-webkit-calendar-picker-indicator`, "opacity", "0"]] : [])];
    for (const [target, property, value] of probes) {
      const rule = `${scope} ${target} { ${property}: ${value} !important; }`;
      await page.evaluate(rule => {
        const sheet = document.createElement("style"); sheet.id = "p1-control-probe"; sheet.textContent = rule;
        document.head.append(sheet);
      }, rule);
      try {
        const failures = compareP1Style(reference, await readP1Style(page, selector, specimen), { inventory });
        assert.ok(failures.some(row => /^(descendants\.|glyphs\.|actual\.(descendants|glyphs)\.)/.test(row.field)),
          `${component}/${state} ${target} ${property}:${value} must fail the fixed inventory`);
        rows.push({ name: `${component}-${state}-${target}-${property}-rejected`, status: "PASS",
          failures: failures.slice(0, 6) });
      } finally { await page.evaluate(() => document.getElementById("p1-control-probe").remove()); }
    }
  }
  return rows;
}

/** Mutate the real painted control, not just a manufactured style object. */
export async function p1Mutations(page, { coarse }) {
  const rows = [];
  const raw = await page.evaluate(() => {
    const node = document.querySelector('[data-component="MarkdownViewer"][data-state="literal-html"] .lf-markdown');
    return { text: node.textContent, executableNodes: node.querySelectorAll("script,img,iframe,object,embed").length,
      eventHandlers: [...node.querySelectorAll("*")].flatMap(n => [...n.attributes]).filter(a => /^on/i.test(a.name)).length };
  });
  assert.equal(raw.executableNodes, 0);
  assert.equal(raw.eventHandlers, 0);
  assert.ok(raw.text.includes("alert(1)"));
  rows.push({ name: "raw-html-safe", status: "PASS", ...raw });
  await assert.rejects(readP1Style(page, "#p1-required-target-missing"), /Missing style target/);
  rows.push({ name: "missing-target-rejected", status: "PASS" });
  const selector = '[data-component="TimePeriodSelect"] .lf-select-wrap';
  const original = await readP1Style(page, selector);
  assert.equal(original.values.height, `${coarse ? 44 : 32}px`);
  for (const property of ["height", "opacity"]) {
    await page.evaluate(({ selector, property }) => {
      document.querySelector(selector).style.setProperty(property, property === "height" ? "60px" : "0", "important");
    }, { selector, property });
    try {
      const mutant = await readP1Style(page, selector);
      const policy = await p1OwnerPolicy(page,
        { component: "TimePeriodSelect", state: "default", reference: mutant, actual: mutant, coarse });
      const failures = compareP1Style(property === "height" ? mutant : original, mutant,
        property === "height" ? policy : {});
      assert.ok(failures.length > 0, `${property} mutation must fail strict validation`);
      rows.push({ name: `${property}-mutation-rejected`, status: "PASS", failures });
    } finally {
      await page.evaluate(({ selector, property }) => document.querySelector(selector).style.removeProperty(property),
        { selector, property });
    }
  }
  const square = '[data-component="CodeBlock"][data-state="default"] button';
  const normalSquare = await readP1Style(page, square);
  assert.equal(normalSquare.values.width, `${coarse ? 44 : 32}px`);
  await page.evaluate(selector => document.querySelector(selector).style.setProperty("width", "60px", "important"), square);
  try {
    const mutant = await readP1Style(page, square);
    const root = await readP1Style(page, '[data-component="CodeBlock"][data-state="default"] .lf-codeblock',
      { component: "CodeBlock", state: "default" });
    const policy = await p1OwnerPolicy(page,
      { component: "CodeBlock", state: "default", reference: root, actual: root, coarse });
    const failures = compareP1Style(mutant, mutant, policy.descendants.copy);
    assert.ok(failures.some(row => row.field === "width"));
    rows.push({ name: "absolute-square-width-mutation-rejected", status: "PASS", failures });
  } finally {
    await page.evaluate(selector => document.querySelector(selector).style.removeProperty("width"), square);
  }
  for (const [component, state, root, leaf] of [
    ["Switch", "default-default-checked-enabled", ".lf-switch__track", ":scope > span"],
    ["Radio", "checked-enabled", ".lf-radio__ring", ":scope > span"],
    ["Avatar", "image", ".lf-avatar", ":scope > img"],
  ]) {
    const selector = `[data-component="${component}"][data-state="${state}"] ${root}`;
    const original = await readP1Style(page, selector);
    assert.equal(original.parts.length, 1, `${component} must have its actual painted leaf`);
    for (const [property, value] of [["opacity", "0"], ["visibility", "hidden"]]) {
      await page.evaluate(({ selector, leaf, property, value }) =>
        document.querySelector(selector).querySelector(leaf).style.setProperty(property, value, "important"),
      { selector, leaf, property, value });
      try {
        const mutant = await readP1Style(page, selector), failures = compareP1Style(original, mutant);
        assert.ok(failures.some(row => row.field.startsWith("parts.")), `${component} ${property} must fail`);
        rows.push({ name: `${component}-${property}-mutation-rejected`, status: "PASS", failures });
      } finally {
        await page.evaluate(({ selector, leaf, property }) =>
          document.querySelector(selector).querySelector(leaf).style.removeProperty(property),
        { selector, leaf, property });
      }
    }
  }
  for (const interaction of ["hover", "active"]) {
    const selector = '[data-component="Switch"][data-state="default-default-checked-enabled"] .lf-switch__track';
    await p1Pointer(page, selector, interaction);
    try {
      const original = await readP1Style(page, selector);
      for (const [property, value] of [["color", "rgb(255, 0, 255)"],
        ["background-color", "rgb(255, 0, 255)"], ["opacity", "0"]]) {
        await page.evaluate(({ selector, property, value }) =>
          document.querySelector(selector).style.setProperty(property, value, "important"), { selector, property, value });
        try {
          const failures = compareP1Style(original, await readP1Style(page, selector),
            { inventory: p1Inventory("Switch", "default-default-checked-enabled") });
          const field = property === "background-color" ? "backgroundColor" : property;
          assert.ok(failures.some(row => row.field === field), `${interaction} ${field} must fail`);
          rows.push({ name: `${interaction}-${field}-mutation-rejected`, status: "PASS", failures });
        } finally {
          await page.evaluate(({ selector, property }) => document.querySelector(selector).style.removeProperty(property),
            { selector, property });
        }
      }
    } finally { if (interaction === "active") await releaseP1Pointer(page); }
  }
  const codeSelector = '[data-component="CodeBlock"][data-state="default"] .lf-codeblock';
  const code = await readP1Style(page, codeSelector, { component: "CodeBlock", state: "default" });
  await page.evaluate(selector => document.querySelector(`${selector} [data-token]`).style.opacity = "0", codeSelector);
  try {
    const failures = compareP1Style(code, await readP1Style(page, codeSelector, { component: "CodeBlock", state: "default" }));
    assert.ok(failures.some(row => row.field.includes("textPaint") && row.field.endsWith(".opacity")));
    rows.push({ name: "hidden-syntax-token-paint-rejected", status: "PASS", failures });
  } finally {
    await page.evaluate(selector => document.querySelector(`${selector} [data-token]`).style.removeProperty("opacity"), codeSelector);
  }
  // A distinct oklab serialization that paints identical RGBA8 bytes must still fail:
  // the validator compares raw computed declarations, never quantized paint.
  for (const [name, specimen, root, target, field] of [
    ["root", { component: "CodeBlock", state: "default" }, codeSelector, null, "backgroundColor"],
    ["descendant", { component: "DiffViewer", state: "changed" },
      '[data-component="DiffViewer"][data-state="changed"] .lf-diff-scroll', '[data-change="added"]', "descendants.added."],
    ["text", { component: "DiffViewer", state: "changed" },
      '[data-component="DiffViewer"][data-state="changed"] .lf-diff-scroll', '[data-word-change="added"]', "textPaint."],
  ]) {
    const original = await readP1Style(page, root, specimen);
    const nudge = await page.evaluate(({ root, target }) => {
      const node = target ? document.querySelector(root).querySelector(target) : document.querySelector(root);
      const value = getComputedStyle(node).backgroundColor;
      const match = value.match(/^oklab\(([-\d.e]+) (.*)\)$/);
      if (!match) return { value };
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const bytes = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].join(","); };
      for (const step of [.0005, .0002, .0001, .00005]) {
        const candidate = `oklab(${(Number(match[1]) + step).toFixed(6)} ${match[2]})`;
        if (bytes(candidate) === bytes(value)) {
          node.style.setProperty("background-color", candidate, "important");
          return { value, candidate, bytes: bytes(value), applied: getComputedStyle(node).backgroundColor };
        }
      }
      return { value };
    }, { root, target });
    assert.ok(nudge.candidate, `${name}: needs an RGBA8-identical oklab nudge of ${nudge.value}`);
    assert.notEqual(nudge.applied, nudge.value);
    try {
      const failures = compareP1Style(original, await readP1Style(page, root, specimen),
        { inventory: p1Inventory(specimen.component, specimen.state) });
      assert.ok(failures.some(row => row.field.includes(field) && row.field.endsWith("backgroundColor")),
        `${name} raw color drift must fail`);
      rows.push({ name: `${name}-raw-color-serialization-rejected`, status: "PASS", nudge, failures });
    } finally {
      await page.evaluate(({ root, target }) => (target ? document.querySelector(root).querySelector(target)
        : document.querySelector(root)).style.removeProperty("background-color"), { root, target });
    }
  }
  rows.push(...await controlTextMutations(page));
  const missing = structuredClone(code);
  missing.descendants = [];
  assert.ok(compareP1Style(missing, missing, { inventory: p1Inventory("CodeBlock", "default") })
    .some(row => row.field.endsWith("descendants.inventory")));
  rows.push({ name: "symmetrically-missing-descendants-rejected", status: "PASS" });
  for (const property of ["opacity", "visibility"]) {
    await page.evaluate(({ selector, property }) =>
      document.querySelector(selector).querySelector("pre").style.setProperty(property, property === "opacity" ? "0" : "hidden"),
    { selector: codeSelector, property });
    try {
      const mutant = await readP1Style(page, codeSelector, { component: "CodeBlock", state: "default" });
      const failures = compareP1Style(code, mutant, { inventory: p1Inventory("CodeBlock", "default") });
      assert.ok(failures.some(row => row.field.startsWith("descendants.code.")));
      rows.push({ name: `code-descendant-${property}-rejected`, status: "PASS", failures });
    } finally {
      await page.evaluate(({ selector, property }) =>
        document.querySelector(selector).querySelector("pre").style.removeProperty(property), { selector: codeSelector, property });
    }
  }
  await page.evaluate(selector => {
    const node = document.querySelector(selector).querySelector("pre");
    window.__p1Detached = { node, parent: node.parentNode, next: node.nextSibling };
    node.remove();
  }, codeSelector);
  try {
    const failures = compareP1Style(code, await readP1Style(page, codeSelector, { component: "CodeBlock", state: "default" }),
      { inventory: p1Inventory("CodeBlock", "default") });
    assert.ok(failures.some(row => row.field === "actual.descendants.inventory"));
    rows.push({ name: "removed-code-descendant-rejected", status: "PASS", failures });
  } finally {
    await page.evaluate(() => {
      const { node, parent, next } = window.__p1Detached;
      parent.insertBefore(node, next); delete window.__p1Detached;
    });
  }
  return rows;
}
