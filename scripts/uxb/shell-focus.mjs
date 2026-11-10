export const focusFields = ["focusVisible","visible","outlineWidth","outlineStyle","outlineColor","outlineOffset","boxShadow"];
export const shellStates = {
  Sidebar:["default","collapsed"], NavGroup:["default"],
  NavItem:["default","hover","focus-visible","collapsed-focus-visible","disabled"],
  Topbar:["default","focus-visible"], PageHeader:["default","focus-visible"],
  Breadcrumb:["default","focus-visible"], Tabs:["default"], "Tabs-underline":["default"],
  Tab:["default","hover","focus-visible","disabled"], "Tab-underline":["default","hover","focus-visible","disabled"],
  CommandPalette:["default","empty-query","grouped","selected","filtered","hover","empty","disabled-only","focus-close"],
  CommandOption:["disabled"],
};
export function focusParts(family) {
  switch(family) {
    case "NavItem":case "Tab":case "Tab-underline":return {surface:"outline"};
    case "Breadcrumb":case "Topbar":return {link:"outline"};
    case "PageHeader":return {action:"button"};
    case "CommandPalette":return {input:"field",close:"close",option:"virtual",selected:"virtual"};
    case "CommandOption":return {surface:"virtual"};
    default:return {};
  }
}
/** Real source paint is retained; owner accessibility and tokens are normative. */
export function focusMetrics({source,actual,kind,context,part}) {
  const focused=kind!=="virtual" && (context.family==="CommandPalette"
    ? part===(context.state==="focus-close"?"close":"input")
    : context.state==="focus-visible"||context.state==="collapsed-focus-visible");
  const ring=context.theme==="dark"?"rgb(145, 136, 221)":
    context.family==="NavItem"?"rgb(59, 130, 246)":"rgb(161, 161, 170)";
  const background=context.theme==="dark"?"rgb(15, 15, 15)":"rgb(255, 255, 255)";
  const accent=context.theme==="dark"?ring:"rgb(78, 70, 229)";
  const expected=focused?{
    focusVisible:true,visible:true,outlineWidth:["button","close"].includes(kind)?"0px":"2px",
    outlineStyle:["button","close"].includes(kind)?"none":"solid",
    outlineColor:kind==="outline"?ring:"rgba(0, 0, 0, 0)",
    outlineOffset:kind==="outline"?"-2px":["button","close"].includes(kind)?"0px":"2px",
    boxShadow:kind==="outline"?"none":kind==="button"?`${ring} 0px 0px 0px 2px inset`:
      `${background} 0px 0px 0px 2px, ${kind==="close"?ring:accent} 0px 0px 0px 4px`,
  }:{focusVisible:false,visible:true,outlineWidth:"0px",outlineStyle:"none",
    outlineColor:"rgba(0, 0, 0, 0)",outlineOffset:"0px",boxShadow:"none"};
  return [{field:"source-focusVisible",source:source.focusVisible,expected:focused,actual:source.focusVisible,
    origin:"measured-source-focus",pass:source.focusVisible===focused},...focusFields.map(field=>{
    const raw=["focusVisible","visible"].includes(field)?actual[field]:actual.styles[field];
    // Width/colour/offset of outline-style:none do not paint; style is still asserted.
    const value=expected.outlineStyle==="none"&&actual.styles.outlineStyle==="none"&&
      ["outlineWidth","outlineColor","outlineOffset"].includes(field)?expected[field]:raw;
    return {field,source:["focusVisible","visible"].includes(field)?source[field]:source.styles[field],
      expected:expected[field],actual:value,rawActual:raw,origin:"owner-visible-focus",pass:value===expected[field]};
  })];
}
