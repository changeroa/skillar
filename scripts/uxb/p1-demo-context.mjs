import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), { page } = tab;
const rows = [];
const origin = "https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646";
await mkdir(`${out}/demo-context`, { recursive: true });
try {
  for (const [name, route] of [["home", ""], ["traces", "/traces"], ["prompt", "/prompts/answer%20question"]])
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      try {
        await page.goto(origin + route, { waitUntil: "domcontentloaded" });
        await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
        await applyViewport(page, { width, height: width === 390 ? 844 : 900,
          deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
        await ready(page, name === "prompt" ? "main" : "tbody tr");
        await page.evaluate(name => new Promise((resolve, reject) => {
          const observer = new MutationObserver(check);
          const timer = setTimeout(() => { observer.disconnect(); reject(Error("Demo main remained empty")); }, 10000);
          function check() {
            if ((document.querySelector("main")?.innerText.length ?? 0) <= 50) return;
            if (name === "prompt" && !document.querySelector("main")?.innerText.includes("Answer the following questions:")) return;
            observer.disconnect(); clearTimeout(timer); resolve();
          }
          observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); check();
        }), name);
        await page.evaluate(async theme => {
          localStorage.setItem("theme", theme);
          dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: theme, storageArea: localStorage }));
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.classList.toggle("light", theme === "light");
          const hide = document.createElement("style");
          hide.textContent = '[data-sidebar="footer"]{display:none!important}';
          document.head.append(hide);
          await document.fonts.ready;
          for (const animation of document.getAnimations()) {
            if (typeof animation.currentTime !== "number") animation.pause();
            else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
            else { animation.pause(); animation.currentTime = 0; }
          }
        }, theme);
        const metrics = await page.evaluate(() => ({
          width: innerWidth, textLength: document.querySelector("main")?.innerText.length ?? 0,
          footerHidden: [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility()),
          title: document.title, route: location.href,
        }));
        assert.equal(metrics.width, width);
        assert.equal(metrics.footerHidden, true);
        assert.ok(metrics.textLength > 50, "Source main must contain rendered content");
        const file = `${out}/demo-context/${name}-${width}-${theme}.png`;
        const image = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(file, Buffer.from(image.data, "base64"));
        rows.push({ name, width, theme, file, metrics, status: "PASS", provenance: "REAL-DEMO" });
      } catch (error) { rows.push({ name, width, theme, status: "FAIL", error: String(error) }); }
      console.log(`P1_DEMO_CONTEXT ${name} ${width} ${theme}`);
    }
} finally {
  await writeFile(`${out}/demo-context.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_DEMO_CONTEXT_RESULT ${rows.filter(row => row.status === "PASS").length}/${rows.length} PASS`);
process.exitCode = rows.some(row => row.status !== "PASS") ? 1 : 0;
