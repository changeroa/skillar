/** Exact owner adaptations; every other measured field stays source-owned. */
export async function p1OwnerPolicy(page, { component, state, reference, actual, coarse }) {
  const target = `${coarse ? 44 : 32}px`, policy = {};
  if (state === "open") {
    // Rows are 44px touch targets; the source popup's search row lives in the product's trigger input.
    const rows = component === "MultiSelect" ? 5 : 4, grow = coarse ? (44 - 32) * rows : 0;
    const listRows = coarse ? (44 - 32) * 4 : 0;
    const list = reference.descendants.find(part => part.role === "list")?.styles[0];
    policy.height = `${parseFloat(reference.values.height) - reference.excludedHeight + grow}px`;
    policy.descendants = Object.fromEntries(["option-active", "option-selected", "option-disabled", "option-rest", "select-all"]
      .map(role => [role, coarse ? { height: target } : {}]));
    if (list) policy.descendants.list = { height: `${parseFloat(list.values.height) + listRows}px` };
    // Radix Select moves DOM focus onto the active option; the product keeps focus in its input
    // (aria-activedescendant). With outline-style none on both, outline colour/width paint nothing.
    const sourceActive = reference.descendants.find(part => part.role === "option-active")?.styles[0]?.values;
    const productActive = actual.descendants.find(part => part.role === "option-active")?.styles[0]?.values;
    if (sourceActive?.outlineStyle === "none" && productActive?.outlineStyle === "none")
      Object.assign(policy.descendants["option-active"], { outlineColor: productActive.outlineColor, outlineWidth: productActive.outlineWidth });
    return policy;
  }
  if (["Combobox", "MultiSelect", "DateRangeInput", "TimePeriodSelect"].includes(component)) policy.height = target;
  if (component === "CodeBlock") {
    if (state !== "read-only") policy.height = `${parseFloat(reference.values.height) + (coarse ? 18 : 6)}px`;
    const toolbar = reference.descendants.find(part => part.role === "toolbar")?.styles[0];
    policy.descendants = { copy: { width: target, height: target },
      ...(toolbar ? { toolbar: { height: `${parseFloat(toolbar.values.height) + (coarse ? 18 : 6)}px` } } : {}) };
  }
  if (component === "MarkdownViewer" && state === "structured") {
    // Each embedded code toolbar grows by the owner's 32/44px copy target, exactly as standalone CodeBlock.
    const blocks = reference.descendants.find(part => part.role === "code")?.styles.length ?? 0;
    policy.height = `${parseFloat(reference.values.height) + blocks * (coarse ? 18 : 6)}px`;
  }
  if (component === "Toast") {
    policy.descendants = { action: { height: target } };
    if (coarse) policy.height = `${Math.max(parseFloat(reference.values.height),
      parseFloat(reference.values.paddingTop) + parseFloat(reference.values.paddingBottom) +
      parseFloat(reference.values.borderTopWidth) + parseFloat(reference.values.borderBottomWidth) + 44)}px`;
  }
  if (actual.focusWithin && ["Textarea", "Combobox", "MultiSelect", "DateRangeInput", "TimePeriodSelect"].includes(component)) {
    Object.assign(policy, await page.evaluate(component => {
      const probe = document.createElement("div"), period = component === "TimePeriodSelect";
      probe.style.boxShadow = period ? "none" : "var(--lf-field-focus-shadow)";
      if (period || component === "Textarea" || component === "DateRangeInput") {
        probe.style.outline = `var(--lf-focus-width) solid var(${period ? "--lf-foreground" : "--lf-primary-accent"})`;
        probe.style.outlineOffset = "var(--lf-focus-offset)";
      }
      document.body.append(probe); const css = getComputedStyle(probe);
      const fields = period || component === "Textarea" || component === "DateRangeInput"
        ? ["boxShadow", "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset"] : ["boxShadow"];
      const result = Object.fromEntries(fields.map(field => [field, css[field]]));
      probe.remove(); return result;
    }, component));
    // An invalid field keeps the source's destructive focus ring; the owner's visible outline still applies.
    if (state === "error" && component === "DateRangeInput") delete policy.boxShadow;
  }
  return policy;
}
