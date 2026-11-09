import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "../../site/node_modules/zod/index.js";
import { ready } from "./trusted-keys.mjs";

const schema = z.object({
  hosted: z.url(), local: z.url(), referenceDirectory: z.string(),
  cases: z.array(z.object({
    id: z.string(), app: z.enum(["hosted", "local"]), path: z.string(),
    reference: z.string(), signedOut: z.boolean().default(false), end: z.boolean().default(false),
  })),
});
const [configPath, output, mode] = process.argv.slice(2);
const config = schema.parse(JSON.parse(await readFile(configPath, "utf8")));
if (mode === "summary") {
  const { results } = JSON.parse(await readFile(join(output, "results.json"), "utf8"));
  const summary = { cases: results.length, passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).map(r => ({ id: r.id, error: r.error })),
    references: [...new Set(results.filter(r => r.referenceStatus === "provided").map(r => r.reference))],
    noReference: [...new Set(results.filter(r => r.referenceStatus === "no reference").map(r => r.reference))],
    changed: results.filter(r => r.pixels?.changed).map(r => ({ id: r.id, ...r.pixels })),
    freshDocuments: results.every(r => r.details?.before.documentId !== r.details?.after.documentId) };
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary)); process.exit(summary.failed.length ? 1 : 0);
}
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page, results = [], now = Date.now();
await mkdir(output, { recursive: true });
await page._sendToTarget("Network.enable");
await page._sendToTarget("Network.setCacheDisabled", { cacheDisabled: true });
await page._sendToTarget("Page.addScriptToEvaluateOnNewDocument", { source: `(${(({ now }) => {
  const OriginalDate = Date;
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  window.__uxbScreenPending = 0; window.__uxbScreenErrors = [];
  window.__uxbDocumentId = crypto.randomUUID();
  const original = fetch.bind(window);
  window.fetch = async (...args) => {
    window.__uxbScreenPending++;
    try {
      const response = await original(...args);
      if (!response.headers.get("content-type")?.includes("text/event-stream"))
        await response.clone().arrayBuffer();
      return response;
    } finally {
      window.__uxbScreenPending--; document.dispatchEvent(new Event("uxb-network-state"));
    }
  };
  addEventListener("error", event => window.__uxbScreenErrors.push(event.message));
}).toString()})(${JSON.stringify({ now })})` });
try {
  for (const target of config.cases) for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const height = width === 1440 ? 900 : 844;
    const id = `${target.id}-${width}-${theme}`, frames = {}, details = {};
    try {
    await tabs.repin(tab, { width, height });
    for (const variant of ["before", "after"]) {
      await page._sendToTarget("Network.setCookie", { name: "__qa_pr0_build", value: variant, url: config[target.app] });
      await page._sendToTarget("Network.setCookie", { name: "__qa_pr0_signed_out", value: target.signedOut ? "1" : "0", url: config[target.app] });
      await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
      ] });
      await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
      // Hash-only Page.navigate can reuse the old document and ignore the new
      // build cookie. Force a new document for each before/after variant.
      await page.goto("about:blank", { waitUntil: "domcontentloaded" });
      await page.goto(config[target.app] + target.path, { waitUntil: "domcontentloaded" });
      await page._sendToTarget("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await ready(page, "h1");
      await page.evaluate(() => new Promise((resolve, reject) => {
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => finish(Error("Screen did not leave its loading state")), 12000);
        let painting = false;
        function finish(error) {
          clearTimeout(timer); observer.disconnect(); document.removeEventListener("uxb-network-state", check);
          error ? reject(error) : resolve();
        }
        function check() {
          const status = [...document.querySelectorAll('[role="status"],[aria-live],.loading')]
            .filter(e => e.getClientRects().length).map(e => e.innerText).join(" ");
          if (window.__uxbScreenPending === 0 && !document.querySelector('[aria-busy="true"]') &&
              !/(?:불러오는|확인)\s*중|Loading\s*\.{2,}/i.test(status) && !painting) {
            painting = true;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              painting = false;
              if (window.__uxbScreenPending === 0 && !document.querySelector('[aria-busy="true"]')) finish();
            }));
          }
        }
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        document.addEventListener("uxb-network-state", check); check();
      }));
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      details[variant] = await page.evaluate(() => ({
        documentId: window.__uxbDocumentId,
        assets: [...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
          .map(e => e.getAttribute("src") ?? e.getAttribute("href")),
        title: document.title, h1: document.querySelector("h1").textContent,
        text: document.body.innerText, width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth, errors: window.__uxbScreenErrors,
        boxes: [...document.querySelectorAll("body *")].flatMap((element, index) => {
          if (!(element instanceof HTMLElement) || ["SCRIPT", "STYLE"].includes(element.tagName)) return [];
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return [];
          const style = getComputedStyle(element);
          return [{ index, tag: element.tagName, className: element.className,
            rect: [rect.x, rect.y, rect.width, rect.height], color: style.color,
            background: style.backgroundColor, font: style.font, border: style.borderColor }];
        }),
      }));
      const shot = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      frames[variant] = Buffer.from(shot.data, "base64");
      await writeFile(join(output, `${id}-${variant}.png`), frames[variant]);
      if (target.end) {
        await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        const end = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(output, `${id}-${variant}-end.png`), Buffer.from(end.data, "base64"));
      }
    }
    if (details.before.documentId === details.after.documentId)
      throw Error("Before and after reused the same document");
    const reference = join(config.referenceDirectory, `${target.reference}--${width}-${theme}.png`);
    let referenceBytes = null;
    try { referenceBytes = await readFile(reference); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const sources = [referenceBytes, frames.before, frames.after].map(bytes =>
      bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null);
    const comparison = await page.evaluate(async ({ sources, width, height }) => {
      const images = await Promise.all(sources.map(src => new Promise((resolve, reject) => {
        if (!src) {
          const blank = document.createElement("canvas"); blank.width = width; blank.height = height;
          const context = blank.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
          context.fillStyle = "#111111"; context.font = "16px system-ui"; context.fillText("no reference", 16, 32);
          resolve(blank); return;
        }
        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
      })));
      if (images.some(image => image.width !== width || image.height !== height)) throw Error("Three-way viewport dimensions do not match");
      const matrix = document.createElement("canvas"); matrix.width = width * 3; matrix.height = height + 24;
      const context = matrix.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, matrix.width, matrix.height);
      context.fillStyle = "#111111"; context.font = "13px system-ui";
      [sources[0] ? "Langfuse demo (provided)" : "Langfuse: no reference", "baseline", "current"]
        .forEach((text, i) => context.fillText(text, i * width + 8, 17));
      images.forEach((image, i) => context.drawImage(image, i * width, 24));
      const pixels = images.slice(1).map(image => {
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      });
      const diff = document.createElement("canvas"); diff.width = width; diff.height = height;
      const data = new Uint8ClampedArray(pixels[0].length);
      let changed = 0, maxDelta = 0;
      for (let i = 0; i < data.length; i += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(pixels[0][i + c] - pixels[1][i + c])));
        if (delta) changed++; maxDelta = Math.max(maxDelta, delta);
        data.set(delta ? [255, 0, 96, 255] : [pixels[1][i], pixels[1][i + 1], pixels[1][i + 2], 48], i);
      }
      diff.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
      return { changed, maxDelta, total: width * height, matrix: matrix.toDataURL("image/png"), diff: diff.toDataURL("image/png") };
    }, { sources, width, height });
    await writeFile(join(output, `${id}-three-way.png`), Buffer.from(comparison.matrix.split(",")[1], "base64"));
    await writeFile(join(output, `${id}-diff.png`), Buffer.from(comparison.diff.split(",")[1], "base64"));
    const { matrix, diff, ...pixels } = comparison;
    results.push({ id, target, width, height, theme, reference,
      referenceStatus: referenceBytes ? "provided" : "no reference", pixels, details,
      pass: !details.before.overflow && !details.after.overflow && !details.before.errors.length && !details.after.errors.length });
    await writeFile(join(output, "results.json"), JSON.stringify({ frozenClock: now, results }, null, 2));
    console.log(`MATRIX ${id} pixels=${pixels.changed}/${pixels.total}`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      results.push({ id, target, width, height, theme, pass: false, error: error.message });
      await writeFile(join(output, "results.json"), JSON.stringify({ frozenClock: now, results }, null, 2));
      console.error(`MATRIX_FAIL ${id} ${error.message}`);
    }
  }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ frozenClock: now, results }, null, 2));
  await page._sendToTarget("Page.close"); await browser.close();
}
if (results.some(result => !result.pass)) process.exitCode = 1;
