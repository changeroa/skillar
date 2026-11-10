import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { validateShell } from "./validate-shell-parity.mjs";
const root=process.argv[2];
const records=JSON.parse(await readFile(`${root}/captures.json`,"utf8"));
assert.equal(validateShell(records).status,"PASS","Baseline must pass before mutation");
const cases=[];
for(const mutation of ["all-focus-paint","focus-visible","outline","shadow","underline-border"]){
  const copy=structuredClone(records);
  for(const row of copy.filter(r=>r.kind==="product")){
    for(const part of [row.surface,...Object.values(row.parts)]){
      if(mutation==="all-focus-paint"||mutation==="outline"){part.styles.outlineWidth="0px";part.styles.outlineStyle="none";}
      if(mutation==="all-focus-paint"||mutation==="shadow")part.styles.boxShadow="none";
      if(mutation==="all-focus-paint"||mutation==="focus-visible")part.focusVisible=false;
      if(mutation==="underline-border"&&row.family==="Tab-underline")part.styles.borderBottomWidth="0px";
    }
  }
  const result=validateShell(copy);
  assert.equal(result.status,"FAIL",`${mutation} must be caught`);
  assert.ok(result.failed.length>0);
  cases.push({mutation,status:result.status,failed:result.failed.length,missing:result.missing.length});
}
await writeFile(`${root}/focus-mutations.json`,JSON.stringify({status:"PASS",cases},null,2));
console.log(JSON.stringify({status:"PASS",mutations:cases.length,cases}));
