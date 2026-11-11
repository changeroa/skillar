/** Logical painted parts shared by the source and Preact implementations. */
const controlText = { role: "text", actual: ":scope", source: ":scope", count: 1,
  actualControl: true, sourceControl: true, textOnly: true };
/**
 * The real native hit control (input/select/textarea). Its shown state, visibility, display,
 * pointer events and effective opacity are compared with the source trigger in every state.
 * `overlay`: the product's own glyphs are transparent and a sibling text run paints the value.
 * `transparent`: the owner's native select overlay must stay at opacity 0 while the source paints.
 */
const control = (actual, extra = {}) => ({ role: "control", actual, source: ":scope", count: 1, hit: true, ...extra });
const dateField = { role: "to-field", scope: "specimen", actual: ".lf-field + .lf-field input[data-date-range-field]",
  source: ":scope", count: 1, hit: true, nativeDate: true };

/**
 * Open popup anatomy. Combobox is single-choice (pinned SelectInput: Radix Select,
 * radio indicators); MultiSelect is the pinned MultiSelectInput (cmdk, checkboxes).
 */
function popup(component) {
  const single = component === "Combobox";
  const item = single ? "[role=option]" : "[cmdk-item]";
  const active = single ? "[data-highlighted]" : "[data-selected=true]";
  const checked = single ? "[data-state=checked]" : "[aria-checked=true]";
  const disabled = single ? "[data-disabled]" : "[data-disabled=true]";
  const rows = [
    { role: "option-active", actual: 'li[data-active="true"]', source: `${item}${active}`, count: 1 },
    { role: "option-selected", actual: 'li[aria-selected="true"]:not([data-active="true"])',
      source: `${item}${checked}:not(${active})`, count: 1 },
    { role: "option-disabled", actual: 'li[aria-disabled="true"]', source: `${item}${disabled}`, count: 1 },
    { role: "option-rest", actual: 'li[role=option]:not([data-active="true"]):not([aria-selected="true"]):not([aria-disabled="true"])',
      source: `${item}:not(${active}):not(${checked}):not(${disabled})`, count: 1 },
    { role: "list", actual: "ul[role=listbox]", source: single ? "[data-radix-select-viewport]" : "[cmdk-list]", count: 1 },
  ];
  const indicators = single ? [
    { role: "radio-checked", actual: 'li[aria-selected="true"] .lf-combobox__radio',
      source: `${item}${checked} span.rounded-full:has(> span)`, count: 1 },
    { role: "radio", actual: 'li[aria-selected="false"] .lf-combobox__radio',
      source: `${item}:not(${checked}) span.rounded-full`, count: 3 },
    { role: "radio-dot", actual: ".lf-combobox__radio > span", source: "span.rounded-full > span.rounded-full", count: 1 },
  ] : [
    { role: "select-all", actual: ".lf-combobox__all", source: "button[aria-pressed]", count: 1 },
    { role: "checkbox-all", actual: ".lf-combobox__all .lf-combobox__box", source: "button[aria-pressed] [role=checkbox]", count: 1 },
    { role: "checkbox-checked", actual: 'li[aria-selected="true"] .lf-combobox__box',
      source: `${item}${checked} [role=checkbox]`, count: 1 },
    { role: "checkbox", actual: 'li[aria-selected="false"] .lf-combobox__box',
      source: `${item}:not(${checked}) [role=checkbox]`, count: 3 },
  ];
  return [...rows, ...indicators];
}

/** Region of the source owned by an approved adaptation; its height is reported, never ignored. */
export function p1Excluded(component, state) {
  // WAI-ARIA editable combobox: the search field is the trigger input, not a popup row.
  return component === "MultiSelect" && state === "open" ? "div:has(> [cmdk-input])" : null;
}

const markdown = [
  { role: "heading-1", actual: 'h3[data-level="1"]', source: ":scope > h1", count: 1 },
  { role: "heading-2", actual: 'h3[data-level="2"]', source: ":scope > h2", count: 7 },
  { role: "list", actual: ":scope > ul", source: ":scope > ul", count: 6 },
  { role: "nested-list", actual: "li > ol", source: "li ol", count: 1 },
  { role: "item", actual: "li", source: "li", count: 17 },
  { role: "paragraph", actual: ":scope > p", source: ":scope > p", count: 8 },
  { role: "emphasis", actual: "em", source: "em", count: 4 },
  { role: "code", actual: ".lf-codeblock pre", source: ".codeblock pre", count: 2 },
];

export function p1Descendants(component, state) {
  switch (component) {
    case "MarkdownViewer":
      return state === "formatted" ? [{ role: "paragraph", actual: ":scope > p", source: ":scope > p", count: 1 }]
        : state === "structured" ? markdown : [];
    case "CodeBlock":
      return [
        ...(state === "read-only" ? [] : [
          { role: "toolbar", actual: ":scope > header", source: ":scope > div:first-child", count: 1 },
          { role: "language", actual: ":scope > header > span:not(.lf-copy)", source: ":scope > div:first-child > span", count: 1 },
        ]),
        { role: "code", actual: ":scope > pre", source: ":scope > pre", count: 1 },
        { role: "copy", actual: "button", source: "button", count: 1 },
      ];
    case "Toast":
      return [
        { role: "title", actual: ".lf-toast__content > strong", source: "[data-title]", count: 1 },
        { role: "description", actual: ".lf-toast__content > div", source: "[data-description]", count: 1 },
        { role: "action", actual: ".lf-button", source: "[data-action]", count: 1 },
      ];
    case "DiffViewer":
      return state === "empty" ? [] : [
        { role: "header", actual: ".lf-diff__head > span", source: ":scope > .p-0 > div:first-child > div", count: 2, textPaint: false },
        { role: "removed", actual: '[data-side=before]', source: ":scope > .p-0 > div:last-child > div > div:first-child", count: 1, actualText: "code", sourceText: ":scope" },
        { role: "added", actual: '[data-side=after]', source: ":scope > .p-0 > div:last-child > div > div:last-child", count: 1, actualText: "code", sourceText: ":scope" },
      ];
    case "Textarea": return [control(":scope"), controlText];
    case "DateRangeInput":
      // Both KST fields are the same pinned native Input; the second is compared with it too.
      return [control(":scope", { nativeDate: true }), controlText, dateField,
        ...(state === "error" ? [{ role: "message", scope: "specimen",
          actual: "p[role=alert]", source: "p.text-destructive", count: 1 }] : [])];
    case "Combobox": case "MultiSelect":
      // The visible value/placeholder: a painted span on both sides (the product's input carries typed search only).
      return state === "open" ? popup(component)
        : [control(":scope > input", { overlay: true }),
          { role: "text", actual: ":scope > .lf-combobox__value", source: ":scope > span", count: 1, textOnly: true }];
    case "TimePeriodSelect":
      return [
        control(":scope > select", { overlay: true, transparent: true }),
        { role: "badge", actual: ":scope > .lf-select-badge", source: ":scope > div > div > span:first-child", count: 1 },
        { role: "label", actual: ":scope > .lf-select-value", source: ":scope > div > div > span:last-child", count: 1, textOnly: true },
      ];
    case "Switch": case "Radio": case "Avatar": case "Spinner": return [];
    default: throw new RangeError(`Missing descendant contract: ${component}/${state}`);
  }
}
