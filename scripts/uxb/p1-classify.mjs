import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new TypeError("Usage: p1-classify.mjs baseline-report.json classification.json");
const report = JSON.parse(await readFile(input, "utf8"));
const causes = {
  Textarea: ["harness setup mismatch", "The MIT host omits the deployed Plex Mono fallback family; both load the same retained font bytes."],
  Combobox: ["harness setup mismatch", "A disabled composed dashboard button was reused for enabled, empty and error editable controls; measure equivalent InputControl paint and the same state."],
  MultiSelect: ["harness setup mismatch", "The source trigger includes its dropdown glyph; the actual selector measured only its input. Disabled and empty source props were not matched."],
  MarkdownViewer: ["harness setup mismatch", "A populated 596px source line was reused for a narrower populated line, empty content and hostile literal HTML."],
  CodeBlock: ["harness setup mismatch", "The populated default source was reused for read-only and empty variants at a different wrap width. Match content, variant and available width."],
  DiffViewer: ["harness setup mismatch", "The populated 1242px prompt comparison was reused for narrower changed and empty content; phone has no read-only comparison surface."],
  DateRangeInput: ["harness setup mismatch", "The source calendar popup was compared with the whole native KST fieldset. Compare equivalent closed inputs; the native popup is an approved adaptation."],
  TimePeriodSelect: ["harness setup mismatch", "The selector measured the invisible native select instead of its painted closed-control wrapper."],
};
const cases = report.results.filter(row => row.status === "FAIL").map(row => {
  const cause = causes[row.component];
  assert.ok(cause, `Unclassified component: ${row.component}`);
  const productDifference = ["Combobox", "MultiSelect", "DateRangeInput", "TimePeriodSelect", "CodeBlock"].includes(row.component) ||
    row.component === "MarkdownViewer" && row.state === "literal-html" ||
    row.component === "DiffViewer" && (row.surface === "site" || row.state === "empty");
  return {
    component: row.component, state: row.state, theme: row.theme,
    surface: row.surface, width: row.width, cause: cause[0], explanation: cause[1],
    causes: productDifference ? [cause[0], "product difference"] : [cause[0]],
    differences: row.differences,
    productAudit: ["Combobox", "MultiSelect"].includes(row.component)
      ? "Product wrapper insets, disabled fill and error styling also require correction against equivalent InputControl."
      : row.component === "DateRangeInput"
        ? "Product native date typography/insets require correction against the pinned time field."
        : row.component === "CodeBlock" && row.state === "read-only"
          ? "Product copy toolbar differs from the pinned read-only corner action and must be corrected."
          : row.component === "MarkdownViewer" && row.state === "literal-html"
            ? "Actual MIT text rendering confirms raw HTML is escaped plain flow, not two padded paragraphs."
            : row.component === "DiffViewer" && row.state === "empty"
              ? "Actual MIT source returns a plain No changes message, not an empty comparison card."
              : row.component === "DiffViewer" && row.surface === "site"
                ? "Legacy .diff-lines border adds two pixels inside the new Card; remove that duplicate border."
                : row.component === "TimePeriodSelect"
                  ? "The closed native wrapper requires source 4px/8px insets, contrast border and 12px dropdown viewport."
                  : row.component === "CodeBlock"
                    ? "Copy wrapper incorrectly receives caption padding, growing the toolbar beyond its 32/44px adaptation."
                    : "Re-evaluate strict fields after equal-content/equal-geometry reference setup; no mismatch is waived.",
  };
});
assert.equal(cases.length, 152);
assert.equal(new Set(cases.map(row => [row.component, row.state, row.theme, row.surface, row.width].join("/"))).size, 152);
const counts = Object.fromEntries(Object.keys(causes).map(component =>
  [component, cases.filter(row => row.component === component).length]));
await writeFile(output, JSON.stringify({
  source: input, sourceTotal: report.results.length, failures: cases.length,
  policy: "Classification is diagnostic, not a parity waiver. Every original case remains required.",
  counts, causes: {
    "harness setup mismatch": cases.filter(row => row.causes.includes("harness setup mismatch")).length,
    "product difference": cases.filter(row => row.causes.includes("product difference")).length,
  }, cases,
}, null, 2));
console.log(`P1_CLASSIFICATION ${cases.length}/152 classified; ${JSON.stringify(counts)}`);
