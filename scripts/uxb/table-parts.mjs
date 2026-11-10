/** Read the painted semantic parts; wrappers are retained as diagnostic context. */
export async function measureTableParts(page, selector, family) {
  return page.evaluate(({ selector, family }) => {
    const root = document.querySelector(selector);
    if (!root) throw Error(`Missing ${family}: ${selector}`);
    const fields = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color",
      "backgroundColor", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap",
      "borderTopWidth", "borderTopColor", "borderBottomWidth", "borderBottomColor",
      "borderRightWidth", "borderRightColor", "borderLeftWidth", "borderLeftColor",
      "borderRadius", "boxShadow", "opacity", "height", "width",
      "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset"];
    const visible = node => Boolean(node && node.getClientRects().length &&
      node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    const measured = {};
    const add = (name, node) => {
      if (!visible(node)) return;
      const css = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      measured[name] = { tag: node.tagName, text: node.innerText?.slice(0, 100),
        styles: Object.fromEntries(fields.map(key => [key, css[key]])), box: box.toJSON(),
        focused: node === document.activeElement, focusVisible: node.matches(":focus-visible"),
        checked: node.getAttribute("aria-checked") ?? node.getAttribute("data-checked") ??
          (node.closest(".lf-checkbox")?.querySelector("input")?.checked),
        disabled: node.matches(":disabled,[aria-disabled=true]") ||
          Boolean(node.querySelector("input:disabled,select:disabled,button:disabled")) ||
          Boolean(node.closest(".lf-checkbox,[role=menuitemcheckbox]")?.querySelector(":disabled")) ||
          Boolean(node.closest(":disabled,[aria-disabled=true]")),
        effectiveOpacity: [...(function* () { for (let item = node; item; item = item.parentElement) yield item; })()]
          .reduce((opacity, item) => opacity * Number(getComputedStyle(item).opacity), 1),
        focusable: node.tabIndex >= 0,
        glyph: node.matches("svg") ? node.innerHTML : undefined,
        glyphBox: node.matches("svg") ? Object.fromEntries(
          ["x", "y", "width", "height"].map(key => [key, node.getBBox()[key]])) : undefined };
    };
    const first = (node, query) => [...node.querySelectorAll(query)].find(visible);
    add("container", root);
    const table = root.matches("table") ? root : root.closest("table");
    if (table) {
      const row = root.matches("tr") ? root : first(root, "tbody tr");
      const header = root.matches("th") ? root : first(table, "th:nth-child(2)") ?? first(table, "th");
      add("header", header);
      add("sortButton", header && first(header, "button"));
      add("sortIndicator", header && first(header, "svg"));
      add("row", row);
      add("cell", row && [...row.children].find((node, index) => index > 0 &&
        getComputedStyle(node).position !== "sticky" && !node.querySelector('input[type="checkbox"],[role="checkbox"]')));
      if (row?.children.length === 1) add("cell", row.firstElementChild);
      add("firstCell", row?.firstElementChild);
      add("checkbox", row && first(row, '.lf-checkbox__box,[role="checkbox"]'));
      add("empty", first(table, '[role="status"],td[colspan]'));
      add("placeholder", first(table, '.lf-table-placeholder,[data-slot="skeleton"]'));
    }
    if (family === "Toolbar") {
      add("columnsTrigger", first(root, 'button[title="Show/hide columns"],button[id^="columns-"]'));
      add("densityTrigger", first(root, 'button[title="Row height"],button[id^="density-"]'));
      add("search", first(root, 'input[type="search"]'));
    }
    if (family === "Density" && !table) {
      add("body", first(root, ".lf-menu__body") ?? root);
      add("heading", first(root, ".lf-menu__heading") ??
        [...root.children].find(node => node.textContent.trim() === "Row height"));
      add("item", first(root, '[role="menuitemcheckbox"]'));
      add("itemCheck", first(root, '[role="menuitemcheckbox"][aria-checked="true"] svg'));
      add("separator", first(root, '[role="separator"]'));
    }
    if (family === "ColumnVisibility") {
      add("body", first(root, ".lf-menu__body") ?? root);
      const checkbox = first(root, '.lf-menu__checkbox,.lf-checkbox__box,[role="checkbox"]');
      add("item", first(root, '[role="menuitemcheckbox"]') ?? checkbox?.closest("label") ?? checkbox?.parentElement);
      add("itemLabel", checkbox?.nextElementSibling ?? first(root, '[role="menuitemcheckbox"]'));
      add("checkbox", checkbox);
      add("search", first(root, 'input'));
    }
    if (family === "FacetPanel") {
      add("heading", first(root, '.lf-facet-heading>button,button[aria-expanded]'));
      add("mode", first(root, '.lf-facet-modes>button,[role="tab"]'));
      add("modeActive", first(root, '.lf-facet-modes>[aria-pressed="true"],[role="tab"][aria-selected="true"]'));
      add("modeInactive", first(root, '.lf-facet-modes>[aria-pressed="false"],[role="tab"][aria-selected="false"]'));
      add("modeTrack", first(root, '.lf-facet-modes,[role="tablist"]'));
      const track = root.querySelector('.lf-facet-modes,[role="tablist"]');
      add("modeFill", (track && [...track.querySelectorAll("*")].find(node =>
        getComputedStyle(node).position === "absolute" && getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)" &&
        node.getBoundingClientRect().height > 10)) ?? first(root, '.lf-facet-modes>[aria-pressed="true"]'));
      add("input", first(root, 'input[type="search"],input[placeholder]'));
      add("choice", first(root, '.lf-facet-choice,.lf-checkbox,[role="checkbox"]')?.closest("label") ??
        first(root, '.lf-facet-choice,[role="checkbox"]'));
      add("checkbox", first(root, '.lf-checkbox__box,[role="checkbox"]'));
      const choice = first(root, '.lf-checkbox__box,[role="checkbox"]');
      add("choiceLabel", choice?.closest(".lf-checkbox")?.querySelector("span:last-child") ??
        choice?.nextElementSibling?.querySelector("span[title]"));
    }
    if (family === "Pagination") {
      const select = first(root, '.lf-select-wrap,[role="combobox"]');
      const text = [...root.querySelectorAll("p,label,span,div")].filter(node =>
        visible(node) && node.children.length === 0 && node.textContent.trim());
      add("label", first(root, ".lf-field>label") ?? text.find(node => node.textContent.includes("Rows per page")));
      add("select", select);
      add("page", first(root, ".lf-table-page") ?? text.find(node => /Page|of/.test(node.textContent)));
      const actions = [...root.querySelectorAll('button')].filter(node => visible(node) &&
        node !== select && !node.closest(".lf-select-wrap"));
      const previous = root.querySelector(".lf-table-page-actions") ? actions[1] : actions[0];
      const next = root.querySelector(".lf-table-page-actions") ? actions[2] : actions.at(-1);
      add("previous", previous); add("next", next);
      add("previousGlyph", previous?.querySelector("svg")); add("nextGlyph", next?.querySelector("svg"));
    }
    return { family, selector, url: location.href, theme: document.documentElement.classList.contains("dark") ||
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      coarse: matchMedia("(pointer: coarse)").matches, parts: measured };
  }, { selector, family });
}
