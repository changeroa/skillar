import assert from "node:assert/strict";
import test from "node:test";
import { focusMetrics } from "../../scripts/uxb/shell-focus.mjs";
import { validateShell } from "../../scripts/uxb/validate-shell-parity.mjs";

// Real light Demo NavItem focus measurement; the owner replaces its shadow with a 2px outline.
const source={tag:"A",box:{height:32},focusVisible:true,visible:true,styles:{
  outlineWidth:"1px",outlineStyle:"none",outlineColor:"rgb(0, 95, 204)",outlineOffset:"1px",
  boxShadow:"rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(59, 130, 246) 0px 0px 0px 2px, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
}};
const actual={tag:"A",box:{height:32},focusVisible:true,visible:true,styles:{
  outlineWidth:"2px",outlineStyle:"solid",outlineColor:"rgb(59, 130, 246)",outlineOffset:"-2px",boxShadow:"none",
}};
const context={family:"NavItem",state:"focus-visible",theme:"light",viewport:[1440,900],coarse:false};
test("parity cannot pass by omitting the full matrix or an entire app",()=>{
  assert.equal(validateShell([]).status,"FAIL");
  const result=validateShell([{kind:"product",...context,app:"site",surface:actual,parts:{}}]);
  assert.ok(result.missing.includes("local-phone/light/CommandPalette/default"));
});
test("measured Demo focus is normalized to the owner-visible outline",()=>{
  const result=focusMetrics({source,actual,context,kind:"outline",part:"surface"});
  assert.equal(result.length,8);
  assert.ok(result.every(row=>row.pass));
  assert.equal(result.find(row=>row.field==="outlineStyle").source,"none");
  assert.equal(result.find(row=>row.field==="outlineStyle").expected,"solid");
});
test("removing all recorded rings is rejected by the validator itself",()=>{
  const pair=[
    {kind:"demo",family:"NavItem",state:"focus-visible",theme:"light",surface:source,parts:{}},
    {kind:"product",...context,app:"site",surface:actual,parts:{}},
  ];
  assert.equal(validateShell(pair).failed.filter(r=>r.origin==="owner-visible-focus").length,0);
  const mutated=structuredClone(pair);
  Object.assign(mutated[1].surface.styles,{outlineWidth:"0px",outlineStyle:"none",boxShadow:"none"});
  mutated[1].surface.focusVisible=false;
  const failed=validateShell(mutated).failed;
  assert.ok(failed.some(row=>row.field==="focusVisible"&&!row.pass));
  assert.ok(failed.some(row=>row.field==="outlineWidth"&&!row.pass));
});
test("an upstream missing ring does not waive the owner's visible-focus requirement",()=>{
  const missing={...source,focusVisible:false,styles:{...source.styles,boxShadow:"none"}};
  const result=focusMetrics({source:missing,actual:{...actual,focusVisible:false},context,kind:"outline",part:"surface"});
  assert.equal(result.find(row=>row.field==="focusVisible").pass,false);
});
test("each painted input focus property rejects an independent mutation",()=>{
  const field={...actual,styles:{outlineWidth:"2px",outlineStyle:"solid",outlineColor:"rgba(0, 0, 0, 0)",
    outlineOffset:"2px",boxShadow:"rgb(255, 255, 255) 0px 0px 0px 2px, rgb(78, 70, 229) 0px 0px 0px 4px"}};
  const inputContext={...context,family:"CommandPalette",state:"default"};
  const mutations={focusVisible:false,outlineWidth:"0px",outlineStyle:"none",outlineColor:"rgb(255, 0, 0)",outlineOffset:"0px",boxShadow:"none"};
  for(const [key,value] of Object.entries(mutations)){
    const changed=structuredClone(field);
    if(key==="focusVisible")changed.focusVisible=value;else changed.styles[key]=value;
    assert.equal(focusMetrics({source,actual:changed,context:inputContext,kind:"field",part:"input"})
      .find(row=>row.field===key).pass,false,key);
  }
});
