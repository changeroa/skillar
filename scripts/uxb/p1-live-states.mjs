import assert from "node:assert/strict";
import { readP1Style } from "./p1-style.mjs";
import { p1Pointer, releaseP1Pointer } from "./p1-pointer.mjs";
import { captureP1 } from "./p1-capture.mjs";

export async function captureLiveStates(page, { selector, file, specimen }) {
  const states = {};
  for (const interaction of ["rest", "hover", "active"]) {
    const pointer = await p1Pointer(page, selector, interaction);
    try {
      assert.equal(await page.evaluate(() =>
        [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility())), true);
      const style = await readP1Style(page, selector, specimen);
      const screenshot = interaction === "rest" ? file : file.replace(".png", `-${interaction}.png`);
      const capture = await captureP1(page, selector, screenshot);
      assert.ok(capture.varied > 0, "Source pixels must contain the intended component");
      states[interaction] = { style, screenshot, pointer, capture };
    } finally { if (interaction === "active") await releaseP1Pointer(page); }
  }
  return states;
}
