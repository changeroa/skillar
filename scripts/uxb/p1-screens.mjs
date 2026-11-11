import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { diffImages } from "./image-diff.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const { page } = tab;
const rows = [], diffs = [];
const skill = "11223344-1122-4122-8122-000000000002";
const routes = [
  ["home", "/dashboard/", ".home-changes rect"],
  ["skills", "/skills/", "tr[id^=skill-row-]"],
  ["document", `/skills/?skill=${skill}&view=full&tab=document`, ".detail"],
  ["versions", `/skills/?skill=${skill}&view=full&tab=versions`, ".version-list .version"],
  ["connections", "/connections/", ".connections-grid tbody tr"],
  ["account", "/login/?auth=signed-in", "#signed-in:not([hidden])"],
];
await mkdir(`${out}/screens`, { recursive: true });
try {
  for (const [name, route, selector] of routes) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const pair = {};
    for (const version of ["before", "after"]) {
      try {
        await page.goto(`http://${version}8.localhost:5181${route}`, { waitUntil: "domcontentloaded" });
        await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
        await applyViewport(page, { width, height: width === 390 ? 844 : 900,
          deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
        await ready(page, selector);
        await page.evaluate(async theme => {
          document.documentElement.dataset.theme = theme;
          await document.fonts.ready;
          for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 0; }
        }, theme);
        const metrics = await page.evaluate(() => ({
          width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
          h1: document.querySelectorAll("main h1").length,
          controls: [...document.querySelectorAll("main :is(button,input,select,textarea)")].filter(n => n.checkVisibility())
            .map(n => ({ tag: n.tagName, class: n.className, height: n.getBoundingClientRect().height })),
        }));
        const file = `${out}/screens/${name}-${version}-${width}-${theme}.png`;
        const shot = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(file, Buffer.from(shot.data, "base64"));
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const end = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(file.replace(".png", "-end.png"), Buffer.from(end.data, "base64"));
        rows.push({ name, route, version, width, theme, metrics, file,
          status: metrics.width === width && !metrics.overflow ? "PASS" : "FAIL" });
        pair[version] = file;
      } catch (error) { rows.push({ name, route, version, width, theme, status: "FAIL", error: String(error) }); }
    }
    if (pair.before && pair.after) diffs.push({ name, width, theme, ...await diffImages(page, {
      reference: pair.before, actual: pair.after,
      sideBySide: `${out}/screens/${name}-${width}-${theme}-side.png`,
      diff: `${out}/screens/${name}-${width}-${theme}-raw.png`,
    }) });
    console.log(`P1_SCREEN ${name} ${width} ${theme}`);
  }
} finally {
  await writeFile(`${out}/screens.json`, JSON.stringify({ rows, diffs,
    sourceContext: "Retained genuine Langfuse desktop context captures; no fabricated mobile context.",
  }, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_SCREENS ${rows.filter(row => row.status === "PASS").length}/${rows.length} PASS`);
process.exitCode = rows.some(row => row.status !== "PASS") ? 1 : 0;
