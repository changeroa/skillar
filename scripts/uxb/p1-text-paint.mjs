/** Every channel that paints a text run, including inherited ancestor opacity. */
export const P1_TEXT_FIELDS = Object.freeze([
  "fontSize", "lineHeight", "fontWeight", "fontStyle", "fontFamily",
  "color", "backgroundColor", "opacity", "visibility",
]);

export function compareTextPaint(reference, actual) {
  const failures = [], source = reference ?? [], product = actual ?? [];
  const expectedText = source.map(run => run.text).join("");
  const receivedText = product.map(run => run.text).join("");
  if (expectedText !== receivedText)
    return [{ field: "textPaint.content", expected: expectedText, actual: receivedText }];
  let sourcePosition = 0, productPosition = 0, sourceOffset = 0, productOffset = 0;
  while (sourcePosition < source.length && productPosition < product.length) {
    const expected = source[sourcePosition], received = product[productPosition];
    for (const field of P1_TEXT_FIELDS) {
      if (expected.values[field] === undefined || received.values[field] === undefined ||
        expected.values[field] !== received.values[field])
        failures.push({ field: `textPaint.${productPosition}.${field}`,
          expected: expected.values[field], actual: received.values[field] });
    }
    const length = Math.min(expected.text.length - sourceOffset, received.text.length - productOffset);
    sourceOffset += length; productOffset += length;
    if (sourceOffset === expected.text.length) { sourcePosition++; sourceOffset = 0; }
    if (productOffset === received.text.length) { productPosition++; productOffset = 0; }
  }
  return failures;
}
