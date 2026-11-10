import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {comparePaint,availablePaint,plotPaintFields,iconPaintFields,chartPaintCoverage} from "../../scripts/uxb/widget-paint.mjs";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/widget-paint-source.json",import.meta.url),"utf8"));
test("an empty or incomplete plot selector cannot certify a populated chart",()=>{
 const plots=["grid","axis","tick","series","line","point"].map(kind=>({kind}));
 assert.ok(chartPaintCoverage({svg:true,plots,activeSeries:2},"line").every(a=>a.pass));
 assert.ok(chartPaintCoverage({svg:true,plots:[],activeSeries:2},"line").some(a=>!a.pass));
 for(const removed of plots)assert.ok(chartPaintCoverage({svg:true,plots:plots.filter(p=>p!==removed),activeSeries:2},"line").some(a=>!a.pass));
});
for(const [theme,source]of Object.entries(fixture.themes)){
 for(const [kind,field]of [["bar","fill"],["histogram","fill"],["line","stroke"],["grid","stroke"],["point","fill"]]){
  test(`${theme} ${kind} loses measured paint when ${field} becomes transparent`,()=>{
   const actual=structuredClone(source[kind]);
   assert.ok(comparePaint(actual,source[kind]).every(a=>a.pass));
   actual[field]=[0,0,0,0];
   assert.ok(comparePaint(actual,source[kind]).some(a=>!a.pass));
  });
 }
 for(const [field,value]of [["strokeWidth","0px"],["strokeOpacity","0"],["fillOpacity","0"],["opacity","0"],["effectiveOpacity",0],["dash","7px, 3px"]]){
  test(`${theme} plot measurement observes ${field}`,()=>{
   const actual={...source.line,[field]:value};
   assert.ok(comparePaint(actual,source.line,plotPaintFields).some(a=>!a.pass));
  });
 }
 test(`${theme} icon hiding and geometry replacement fail source comparison`,()=>{
  const actual=structuredClone(source.icon);
  assert.ok(comparePaint(actual,source.icon,iconPaintFields).every(a=>a.pass));
  actual.visible=false;
  assert.ok(comparePaint(actual,source.icon,iconPaintFields).some(a=>!a.pass));
  actual.visible=true;actual.shape[0].attributes.d="M0 0h24";
  assert.ok(comparePaint(actual,source.icon,iconPaintFields).some(a=>!a.pass));
 });
 test(`${theme} a hidden child glyph stroke cannot retain its source paint`,()=>{
  const actual=structuredClone(source.icon);actual.shape[0].paint.opacity="0";
  assert.ok(comparePaint(actual,source.icon,iconPaintFields).some(a=>!a.pass));
  const stroke=structuredClone(source.icon);stroke.shape[0].paint.strokeOpacity="0";
  assert.ok(comparePaint(stroke,source.icon,iconPaintFields).some(a=>!a.pass));
 });
 test(`${theme} every declared paint channel and visibility are required`,()=>{
  const actual={...source.bar,visible:true,backgroundColor:[255,255,255,255],color:[39,39,42,255],text:"value"};
  const expected={channels:["fill","backgroundColor","color"],text:true};
  assert.ok(availablePaint(actual,expected));
  for(const field of expected.channels)assert.equal(availablePaint({...actual,[field]:[0,0,0,0]},expected),false);
  assert.equal(availablePaint({...actual,visible:false},expected),false);
  assert.equal(availablePaint({...actual,text:""},expected),false);
 });
 test(`${theme} zero stroke width and opacity remove an audited stroke`,()=>{
  const actual={...source.line,visible:true};
  assert.ok(availablePaint(actual,{channels:["stroke"]}));
  assert.equal(availablePaint({...actual,strokeWidth:"0px"},{channels:["stroke"]}),false);
  assert.equal(availablePaint({...actual,strokeOpacity:"0"},{channels:["stroke"]}),false);
  assert.equal(availablePaint({...source.bar,fillOpacity:"0"},{channels:["fill"]}),false);
 });
 test(`${theme} independent borders shadows and disclosure markers cannot disappear`,()=>{
  const actual={visible:true,borderBottomColor:[39,39,42,255],borderBottomWidth:"1px",shadowPainted:true,
   display:"list-item",listStyleType:"disclosure-closed",pseudo:{marker:{display:"inline",visibility:"visible",opacity:"1",content:"normal",color:[39,39,42,255]}}};
  const expected={channels:["borderBottomColor","boxShadow","pseudo:marker"],marker:"disclosure-closed"};
  assert.ok(availablePaint(actual,expected));
  assert.equal(availablePaint({...actual,borderBottomWidth:"0px"},expected),false);
  assert.equal(availablePaint({...actual,shadowPainted:false},expected),false);
  assert.equal(availablePaint({...actual,listStyleType:"none"},expected),false);
  assert.equal(availablePaint({...actual,pseudo:{marker:{...actual.pseudo.marker,color:[0,0,0,0]}}},expected),false);
 });
}
