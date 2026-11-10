import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { shellMetric } from "./shell-metrics.mjs";
import { focusFields, focusMetrics, focusParts, shellStates } from "./shell-focus.mjs";

export function validateShell(records) {
  const checks=[], missing=[];
  const fields=["height","fontFamily","fontSize","lineHeight","fontWeight","paddingTop","paddingRight",
    "paddingBottom","paddingLeft","gap","color","backgroundColor","borderRadius","borderTopWidth","borderTopColor",
    "borderBottomWidth","borderBottomColor","borderBottomStyle"];
  const products=records.filter(row=>row.kind==="product");
  const expectedCases=Object.values(shellStates).reduce((sum,states)=>sum+states.length,0)*8;
  checks.push({id:"matrix",field:"matrixCases",expected:expectedCases,actual:products.length,
    origin:"required-matrix",pass:products.length===expectedCases});
  for(const app of ["site","site-phone","local","local-phone"])for(const theme of ["light","dark"])
    for(const [family,states] of Object.entries(shellStates))for(const state of states)
      if(!products.some(r=>r.app===app&&r.theme===theme&&r.family===family&&r.state===state))
        missing.push(`${app}/${theme}/${family}/${state}`);
  for(const actual of records.filter(row=>row.kind==="product")) {
    const matches=row=>row.family===actual.family && row.state===actual.state && row.theme===actual.theme;
    const source=records.find(row=>row.kind==="demo"&&matches(row)) ??
      records.find(row=>row.kind==="mit"&&row.actualPinnedComponent===true&&matches(row));
    const id=`${actual.app}/${actual.theme}/${actual.family}/${actual.state}`;
    if(!source){missing.push(id);continue;}
    const add=(part,a,b)=>{
      if(!a||!b){missing.push(`${id}/${part}`);return;}
      if(part!=="close")for(const [side,node] of [["source",a],["product",b]])
        checks.push({id,part,field:`${side}-visible`,expected:true,actual:node.visible,
          origin:"visible-measured-part",pass:node.visible===true});
      if(!["link","action","close"].includes(part))
        for(const field of fields)checks.push({id,part,...shellMetric({source:a,actual:b,field,context:{...actual,part,reference:source}})});
    };
    add("surface",source.surface,actual.surface);
    for(const part of Object.keys(source.parts))add(part,source.parts[part],actual.parts[part]);
    if(actual.family==="CommandPalette"){
      const query={default:"","empty-query":"","selected":"","focus-close":"",grouped:"e",
        filtered:"Tracing",hover:"Tracing",empty:"no-match-uxb-shell","disabled-only":"Langfuse Demo"}[actual.state];
      for(const [side,row] of [["source",source],["product",actual]])
        checks.push({id,part:"input",field:`${side}-query`,expected:query,actual:row.parts.input?.inputValue,
          origin:"shipped-state",pass:row.parts.input?.inputValue===query});
      if(!["empty","disabled-only"].includes(actual.state)){
        const selected=actual.parts.selected;
        checks.push({id,part:"selected",field:"activeDescendant",expected:selected?.elementId,
          actual:actual.parts.input?.activeDescendant,origin:"shipped-state",
          pass:!!selected&&selected.selected==="true"&&actual.parts.input.activeDescendant===selected.elementId});
      }else checks.push({id,part:"input",field:"activeDescendant",expected:null,
        actual:actual.parts.input?.activeDescendant,origin:"shipped-state",pass:actual.parts.input?.activeDescendant===null});
    }
    for(const [part,kind] of Object.entries(focusParts(actual.family))){
      const a=part==="surface"?source.surface:source.parts[part];
      const b=part==="surface"?actual.surface:actual.parts[part];
      if(actual.family==="CommandPalette"&&((["option","selected"].includes(part)&&actual.state==="empty")||
        (part==="selected"&&actual.state==="disabled-only")))continue;
      if(!a||!b){missing.push(`${id}/${part}/focus`);continue;}
      for(const field of focusFields)if((["focusVisible","visible"].includes(field)?a[field]:a.styles[field])===undefined)
        missing.push(`${id}/${part}/source-${field}`);
      checks.push(...focusMetrics({source:a,actual:b,kind,context:actual,part}).map(check=>({id,part,...check})));
      if(["link","action","close"].includes(part))
        checks.push({id,part,...shellMetric({source:a,actual:b,field:"height",context:{...actual,part,reference:source}})});
    }
  }
  return {status:checks.every(row=>row.pass)&&missing.length===0?"PASS":"FAIL",
    checks:checks.length,passed:checks.filter(row=>row.pass).length,failed:checks.filter(row=>!row.pass),
    missing,focusChecks:checks.filter(r=>r.origin==="owner-visible-focus").length,
    policy:"Owner 32/44px and visible 2px focus paint are enforced against measured Demo parts; no masks or pixel tolerance changes."};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const root=resolve(process.argv[2]);
  const result=validateShell(JSON.parse(await readFile(`${root}/captures.json`,"utf8")));
  await writeFile(`${root}/style-validation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,checks:result.checks,passed:result.passed,failed:result.failed.length,missing:result.missing.length}));
  process.exitCode=result.status==="PASS"?0:1;
}
