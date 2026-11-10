/** Owner geometry is normative, even when a Demo and product share the wrong size. */
export function shellMetric({ source, actual, field, context }) {
  const controls = ["BUTTON", "INPUT", "SELECT", "SUMMARY", "A"];
  const owner = field === "height" && controls.includes(actual.tag);
  const target = context.coarse || context.viewport[0] <= 768 ? 44 : 32;
  let origin = owner ? "owner-override" : "measured-source";
  let expected = owner ? target
    : field === "height" || field === "width" ? source.box[field] : source.styles[field];
  let value = field === "height" || field === "width" ? actual.box[field] : actual.styles[field];
  if(field==="height"&&context.part==="surface"){
    switch(context.family){
      case "Topbar":
        expected=Math.max(source.box.height,target+Number.parseFloat(source.styles.borderBottomWidth));
        origin="owner-override";break;
      case "Breadcrumb":expected=target;origin="owner-override";break;
      case "Tabs":case "Tabs-underline":
        expected=target+["paddingTop","paddingBottom","borderTopWidth","borderBottomWidth"]
          .reduce((sum,key)=>sum+Number.parseFloat(source.styles[key]),0);
        origin="owner-override";break;
      case "PageHeader":expected=source.box.height+target-32;origin="owner-override";break;
      case "CommandPalette":{
        const parts=context.reference.parts;
        const capped=parts.list?.scrollHeight>parts.list?.box.height;
        expected=source.box.height+target-parts.input.box.height+
          (parts.option&&!capped?(parts.list?.optionCount??1)*(target-parts.option.box.height):0);
        origin="owner-override";break;
      }
    }
  }
  if(context.family==="CommandPalette"&&context.part==="list"&&field==="height"&&context.reference.parts.option){
    expected=source.box.height+(source.scrollHeight>source.box.height?0:
      (source.optionCount??1)*(target-context.reference.parts.option.box.height));origin="owner-override";
  }
  if(context.family==="CommandPalette"&&context.part==="input"&&field==="paddingRight"){
    expected=`${target+8}px`;origin="owner-override";
  }
  const commandInput=context.family==="CommandPalette"&&context.part==="input";
  const commandOption=context.family==="CommandOption"||(context.family==="CommandPalette"&&["option","selected"].includes(context.part));
  if((commandInput||commandOption)&&(field==="paddingTop"||field==="paddingBottom")){
    const inset=(target-Number.parseFloat(source.styles.lineHeight))/2;
    expected=`${Number((commandInput?Math.min(Number.parseFloat(source.styles[field]),inset):inset).toFixed(3))}px`;
    origin="owner-override";
  }
  if(field==="borderTopColor" && source.styles.borderTopWidth==="0px" && actual.styles.borderTopWidth==="0px"){
    expected="not-painted";value="not-painted";
  }
  if(["borderBottomColor","borderBottomStyle"].includes(field) && source.styles.borderBottomWidth==="0px" && actual.styles.borderBottomWidth==="0px"){
    expected="not-painted";value="not-painted";
  }
  return { field, source:field === "height" || field === "width" ? source.box[field] : source.styles[field],
    expected, actual:value, origin,
    pass:typeof expected === "number" ? Math.abs(expected-value) <= (owner || (field==="height"&&context.family==="Topbar") ? 0 : 1) : expected === value };
}
