import assert from "node:assert/strict";
import { arm, press, ready, signal } from "./trusted-keys.mjs";
import { paintedFocus } from "./focus-paint.mjs";

async function focus(page, selector) {
  await page._sendToTarget("Page.bringToFront");
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  await press(page, "Tab", 8);
  await arm(page, { kind: "focus", selector });
  await press(page, "Tab");
  await signal(page);
}

export async function focusPaint(page, selector) {
  const pixels = await paintedFocus(page, selector);
  return page.evaluate(({ selector, pixels }) => {
    const node = document.querySelector(selector), style = getComputedStyle(node);
    return { selector, focused: node === document.activeElement, focusVisible: node.matches(":focus-visible"),
      outline: style.outline, shadow: style.boxShadow, pixels,
      pass: node === document.activeElement && node.matches(":focus-visible") && pixels.pass };
  }, { selector, pixels });
}

/** The mutation is confined to a localhost tab and removed before returning. */
export async function proveFocusMutation(page, selector) {
  const before = await focusPaint(page, selector);
  assert.equal(before.pass, true, `Missing focus: ${selector}`);
  await page.evaluate(selector => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${selector}:focus-visible{outline:none!important;box-shadow:none!important}`);
    window.__tableFocusMutation = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, selector);
  const removed = await focusPaint(page, selector);
  await page.evaluate(() => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__tableFocusMutation);
    delete window.__tableFocusMutation;
  });
  assert.equal(removed.pass, false, "Removing focus must fail the validator");
  return { before, removed, pass: true };
}

async function openMenu(page, trigger) {
  const id = await page.evaluate(selector => document.querySelector(selector).getAttribute("aria-controls"), trigger);
  const menu = `#${CSSescape(id)}`;
  await page.evaluate(selector => document.querySelector(selector).focus(), trigger);
  await arm(page, { kind: "attribute", selector: trigger, attribute: "aria-expanded", value: "true" });
  await press(page, "ArrowDown"); await signal(page);
  await ready(page, `${menu} button:not([disabled])`);
  assert.equal(await page.evaluate(selector =>
    document.querySelector(selector).querySelector("button:not([disabled])") === document.activeElement, menu), true);
  return menu;
}

// Preact useId contains punctuation; CSS.escape isn't available in the Node runner.
function CSSescape(value) { return value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`); }

export async function tableKeyboard(page, base) {
  // Real-page runners serve production assets; the gallery has a separate dev origin.
  const galleryBase = process.env.UXB_GALLERY_BASE ?? base;
  await page.goto(`${galleryBase}/__gallery.html?theme=light`, { waitUntil: "domcontentloaded" });
  await ready(page, '[data-component="DataTable"] tbody tr');
  const scope = '[data-component="DataTable"]';
  const checks = [];
  await page.evaluate(() => {
    window.__tableTrusted = [];
    document.addEventListener("keydown", event => window.__tableTrusted.push(event.isTrusted));
  });
  const header = `${scope} th[data-column="started"]`;
  await focus(page, `${header} button`);
  checks.push({ name: "sort focus mutation", ...await proveFocusMutation(page, `${header} button`) });
  await arm(page, { kind: "attribute", selector: header, attribute: "aria-sort", value: "ascending" });
  await press(page, "Enter"); await signal(page);
  assert.equal(await page.evaluate(selector => document.querySelector(selector).getAttribute("aria-sort"), header), "ascending");
  checks.push({ name: "trusted sorting announces aria-sort", pass: true });

  const checkbox = `${scope} tbody input[type=checkbox]`;
  await focus(page, checkbox);
  await arm(page, { kind: "attribute", selector: `${scope} tbody tr`, attribute: "aria-selected", value: "true" });
  await press(page, " "); await signal(page);
  assert.equal(await page.evaluate(selector => document.querySelector(selector).indeterminate, `${scope} thead input`), true);
  checks.push({ name: "Space selects one row with mixed native select-all", pass: true });

  const columns = `${scope} button[id^=columns-]`;
  const menu = await openMenu(page, columns);
  await press(page, "ArrowDown");
  assert.equal(await page.evaluate(selector => document.activeElement === document.querySelectorAll(`${selector} button:not([disabled])`)[1], menu), true);
  checks.push({ name: "column menu skips required disabled column", pass: true });
  await press(page, "Home");
  const item = await page.evaluate(() => document.activeElement.id);
  checks.push({ name: "column menu focus mutation", ...await proveFocusMutation(page, `#${CSSescape(item)}`) });
  await arm(page, { kind: "attribute", selector: columns, attribute: "aria-expanded", value: "false" });
  await press(page, "Enter"); await signal(page);
  assert.equal(await page.evaluate(selector => document.querySelectorAll(`${selector} th`).length, scope), 3);
  checks.push({ name: "column menu hides headers and cells", pass: true });
  await openMenu(page, columns);
  await arm(page, { kind: "focus", selector: columns });
  await press(page, "Escape"); await signal(page);
  checks.push({ name: "Escape closes and restores column trigger", pass: true });

  const density = `${scope} button[id^=density-]`;
  await openMenu(page, density);
  await press(page, "End");
  await arm(page, { kind: "attribute", selector: `${scope} .ui-table`, attribute: "data-density", value: "spacious" });
  await press(page, "Enter"); await signal(page);
  checks.push({ name: "density changes through trusted menu selection", pass: true });

  const next = `${scope} .lf-table-page-actions button:nth-child(3)`;
  await focus(page, next);
  await arm(page, { kind: "text", selector: `${scope} .lf-table-page`, value: "2 / 3 페이지" });
  await press(page, "Enter"); await signal(page);
  checks.push({ name: "pagination reaches the next received range", pass: true });

  const facet = '[data-component="FacetPanel"] input[type=checkbox]';
  await focus(page, facet);
  await arm(page, { kind: "text", selector: `${scope} .lf-table-total`, value: "받은 범위 12개" });
  await press(page, " "); await signal(page);
  assert.equal(await page.evaluate(selector => document.querySelector(selector).textContent, `${scope} .lf-table-page`), "1 / 2 페이지");
  checks.push({ name: "facet selection filters and resets pagination", pass: true });
  const trusted = await page.evaluate(() => window.__tableTrusted);
  assert.ok(trusted.length > 10 && trusted.every(Boolean));
  return { base, checks, trustedEvents: trusted.length, pass: checks.every(check => check.pass) };
}

export async function sessionsKeyboard(page, base) {
  await page._sendToTarget("Page.bringToFront");
  await page.goto(`${base}/#/sessions`, { waitUntil: "domcontentloaded" });
  await ready(page, "[data-session-id]");
  const toolbar = ".session-toolbar";
  const density = `${toolbar} button[id^=density-]`;
  await openMenu(page, density); await press(page, "End");
  await arm(page, { kind: "attribute", selector: ".lf-table-surface", attribute: "data-density", value: "comfortable" });
  await press(page, "Enter"); await signal(page);
  const columns = `${toolbar} button[id^=columns-]`;
  await openMenu(page, columns); await press(page, "Home"); await press(page, "Enter");
  await ready(page, "th.cell-runtime:first-child");
  await focus(page, "th.cell-runtime button");
  await arm(page, { kind: "attribute", selector: "th.cell-runtime", attribute: "aria-sort", value: "ascending" });
  await press(page, "Enter"); await signal(page);
  const url = await page.evaluate(() => location.href);
  assert.ok(url.includes("density=comfortable") && url.includes("columns=") && url.includes("sort=runtime"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await ready(page, "[data-session-id]");
  assert.equal(await page.evaluate(() => document.querySelector(".lf-table-surface").dataset.density), "comfortable");
  assert.equal(await page.evaluate(() => document.querySelector("th.cell-started")), null);
  assert.equal(await page.evaluate(() => document.querySelector("th.cell-runtime").getAttribute("aria-sort")), "ascending");
  const row = "[data-session-id]";
  await focus(page, row);
  const ring = await proveFocusMutation(page, row);
  // Observe the existing panel's effect installing its global Escape listener.
  // A DOM-ready signal alone precedes useEffect, and would make this timing luck.
  await page.evaluate(() => {
    window.__tablePeekKeys = new Promise((resolve, reject) => {
      const original = window.addEventListener;
      const timer = setTimeout(() => { window.addEventListener = original; reject(Error("Peek keys not installed")); }, 8000);
      window.addEventListener = function(type, listener, options) {
        original.call(window, type, listener, options);
        if (type === "keydown" && document.querySelector(".session-peek")) {
          window.addEventListener = original; clearTimeout(timer); resolve();
        }
      };
    });
  });
  await arm(page, { kind: "attribute", selector: row, attribute: "data-selected", value: "true" });
  await press(page, "Enter"); await signal(page);
  await ready(page, '.session-peek[role="dialog"]');
  await page.evaluate(() => window.__tablePeekKeys);
  assert.equal(await page.evaluate(() => location.href.includes("density=comfortable") && location.href.includes("sort=runtime")), true);
  await arm(page, { kind: "focus", selector: `${row} .rowlink` });
  await press(page, "Escape"); await signal(page);
  return { base, url, pass: true, checks: ["URL sort/density/column reload", "trusted row Enter opens peek",
    "Escape preserves existing row-link focus restoration", "peek preserves URL preferences"], ring };
}

export async function skillsKeyboard(page, base) {
  await page._sendToTarget("Page.bringToFront");
  await page.goto(`${base}/skills/`, { waitUntil: "domcontentloaded" });
  const row = '.ui-table tbody tr[tabindex="0"]';
  await ready(page, row);
  const density = ".ui-table button[id^=density-]";
  await openMenu(page, density); await press(page, "End");
  await arm(page, { kind: "attribute", selector: ".ui-table", attribute: "data-density", value: "spacious" });
  await press(page, "Enter"); await signal(page);
  const columns = ".ui-table button[id^=columns-]";
  await openMenu(page, columns); await press(page, "Home"); await press(page, "Enter");
  await ready(page, 'th[data-column="name"]:first-child');
  await focus(page, 'th[data-column="name"] button');
  await arm(page, { kind: "attribute", selector: 'th[data-column="name"]', attribute: "aria-sort", value: "ascending" });
  await press(page, "Enter"); await signal(page);
  const url = await page.evaluate(() => location.href);
  const query = new URL(url).searchParams;
  assert.equal(query.get("density"), "spacious");
  assert.equal(query.get("sort"), "name"); assert.equal(query.get("hide"), "revision");
  await page.goto(url, { waitUntil: "domcontentloaded" }); await ready(page, row);
  assert.equal(await page.evaluate(() => document.querySelector('th[data-column="revision"]')), null);
  assert.equal(await page.evaluate(() => document.querySelector(".ui-table").dataset.density), "spacious");
  await focus(page, row);
  await arm(page, { kind: "attribute", selector: row, attribute: "data-selected", value: "true" });
  await press(page, "Enter"); await signal(page);
  const selected = await page.evaluate(() => location.href);
  assert.ok(new URL(selected).searchParams.get("skill"));
  assert.equal(new URL(selected).searchParams.get("density"), "spacious");
  return { base, url, selected, pass: true, checks: ["hosted sort/density/column URL reload",
    "trusted row Enter opens peek", "row opening retains URL preferences"] };
}
