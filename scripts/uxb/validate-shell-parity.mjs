import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { shellMetric } from "./shell-metrics.mjs";

export function validateShell(records) {
  const checks=[], missing=[];
  const fields=["height","fontFamily","fontSize","lineHeight","fontWeight","paddingTop","paddingRight",
    "paddingBottom","paddingLeft","gap","color","backgroundColor","borderRadius","borderTopWidth","borderTopColor"];
  for(const actual of records.filter(row=>row.kind==="product")) {
    const matches=row=>row.family===actual.family && row.state===actual.state && row.theme===actual.theme;
    const source=records.find(row=>row.kind==="demo"&&matches(row)) ??
      records.find(row=>row.kind==="mit"&&row.actualPinnedComponent===true&&matches(row));
    const id=`${actual.app}/${actual.theme}/${actual.family}/${actual.state}`;
    if(!source){missing.push(id);continue;}
    const add=(part,a,b)=>{
      if(!a||!b){missing.push(`${id}/${part}`);return;}
      for(const field of fields)checks.push({id,part,...shellMetric({source:a,actual:b,field,context:actual})});
    };
    add("surface",source.surface,actual.surface);
    for(const part of Object.keys(source.parts))add(part,source.parts[part],actual.parts[part]);
  }
  return {status:checks.every(row=>row.pass)&&missing.length===0?"PASS":"FAIL",
    checks:checks.length,passed:checks.filter(row=>row.pass).length,failed:checks.filter(row=>!row.pass),
    missing,policy:"Owner 32px mouse / 44px coarse or <=768px is enforced before Demo dimensions; no masks or pixel tolerance changes."};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const root=resolve(process.argv[2]);
  const result=validateShell(JSON.parse(await readFile(`${root}/captures.json`,"utf8")));
  await writeFile(`${root}/style-validation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,checks:result.checks,passed:result.passed,failed:result.failed.length,missing:result.missing.length}));
  process.exitCode=result.status==="PASS"?0:1;
}
