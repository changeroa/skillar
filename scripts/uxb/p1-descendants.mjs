/** Logical painted parts shared by the source and Preact implementations. */
export function p1Descendants(component, state) {
  switch (component) {
    case "MarkdownViewer":
      return state === "formatted" ? [{ role: "paragraph", actual: ":scope > p", source: ":scope > p", count: 1 }] : [];
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
        ...(state === "loading" ? [] : [
          { role: "action", actual: ".lf-button", source: "[data-action]", count: 1 },
        ]),
      ];
    case "DiffViewer":
      return state === "empty" ? [] : [
        { role: "header", actual: ".lf-diff__head > span", source: ":scope > .p-0 > div:first-child > div", count: 2, textPaint: false },
        { role: "removed", actual: '[data-side=before]', source: ":scope > .p-0 > div:last-child > div > div:first-child", count: 1, actualText: "code", sourceText: ":scope" },
        { role: "added", actual: '[data-side=after]', source: ":scope > .p-0 > div:last-child > div > div:last-child", count: 1, actualText: "code", sourceText: ":scope" },
      ];
    case "Textarea": case "Combobox": case "MultiSelect": case "DateRangeInput":
    case "TimePeriodSelect": case "Switch": case "Radio": case "Avatar": case "Spinner": return [];
    default: throw new RangeError(`Missing descendant contract: ${component}/${state}`);
  }
}
