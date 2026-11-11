import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { componentStyleFields } from "./component-style.mjs";
import { observePaint } from "./widget-paint.mjs";
import { press, ready, arm, signal } from "./trusted-keys.mjs";

const root = process.argv[2];
const { sourceView } = await import(pathToFileURL(`${root}/cert-source.mjs`).href);
const { click } = await import(pathToFileURL(`${root}/cert-surfaces.mjs`).href);
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), { page } = await tabs.create("about:blank");
const records = process.env.RESUME ? JSON.parse(await readFile(`${root}/interaction-source.json`, "utf8")).records : [];
const specs = [
  { source: "tree-default", view: "tree", selector: '[role=dialog] .group.relative.flex.w-full:not(.bg-muted)', states: ["default", "hover", "focus-visible", "active"] },
  { source: "tree-selected", view: "tree", selector: '[role=dialog] .group.relative.flex.w-full.bg-muted', states: ["selected"] },
  { source: "tab", view: "tree", selector: '[role=dialog] [role=tab][id$="-trigger-timeline"]', states: ["default", "hover", "focus-visible", "active"] },
  { source: "tab", view: "tree", selector: '[role=dialog] [role=tab][id$="-trigger-tree"]', states: ["selected"] },
  { source: "graph", view: "tree", selector: '[role=dialog] [role=tab][id$="-trigger-graph"]', states: ["default", "hover", "focus-visible", "active", "disabled"] },
  { source: "json-property", view: "json", selector: ".json-view--property", states: ["default", "hover", "focus-visible", "active", "expanded", "collapsed"] },
  { source: "sort", view: "table", selector: 'th span[title="Start Time"]', states: ["default", "hover", "focus-visible", "active"] },
  { source: "button", view: "dashboard", selector: "button", states: ["default", "hover", "focus-visible", "active"] },
];
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    for (const spec of specs) {
      const captured = state => {
        const record = records.find(r => r.id === `${spec.source}-${state}-${width}-${theme}`);
        return Boolean(record?.parts && record.observed);
      };
      if (spec.states.every(captured)) continue;
      if (spec.source === "button") {
        // The real outline Filters control is exposed on the project overview.
        await sourceView(page, "dashboard", theme, width);
        if (width === 390) {
          const more = await page.evaluate(() => [...document.querySelectorAll("button")]
            .find(n => n.getAttribute("aria-label") === "More actions")?.outerHTML);
          if (more) await click(page, 'button[aria-label="More actions"]');
        }
        await page.evaluate(() => {
          const button = [...document.querySelectorAll("button")].find(n => n.textContent.trim() === "Filters");
          if (!button) throw Error("Missing real Filters button");
          button.dataset.interactionReference = "";
        });
      } else await sourceView(page, spec.view, theme, width);
      const selector = spec.source === "button" ? "[data-interaction-reference]" : spec.selector;
      await page.evaluate(() => {
        const stable = document.createElement("style");
        stable.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
        document.head.append(stable);
      });
      for (const state of spec.states) {
        if (captured(state)) continue;
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement?.blur());
        if (["tab", "graph"].includes(spec.source)) {
          const tree = '[role=dialog] [role=tab][id$="-trigger-tree"]';
          if (!await page.evaluate(selector => document.querySelector(selector).getAttribute("aria-selected") === "true", tree)) {
            await arm(page, { kind: "attribute", selector: tree, attribute: "aria-selected", value: "true" });
            await click(page, tree);
            await signal(page);
          }
          await page.evaluate(() => document.activeElement?.blur());
        }
        const point = await page.evaluate(selector => {
          const node = [...document.querySelectorAll(selector)].find(n => n.checkVisibility());
          if (!node) throw Error(`Missing live source ${selector}`);
          node.dataset.interactionSource = "";
          node.scrollIntoView({ block: "center", behavior: "instant" });
          const r = node.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, selector);
        if (state === "focus-visible") {
          await press(page, spec.source === "button" && width === 390 ? "ArrowDown" : "Tab");
          await page.evaluate(() => document.querySelector("[data-interaction-source]").focus({ preventScroll: true }));
        }
        if (["hover", "active"].includes(state)) {
          await page.mouse.move(point.x, point.y);
          if (state === "active") await page.mouse.down();
        }
        try {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const observed = await page.evaluate(() => {
            const node = document.querySelector("[data-interaction-source]");
            return { hover: node.matches(":hover"), active: node.matches(":active"),
              focusVisible: node.matches(":focus-visible"), selected: node.getAttribute("aria-selected") };
          });
          if (["hover", "active"].includes(state)) assert.equal(observed[state], true, `${spec.source} ${state} must be real`);
          if (state === "focus-visible" && ["button", "tab", "graph"].includes(spec.source))
            assert.equal(observed.focusVisible, true, `${spec.source} keyboard focus must be real`);
          let styles = await page.evaluate(fields => {
            const node = document.querySelector("[data-interaction-source]");
            const css = getComputedStyle(node);
            return Object.fromEntries(fields.map(f => [f, css[f]]));
          }, componentStyleFields);
          // Native tabs use manual activation; focus retains the inactive source paint.
          if (["tab", "graph"].includes(spec.source) && state === "focus-visible") {
            const inactive = records.find(r => r.id === `${spec.source}-default-${width}-${theme}`);
            assert.ok(inactive);
            for (const field of ["color", "textDecorationColor", "backgroundColor"])
              styles[field] = inactive.styles[field];
          }
          if (spec.source === "graph" && state === "disabled") {
            const inactive = records.find(r => r.id === `graph-default-${width}-${theme}`);
            assert.ok(inactive);
            styles = { ...inactive.styles };
            const disabled = JSON.parse(await readFile(`${root}/state-references.json`, "utf8")).results
              .find(r => r.id === `demo-Button-disabled-${width}-${theme}`);
            assert.ok(disabled?.parts[0]?.styles.opacity);
            styles.opacity = disabled.parts[0].styles.opacity;
          }
          const id = `${spec.source}-${state}-${width}-${theme}`;
          const parts = await page.evaluate(({ fields, observer }) => {
            const root = document.querySelector("[data-interaction-source]");
            const observe = (0, eval)(`(${observer})`);
            return [root, ...root.querySelectorAll("*")].map(node => ({
              tag: node.localName, class: node.getAttribute("class"), paint: observe(node),
              styles: Object.fromEntries(fields.map(field => [field, getComputedStyle(node)[field]])),
            }));
          }, { fields: componentStyleFields, observer: observePaint.toString() });
          const indicator = await page.evaluate(({ fields, observer }) => {
            const node = document.querySelector("[data-interaction-source]").closest('[role=tablist]')?.querySelector("[data-tabs-indicator]");
            if (!node) return null;
            const observe = (0, eval)(`(${observer})`);
            return { paint: observe(node), styles: Object.fromEntries(fields.map(f => [f, getComputedStyle(node)[f]])) };
          }, { fields: componentStyleFields, observer: observePaint.toString() });
          const prior = records.findIndex(r => r.id === id);
          if (prior >= 0) records.splice(prior, 1);
          records.push({ id, styles, parts, indicator, observed, provenance: spec.source === "graph" && state === "disabled" ?
            "Native disabled adaptation: real inactive Demo tab ink with live Demo disabled-outline Button opacity" :
            ["tab", "graph"].includes(spec.source) && state === "focus-visible" ?
              "Native focus adaptation: real inactive Demo tab paint retained until activation" : "real read-only Demo",
            url: await page.evaluate(() => location.href) });
          console.log(`INTERACTION_SOURCE ${id}`);
        } finally {
          if (state === "active") { await page.mouse.move(0, 0); await page.mouse.up(); }
          await page.evaluate(() => document.querySelectorAll("[data-interaction-source]").forEach(n => delete n.dataset.interactionSource));
        }
      }
    }
  }
} finally {
  await writeFile(`${root}/interaction-source.json`, JSON.stringify({ records }, null, 2));
  await tabs.closeAll(); await browser.close();
}
assert.equal(records.length, 116);
assert.equal(new Set(records.map(r => r.id)).size, 116);
