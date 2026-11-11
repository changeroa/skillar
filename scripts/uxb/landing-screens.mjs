import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyViewport } from "./viewport.mjs";
import { ready } from "./trusted-keys.mjs";
import { diffImages } from "./image-diff.mjs";

const [mode, output, origin = "http://127.0.0.1:5186"] = process.argv.slice(2);
assert.ok(["before", "after"].includes(mode));
const { loadOmowright } = await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page;
const results = [];
await mkdir(join(output, mode), { recursive: true });
const user = { sub: "fixture", email: "fixture@example.test", name: "예시 계정",
  picture: "", createdAt: 1800000000, lastLogin: 1800000000 };
try {
  for (const width of [1440, 390, 1920]) for (const theme of ["light", "dark"]) {
    await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
    await applyViewport(page, { width, height: width === 390 ? 844 : 900,
      mobile: width === 390, coarse: width === 390 });
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    for (const state of ["anonymous", "signed-in", "pending", "error"]) {
      const init = await page._sendToTarget("Page.addScriptToEvaluateOnNewDocument", {
        source: `(${(({ state, theme, user }) => {
          localStorage.setItem("skillar-theme", theme);
          const original = window.fetch.bind(window);
          window.fetch = (input, options) => {
            const url = new URL(input instanceof Request ? input.url : input, location.href);
            if (url.pathname !== "/auth/session") return original(input, options);
            const payload = state === "signed-in" ? { user } : state === "error" ? {} : { user: null };
            if (state === "pending") return new Promise(resolve => {
              window.__releaseLandingSession = () => resolve(Response.json({ user: null }));
              document.documentElement.dataset.qaSessionPending = "true";
            });
            return Promise.resolve(Response.json(payload));
          };
        }).toString()})(${JSON.stringify({ state, theme, user })})`,
      });
      await page.goto("about:blank", { waitUntil: "domcontentloaded" });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await applyViewport(page, { width, height: width === 390 ? 844 : 900,
        mobile: width === 390, coarse: width === 390 });
      await page._sendToTarget("Page.removeScriptToEvaluateOnNewDocument", { identifier: init.identifier });
      await ready(page, state === "pending" ? "html[data-qa-session-pending] #landing-actions[hidden]" : "#landing-actions:not([hidden])");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const id = `${width}-${theme}-${state}`;
      const details = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        text: document.body.innerText,
        boxes: [...document.querySelectorAll(".header,.trace-hero__copy,.trace-hero__actions,#example,#values,#local-setup,.footer,#landing-actions a")]
          .map(node => ({ selector: node.id || node.className, rect: node.getBoundingClientRect().toJSON() })),
        actions: [...document.querySelectorAll("#landing-actions a")].map(node => ({
          href: node.getAttribute("href"), text: node.textContent, rect: node.getBoundingClientRect().toJSON(),
        })),
        palette: Object.fromEntries(["--accent", "--bg", "--surface", "--ink", "--muted", "--border", "--rule"]
          .map(key => [key, getComputedStyle(document.body).getPropertyValue(key).trim()])),
      }));
      assert.equal(details.width, width);
      assert.equal(details.overflow, false);
      if (state !== "pending" && width === 390) {
        assert.ok(details.actions.every(action => action.rect.bottom <= details.height),
          "Both mobile CTAs must remain in the first viewport");
      }
      const file = join(output, mode, `${id}.png`);
      await writeFile(file, Buffer.from((await page._sendToTarget("Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false })).data, "base64"));
      await page.evaluate(() => {
        document.scrollingElement.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" });
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await writeFile(join(output, mode, `${id}-end.png`), Buffer.from((await page._sendToTarget("Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false })).data, "base64"));
      if (state === "pending") await page.evaluate(() => window.__releaseLandingSession());
      let pixels = null;
      if (mode === "after") {
        pixels = await diffImages(page, { reference: join(output, "before", `${id}.png`), actual: file,
          sideBySide: join(output, `${id}-side.png`), diff: join(output, `${id}-diff.png`) });
      }
      results.push({ id, state, theme, width, details, pixels, capturedAt: new Date().toISOString() });
      console.log(`LANDING ${mode} ${id}`);
    }
  }
} finally {
  await writeFile(join(output, `${mode}.json`), JSON.stringify(results, null, 2));
  await page._sendToTarget("Page.close"); await browser.close();
}
if (mode === "after") {
  const before = JSON.parse(await readFile(join(output, "before.json"), "utf8"));
  for (const actual of results) {
    const baseline = before.find(row => row.id === actual.id);
    assert.equal(actual.details.text, baseline.details.text, `${actual.id}: content changed`);
    for (const name of ["header", "trace-hero__copy"]) {
      const a = actual.details.boxes.find(box => box.selector.includes(name));
      const b = baseline.details.boxes.find(box => box.selector.includes(name));
      assert.deepEqual(a.rect, b.rect, `${actual.id}: ${name} geometry changed`);
    }
  }
}
