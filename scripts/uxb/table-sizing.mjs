/** Observe actual native hit areas, not just the visible Select wrapper. */
export async function measureTableSizing(page) {
  return page.evaluate(() => {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const expected = coarse || innerWidth <= 768 ? 44 : 32;
    const controls = [...document.querySelectorAll(
      ".lf-table-sort,.lf-table-toolbar :is(button,input,select),.lf-facet-panel :is(button,input)")]
      .filter(node => node.getClientRects().length && !node.closest("[hidden]"))
      .map(node => ({ tag: node.tagName, label: node.getAttribute("aria-label") ?? node.textContent.slice(0, 50),
        height: node.getBoundingClientRect().height, disabled: node.disabled }));
    const failures = controls.filter(control => Math.abs(control.height - expected) > 1);
    return { width: innerWidth, coarse, expected, controls, failures, pass: controls.length > 5 && !failures.length };
  });
}
