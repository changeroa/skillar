import { mkdir, readFile, writeFile, statfs } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { manifestSchema } from "./manifest.mjs";
import { measure, metricFailures } from "./metrics.mjs";
import { diffImages } from "./image-diff.mjs";

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=/path/omowright.mjs node scripts/uxb/capture.mjs manifest.json evidence-dir");
const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
const output = resolve(outputPath), manifestDirectory = dirname(resolve(manifestPath));
await mkdir(output, { recursive: true });
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
// Never launch Chrome or touch an existing user tab. One owned tab/session only.
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } });
const page = tab.page, results = [];
try {
  for (const target of manifest.pages) for (const profile of manifest.profiles) for (const theme of ["light", "dark"]) {
    const disk = await statfs("/");
    if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw Error("STOP: root disk has less than 8 GiB free");
    const url = new URL(target.url); url.searchParams.set("theme", theme);
    await tabs.repin(tab, { width: profile.width, height: profile.height });
    await page._sendToTarget("Emulation.setDeviceMetricsOverride", {
      width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor, mobile: profile.touch,
    });
    await page._sendToTarget("Emulation.setTouchEmulationEnabled", { enabled: profile.touch });
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page._sendToTarget("Emulation.setDeviceMetricsOverride", {
      width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor, mobile: profile.touch,
    });
    await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.evaluate(selector => new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => { observer.disconnect(); reject(Error(`Missing ready state: ${selector}`)); }, 10000);
      function check() {
        if (!document.querySelector(selector)) return;
        observer.disconnect(); clearTimeout(timer); resolve();
      }
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      check();
    }), target.ready);
    await page.evaluate(async () => { await document.fonts.ready; });
    const prefix = `${target.id}-${profile.id}-${theme}`;
    const viewport = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      coarse: matchMedia("(pointer: coarse)").matches,
      dpr: devicePixelRatio,
    }));
    const top = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(output, `${prefix}-top.png`), Buffer.from(top.data, "base64"));
    for (const specimen of target.states) {
      const point = await page.evaluate(selector => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw Error(`Missing ${selector}`);
        element.scrollIntoView({ block: "center", behavior: "instant" });
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, specimen.selector);
      await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved",
        x: specimen.action === "hover" || specimen.action === "active" ? point.x : 0,
        y: specimen.action === "hover" || specimen.action === "active" ? point.y : 0 });
      if (specimen.action === "focus") {
        await page._sendToTarget("Page.bringToFront");
        // Shift+Tab/Tab use trusted keys; focus starts on the known previous control.
        await page.evaluate(selector => { document.querySelector(selector).focus(); }, specimen.selector);
        await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await page._sendToTarget("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      }
      if (specimen.action === "active") await page._sendToTarget("Input.dispatchMouseEvent",
        { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      try {
        const actual = await measure(page, specimen.selector);
        const failures = metricFailures(actual, {
          ...specimen.expected, ...specimen.themeExpected?.[theme],
          ...(profile.touch || profile.width <= 768 ? specimen.touchExpected : {}),
        });
        if (viewport.width !== profile.width || viewport.height !== profile.height || viewport.overflow ||
          viewport.dpr !== profile.deviceScaleFactor || viewport.coarse !== profile.touch)
          failures.push({ property: "viewport", expected: profile, actual: viewport });
        const clip = await page.evaluate(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { x: Math.max(0, rect.x + scrollX - 4), y: Math.max(0, rect.y + scrollY - 4),
            width: Math.ceil(rect.width + 8), height: Math.ceil(rect.height + 8), scale: 1 };
        }, specimen.selector);
        const file = join(output, `${prefix}-${specimen.name}.png`);
        const shot = await page._sendToTarget("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
        await writeFile(file, Buffer.from(shot.data, "base64"));
        let comparison = null;
        const reference = specimen.profileReferences?.[profile.id] ?? specimen.reference;
        if (reference) {
          comparison = await diffImages(page, {
            reference: resolve(manifestDirectory, reference[theme]), actual: file,
            sideBySide: file.replace(".png", "-side.png"), diff: file.replace(".png", "-diff.png"),
            channelTolerance: manifest.pixelChannelTolerance,
          });
          if (!comparison.dimensionsMatch || comparison.diffRatio > 0)
            failures.push({ property: "pixels", expected: "reference pixels within declared channel tolerance", actual: comparison });
        } else if (manifest.requireReferences) failures.push({ property: "reference", expected: "upstream capture", actual: null });
        const result = { page: target.id, profile: profile.id, theme, state: specimen.name,
          file, viewport, actual, comparison, failures, status: failures.length ? "FAIL" : "PASS" };
        results.push(result);
        console.log(`${result.status} ${prefix} ${specimen.name}`);
      } finally {
        if (specimen.action === "active") await page._sendToTarget("Input.dispatchMouseEvent",
          { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
      }
    }
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    const end = await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(output, `${prefix}-end.png`), Buffer.from(end.data, "base64"));
  }
} finally {
  await writeFile(join(output, "results.json"), JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
  await tabs.closeAll();
  await browser.close();
}
if (results.some(result => result.status === "FAIL")) process.exitCode = 1;
