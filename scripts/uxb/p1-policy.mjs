/** Exact owner adaptations; every other measured field stays source-owned. */
export async function p1OwnerPolicy(page, { component, state, reference, actual, coarse }) {
  const target = `${coarse ? 44 : 32}px`, policy = {};
  if (["Combobox", "MultiSelect", "DateRangeInput", "TimePeriodSelect"].includes(component)) policy.height = target;
  if (component === "CodeBlock") {
    if (state !== "read-only") policy.height = `${parseFloat(reference.values.height) + (coarse ? 18 : 6)}px`;
    const toolbar = reference.descendants.find(part => part.role === "toolbar")?.styles[0];
    policy.descendants = { copy: { width: target, height: target },
      ...(toolbar ? { toolbar: { height: `${parseFloat(toolbar.values.height) + (coarse ? 18 : 6)}px` } } : {}) };
  }
  if (component === "Toast") {
    policy.descendants = { action: { height: target } };
    if (coarse && state !== "loading") policy.height = `${Math.max(parseFloat(reference.values.height),
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
  }
  return policy;
}
