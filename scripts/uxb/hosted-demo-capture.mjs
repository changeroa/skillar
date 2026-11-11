import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { measureHostedStyle } from "./hosted-control-style.mjs";
import { captureCrop } from "./image-diff.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";
import { press } from "./trusted-keys.mjs";

/** Capture real, unmodified Demo controls; pointer-held states never activate. */
export async function captureHostedDemo(page, { selector, paddingSelector, control, state, width, theme, out }) {
  assert.equal(new URL(await page.url()).origin, "https://jp.cloud.langfuse.com");
  assert.ok(new URL(await page.url()).pathname.startsWith("/project/cmmnj9e9n0006ad06nyz28646"));
  await page._sendToTarget("Page.bringToFront");
  await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page._sendToTarget("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.evaluate(({ selector, theme }) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    for (const node of document.querySelectorAll('[data-sidebar="footer"]')) node.style.visibility = "hidden";
    document.activeElement?.blur();
    document.querySelector(selector).scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }, { selector, theme });
  await page.mouse.move(0, 0);
  if (state === "focus-visible") {
    await page.evaluate(selector => {
      const target = document.querySelector(selector);
      const items = [...document.querySelectorAll('button,a[href],input,select,[tabindex]')]
        .filter(n => n.tabIndex >= 0 && !n.disabled && n.checkVisibility() &&
          !n.hasAttribute("data-radix-focus-guard") && !n.closest('[inert],[aria-hidden="true"]'));
      const previous = items[items.indexOf(target) - 1];
      if (!previous) throw Error("No preceding trusted Tab stop");
      previous.focus();
    }, selector);
    await press(page, "Tab");
  }
  const point = await page.evaluate(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (["hover", "active"].includes(state)) await page.mouse.move(point.x, point.y);
  if (state === "active") await page.mouse.down();
  try {
    await page.evaluate(async selector => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations()
        .filter(animation => typeof animation.timeline?.currentTime === "number" &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, selector);
    const reference = await measureHostedStyle(page, { selector, paddingSelector });
    assert.equal(reference.focusVisible, state === "focus-visible");
    assert.equal(reference.disabled, state === "disabled");
    const evidence = await page.evaluate(({ selector, point, state }) => {
      const node = document.querySelector(selector), hit = document.elementFromPoint(point.x, point.y);
      if (hit !== node && !node.contains(hit)) throw Error("Occluded Demo control");
      const rect = node.getBoundingClientRect();
      if (rect.left < 4 || rect.top < 4 || rect.right + 4 > innerWidth || rect.bottom + 4 > innerHeight)
        throw Error("Demo control and crop padding must fit viewport");
      if (state === "hover" && !node.matches(":hover")) throw Error("Missing real hover");
      if (state === "active" && !node.matches(":active")) throw Error("Missing held pointer state");
      return { url: location.href, html: node.outerHTML, text: node.textContent,
        hover: node.matches(":hover"), active: node.matches(":active"),
        accountFooterHidden: [...document.querySelectorAll('[data-sidebar="footer"]')]
          .every(n => getComputedStyle(n).visibility === "hidden"),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, { selector, point, state });
    assert.equal(evidence.accountFooterHidden, true);
    const id = `${control}-${state}-${theme}-${width}`, path = `${out}/${id}.png`;
    const crop = await captureCrop(page, selector, { align: false });
    assert.deepEqual(await measureHostedStyle(page, { selector, paddingSelector }), reference, "Stable capture metrics/state");
    await mkdir(out, { recursive: true });
    await writeFile(path, Buffer.from(crop.data, "base64"));
    const acceptance = await inspectReferenceImage(page, { path, control });
    assert.equal(acceptance.pass, true, JSON.stringify(acceptance));
    return { id, control, state, width, theme, selector, paddingSelector, path, reference,
      ...evidence, acceptance, capturedAt: new Date().toISOString(), provenance: "REAL-DEMO" };
  } finally {
    if (state === "active") {
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
  }
}
