/** Reproduce the source containing block, never assign a measured size to the component. */
export function sidebarContext(source) {
  const { box, position } = source.parent;
  if (position !== "fixed" || box.top < 0 || box.bottom !== source.viewport[1] ||
      box.height !== source.viewport[1] - box.top)
    throw new RangeError("Sidebar reference needs a bounded fixed-shell context");
  return { position: "fixed", top: `${box.top}px`, left: "0px",
    height: `calc(100dvh - ${box.top}px)`, display: "flex", alignItems: "stretch",
    width: "max-content", zIndex: "1000" };
}

export async function withSidebarContext(page, selector, source, capture) {
  const style = sidebarContext(source);
  const previous = await page.evaluate(({ selector, style, viewport }) => {
    if (innerHeight !== viewport[1]) throw Error("Reference and specimen viewport heights must match");
    const parent = document.querySelector(selector).parentElement;
    const previous = parent.getAttribute("style");
    Object.assign(parent.style, style);
    return previous;
  }, { selector, style, viewport: source.viewport });
  try { return await capture(); }
  finally {
    await page.evaluate(({ selector, previous }) => {
      const parent = document.querySelector(selector).parentElement;
      if (previous === null) parent.removeAttribute("style");
      else parent.setAttribute("style", previous);
    }, { selector, previous });
  }
}
