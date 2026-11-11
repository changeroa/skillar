import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { componentStyleFields } from "./component-style.mjs";
import { observePaint } from "./widget-paint.mjs";
import { ready } from "./trusted-keys.mjs";
import { captureCrop } from "./image-diff.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";

const root = process.argv[2];
const { themePage, project } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const sourcePath = `${root}/state-references.json`;
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const records = [];
await mkdir(`${root}/disabled-outline-demo`, { recursive: true });
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.goto(`${project}/traces?viewId=cmo6yrbti0006ad07v1r1xyva&orderBy=order-DESC_column-startTime`,
      { waitUntil: "domcontentloaded" });
    await themePage(page, theme, width);
    await ready(page, "button:disabled");
    const selector = await page.evaluate(() => {
      const node = [...document.querySelectorAll("button:disabled")].find(n =>
        n.textContent.includes("Go to previous page") || n.getAttribute("aria-label") === "Go to previous page");
      if (!node || !node.className.includes("border-border-contrast")) throw Error("Missing live disabled outline pagination control");
      node.dataset.disabledOutlineSource = "";
      node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      return "[data-disabled-outline-source]";
    });
    const observed = await page.evaluate(({ selector, fields, observer }) => {
      const node = document.querySelector(selector), observe = (0, eval)(`(${observer})`);
      if (!node.disabled || !node.checkVisibility()) throw Error("Disabled source is not visible and disabled");
      if ([...document.querySelectorAll('[data-sidebar="footer"]')].some(n => getComputedStyle(n).visibility !== "hidden"))
        throw Error("Source account footer is visible");
      const parts = [node, ...node.querySelectorAll("*")].filter(n => n.checkVisibility()).map(n => ({
        tag: n.localName, class: n.getAttribute("class"), text: n.textContent.slice(0, 100),
        styles: { ...Object.fromEntries(fields.map(f => [f, getComputedStyle(n)[f]])),
          typedHeight: n.computedStyleMap().get("height").toString() },
        paint: observe(n), rect: n.getBoundingClientRect().toJSON(),
      }));
      return { parts, disabled: node.disabled, footerHidden: true, url: location.href, html: node.outerHTML };
    }, { selector, fields: componentStyleFields, observer: observePaint.toString() });
    const id = `demo-Button-disabled-${width}-${theme}`, path = `${root}/disabled-outline-demo/${id}.png`;
    const crop = await captureCrop(page, selector, { align: false });
    await writeFile(path, Buffer.from(crop.data, "base64"));
    const acceptance = await inspectReferenceImage(page, { path, control: "Button", html: observed.html });
    assert.equal(acceptance.pass, true);
    const old = source.results.find(r => r.id === `mit-Button-disabled-${width}-${theme}` ||
      r.id === id);
    assert.ok(old, "Missing bounded disabled reference being replaced");
    const record = { id, kind: "Button", state: "disabled", width, theme,
      provenance: "real read-only Demo disabled outline pagination button",
      ...observed, path, file: `disabled-outline-demo/${id}.png`, acceptance,
      supplement: old.supplement ?? { provenance: "Actual pinned MIT padded outline text recipe; content/padding supplement only",
        parts: old.parts, owner: "32/44px target height; native toolbar label and its source text-button padding" } };
    source.results.splice(source.results.indexOf(old), 1, record);
    records.push(record);
    console.log(`DISABLED_OUTLINE_DEMO ${id} opacity=${observed.parts[0].styles.opacity}`);
  }
  await writeFile(sourcePath, JSON.stringify(source, null, 2));
  await writeFile(`${root}/disabled-outline-demo/records.json`, JSON.stringify({ records }, null, 2));
} finally { await tabs.closeAll(); await browser.close(); }
assert.equal(records.length, 4);
