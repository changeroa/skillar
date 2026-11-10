/** Owner geometry is normative, even when a Demo and product share the wrong size. */
export function shellMetric({ source, actual, field, context }) {
  const controls = ["BUTTON", "INPUT", "SELECT", "SUMMARY", "A"];
  const owner = field === "height" && controls.includes(actual.tag);
  let expected = owner ? (context.coarse || context.viewport[0] <= 768 ? 44 : 32)
    : field === "height" || field === "width" ? source.box[field] : source.styles[field];
  let value = field === "height" || field === "width" ? actual.box[field] : actual.styles[field];
  if(field==="borderTopColor" && source.styles.borderTopWidth==="0px" && actual.styles.borderTopWidth==="0px"){
    expected="not-painted";value="not-painted";
  }
  return { field, source:field === "height" || field === "width" ? source.box[field] : source.styles[field],
    expected, actual:value, origin:owner ? "owner-override" : "measured-source",
    pass:typeof expected === "number" ? Math.abs(expected-value) <= (owner ? 0 : 1) : expected === value };
}
