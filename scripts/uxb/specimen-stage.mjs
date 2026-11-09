/** Give actual components the same layout origin without cloning or resizing pixels. */
export async function stageSpecimen(page, selector) {
  return page.evaluate(selector => {
    const element = document.querySelector(selector);
    const card = element.closest("[data-specimen]");
    const sample = card.querySelector(".sample, .lf-controls__sample");
    const originals = [card, sample].map(node => node.getAttribute("style"));
    // Integer CSS coordinates keep descendant glyphs and curved edges on the
    // same raster grid before layout, rather than shifting only the outer crop.
    // Fixed-position cards acquire a compositor texture in upstream's page;
    // its SVGs are resampled despite integer DOM bounds. Absolute positioning
    // paints both renderers directly (the icon probe changes 147 pixels to 0).
    card.style.cssText += ";position:absolute;left:32px;top:80px;width:276px;z-index:2147483647;display:grid;gap:8px;padding:16px;align-content:start";
    sample.style.cssText += ";width:242px;display:flex;align-items:flex-start";
    const owner = element.closest("[data-specimen]");
    for (const input of owner.querySelectorAll("input")) input.spellcheck = false;
    document.activeElement?.blur();
    getSelection()?.removeAllRanges();
    window.scrollTo({ top: 0, behavior: "instant" });
    return originals;
  }, selector);
}

export async function unstageSpecimen(page, selector, originals) {
  await page.evaluate(({ selector, originals }) => {
    const card = document.querySelector(selector).closest("[data-specimen]");
    const sample = card.querySelector(".sample, .lf-controls__sample");
    [card, sample].forEach((node, index) => {
      if (originals[index] === null) node.removeAttribute("style");
      else node.setAttribute("style", originals[index]);
    });
  }, { selector, originals });
}
