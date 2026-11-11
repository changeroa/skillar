import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { readP1Style } from "./p1-style.mjs";
import { captureP1 } from "./p1-capture.mjs";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), tab = await tabs.create("about:blank"), { page } = tab;
const origin = "https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646";
const rows = [], held = new Set();
let unsubscribe;
await mkdir(`${out}/demo-extra`, { recursive: true });
async function prepare(theme) {
  await tabs.repin(tab, { width: 390, height: 844 });
  await applyViewport(page, { width: 390, height: 844, mobile: true, coarse: true, deviceScaleFactor: 3 });
  await page.evaluate(async theme => {
    localStorage.setItem("theme", theme);
    dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: theme, storageArea: localStorage }));
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    const style = document.createElement("style");
    style.textContent = '[data-sidebar="footer"]{display:none!important}';
    document.head.append(style);
    await document.fonts.ready;
  }, theme);
}
async function capture(component, state, theme, selector, interaction) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    footerHidden: [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility()),
    textLength: document.querySelector("main")?.innerText.length ?? 0,
  }));
  assert.equal(metrics.width, 390);
  assert.equal(metrics.footerHidden, true);
  assert.ok(metrics.textLength > 50);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (typeof animation.currentTime !== "number") animation.pause();
      else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
      else { animation.pause(); animation.currentTime = 0; }
    }
  });
  const style = await readP1Style(page, selector), file = `${out}/demo-extra/${component}-${state}-${theme}.png`;
  assert.equal(style.visible, true);
  const image = await captureP1(page, selector, file);
  assert.ok(image.varied > 0);
  rows.push({ component, state, theme, width: 390, viewportWidth: 390, provenance: "REAL-DEMO",
    url: origin, selector, style, geometry: style.geometry, file, accountFooterHidden: true, interaction, metrics });
  console.log(`P1_DEMO_EXTRA ${component} ${state} ${theme}`);
}
async function release() {
  for (const requestId of held) await page._sendToTarget("Fetch.continueRequest", { requestId });
  held.clear();
  await page._sendToTarget("Fetch.disable");
  unsubscribe?.();
  unsubscribe = undefined;
}
try {
  await tabs.repin(tab, { width: 390, height: 844 });
  await applyViewport(page, { width: 390, height: 844, mobile: true, coarse: true, deviceScaleFactor: 3 });
  for (const theme of ["light", "dark"]) {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await prepare(theme);
    await ready(page, "tbody tr");
    await ready(page, '[role=img] img');
    const avatar = await page.evaluate(() => {
      const outer = [...document.querySelectorAll("[role=img]")].find(n => n.checkVisibility());
      const node = outer?.firstElementChild, image = node?.querySelector("img");
      if (!node || !image?.complete || !image.naturalWidth) throw Error("Live navigation Avatar image is not loaded");
      node.dataset.p1LiveAvatar = "true";
      return { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height };
    });
    assert.equal(avatar.width, 32);
    assert.equal(avatar.height, 32);
    await capture("Avatar", "image", theme, "[data-p1-live-avatar]",
      "Actual DS Avatar image in the phone header; account menu was never opened. Image payload is caller-owned; no name, email, or image URL is retained.");
    unsubscribe = page.cdp.on("Fetch.requestPaused", event => {
      if (event.request.method === "GET") held.add(event.requestId);
      else void page._sendToTarget("Fetch.continueRequest", { requestId: event.requestId });
    });
    await page._sendToTarget("Fetch.enable", { patterns: [
      { urlPattern: "*://jp.cloud.langfuse.com/api/trpc/dashboard.chart*", requestStage: "Request" },
      { urlPattern: "*://jp.cloud.langfuse.com/api/trpc/dashboard.executeQuery*", requestStage: "Request" },
    ] });
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await prepare(theme);
      const selector = ".absolute.top-5.right-5 > svg.animate-spin.size-5.block";
      await ready(page, selector);
      assert.ok(held.size > 0, "Loading state must be held by an actual read-only dashboard GET");
      await capture("Spinner", "md-inherit", theme, selector,
        "Actual pinned Spinner signature: Loader2, animate-spin, size-5, block; omitted variant inherits foreground rather than text-primary. Only read-only dashboard GET responses are held until this capture, then continued; no error or write is induced.");
    } finally { await release(); }
  }
  assert.equal(rows.length, 4);
} finally {
  if (unsubscribe) await release();
  await writeFile(`${out}/demo-records-extra.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_DEMO_EXTRA_RESULT ${rows.length}/4 PASS`);
