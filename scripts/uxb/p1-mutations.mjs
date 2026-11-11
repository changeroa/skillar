import assert from "node:assert/strict";
import { readP1Style, compareP1Style } from "./p1-style.mjs";

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
      const failures = compareP1Style(property === "height" ? mutant : original, mutant,
        property === "height" ? { height: `${coarse ? 44 : 32}px` } : {});
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
    const failures = compareP1Style(mutant, mutant, { width: `${coarse ? 44 : 32}px` });
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
  return rows;
}
