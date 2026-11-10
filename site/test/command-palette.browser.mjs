import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTrustedInput } from "./helpers/trusted-input.mjs";
import { applyViewport } from "../../scripts/uxb/viewport.mjs";

const keys = { k: ["KeyK", 75], ArrowDown: ["ArrowDown", 40], ArrowUp: ["ArrowUp", 38],
  Home: ["Home", 36], End: ["End", 35], Enter: ["Enter", 13], Escape: ["Escape", 27] };

async function ready(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const check = () => {
      if (!document.querySelector("[data-command-mount]") || !document.body.classList.contains("app-shell")) return;
      observer.disconnect(); clearTimeout(timer); resolve();
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { observer.disconnect(); reject(Error("Palette did not initialize")); }, 15000);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  }));
}

export async function navigate(page, expected, activate) {
  assert.notEqual(await page.evaluate(() => location.href), expected, "Navigation must change the URL");
  await page._sendToTarget("Page.enable");
  let unsubscribe, timer, rejectArrival;
  const arrived = new Promise((resolve, reject) => {
    rejectArrival = reject;
    unsubscribe = page.cdp.on("Page.frameNavigated", ({ frame }) => {
      if (!frame.parentId && frame.url === expected) resolve();
    });
  });
  try {
    // Prove key delivery first. Otherwise the navigation timeout can race the
    // receipt timeout and misreport undelivered Enter as a site defect.
    await activate();
    timer = setTimeout(() => rejectArrival(Error(`Palette did not navigate to ${expected}`)), 15000);
    await arrived;
    assert.equal(await page.evaluate(() => location.href), expected);
  } finally { unsubscribe(); clearTimeout(timer); }
}

/** Shared by the standalone browser regression and vqa's interaction script. */
export async function runPaletteInteractions(page, startURL, profile) {
  const origin = new URL(startURL).origin, evidence = [];
  const input = await createTrustedInput(page);
  const press = async (key, modifiers = 0) => {
    const [code, windowsVirtualKeyCode] = keys[key];
    await input.press({ key, code, windowsVirtualKeyCode, modifiers });
  };
  const reset = async () => {
    await page.goto(`${origin}/dashboard/`, { waitUntil: "domcontentloaded" });
    if(profile)await applyViewport(page,profile);
    await ready(page);
  };
  const open = async (modifiers = 4) => {
    await press("k", modifiers);
    assert.deepEqual(await page.evaluate(() => ({
      open: document.querySelector("#app-command").open,
      focused: document.activeElement === document.querySelector("#app-command input"),
    })), { open: true, focused: true });
  };
  const selected = async expected => assert.deepEqual(await page.evaluate(() => ({
    active: document.querySelector("#app-command input").getAttribute("aria-activedescendant"),
    selected: [...document.querySelectorAll('#app-command [aria-selected="true"]')].map(e => e.id),
  })), { active: expected, selected: [expected] });
  try {
    // This must change dashboard -> skills, not merely close the dialog.
    await reset(); await open();
    await press("ArrowDown"); await selected("app-command-option-sessions");
    await press("ArrowDown"); await selected("app-command-option-skills");
    await navigate(page, `${origin}/skills/`, () => press("Enter"));
    evidence.push({ case: "Meta+K, ArrowDown x2, Enter", url: `${origin}/skills/`, trusted: true });

    await reset(); await open();
    for (const [key, expected] of [["ArrowUp", "app-command-option-account"], ["ArrowDown", "app-command-option-dashboard"],
      ["End", "app-command-option-account"], ["Home", "app-command-option-dashboard"]]) {
      await press(key); await selected(expected);
    }
    await press("Escape");
    assert.deepEqual(await page.evaluate(() => ({
      open: document.querySelector("#app-command")?.open ?? false, focus: document.activeElement.id,
    })), { open: false, focus: "app-jump" });
    evidence.push({ case: "wrap, Home/End, Escape focus return", trusted: true });

    await reset(); await open();
    await input.focus();
    await page._sendToTarget("Input.insertText", { text: "연결" });
    await selected("app-command-option-connections");
    await navigate(page, `${origin}/connections/`, () => press("Enter"));
    evidence.push({ case: "type-filter + Enter", url: `${origin}/connections/`, trusted: true });

    await reset(); await open(2);
    const point = await page.evaluate(() => {
      const option = document.querySelector("#app-command-option-skills"), rect = option.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      return { x, y, hit: document.elementFromPoint(x, y)?.closest("button")?.id };
    });
    assert.equal(point.hit, "app-command-option-skills");
    await input.focus();
    await navigate(page, `${origin}/skills/`, async () => {
      await page._sendToTarget("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      for (const type of ["mousePressed", "mouseReleased"])
        await page._sendToTarget("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    });
    evidence.push({ case: "Control+K, hit-tested mouse click", url: `${origin}/skills/`, trusted: true });
    evidence.push({ case: "window keydown delivery", count: input.delivered });
    return evidence;
  } finally {
    try {
      await page.goto(startURL, { waitUntil: "domcontentloaded" });
      await ready(page);
    } finally { await input.dispose(); }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { OMOWRIGHT_HELPER, PALETTE_TEST_URL, CHROME_BIN } = process.env;
  assert.ok(OMOWRIGHT_HELPER && PALETTE_TEST_URL && CHROME_BIN,
    "Set OMOWRIGHT_HELPER, PALETTE_TEST_URL (production build with signed-in fixture), and CHROME_BIN");
  const { loadOmowright } = await import(pathToFileURL(OMOWRIGHT_HELPER).href);
  const { omowright } = await loadOmowright();
  const profile = await mkdtemp(join(tmpdir(), "palette-regression-"));
  const browser = await omowright.connectPipe({ browserPath: CHROME_BIN,
    browserArgs: ["--headless", "--no-first-run", `--user-data-dir=${profile}`], storageRoot: profile });
  const tabs = omowright.createAgentTabs(browser);
  try {
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      const viewport = { width, height: width === 390 ? 844 : 900 };
      const tab = await tabs.create("about:blank", { viewport });
      try {
        await tab.page._sendToTarget("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: width === 390 });
        await tab.page._sendToTarget("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
        const result = await runPaletteInteractions(tab.page, new URL("/dashboard/", PALETTE_TEST_URL).href,
          {...viewport,mobile:width===390,coarse:width===390});
        console.log(`${width} ${theme}: PASS ${JSON.stringify(result)}`);
      } finally { await tabs.close(tab); }
    }
  } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
}
