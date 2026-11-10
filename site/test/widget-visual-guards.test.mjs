import assert from "node:assert/strict";
import test from "node:test";
import { focusPaintEvidence, ownerControlHeight } from "../../scripts/uxb/widget-visual-guards.mjs";
import { assertWidgetStates, widgetStates } from "../../scripts/uxb/widget-states.mjs";

test("background offset shadows cannot replace contrasting focus paint",()=>{
  const width=40,height=28,box={left:8,right:32,top:8,bottom:20},dpr=1;
  const removed=new Uint8Array(width*height*4).fill(255),focused=removed.slice();
  for(let y=6;y<22;y++)for(let x=6;x<34;x++)if(x<8||x>=32||y<8||y>=20){
    const i=(y*width+x)*4;focused.set([30,30,30,255],i);
  }
  const read=paint=>focusPaintEvidence({focused:paint,removed,width,height,box,dpr,focusVisible:true});
  assert.equal(read(focused).pass,true);
  assert.equal(read(removed).pass,false,"white shadow on white has no contrasting painted pixels");
  const faint=focused.map((value,index)=>index%4===3?255:value===30?245:value);
  assert.equal(read(faint).pass,false,"a changed pixel is insufficient without contrast");
});

test("shared wrong upstream and product heights cannot overrule owner sizes",()=>{
  for(const context of [{width:1440,coarse:false},{width:390,coarse:true},{width:390,coarse:false},{width:1440,coarse:true},{width:768,coarse:false},{width:769,coarse:false}]){
    const upstream=60,product=60;
    assert.equal(upstream,product);
    assert.equal(ownerControlHeight(product,context).pass,false);
    const expected=context.coarse||context.width<=768?44:32;
    assert.equal(ownerControlHeight(expected,context).pass,true);
  }
});

test("state counts cannot conceal an omitted conditional control",()=>{
  assert.doesNotThrow(()=>assertWidgetStates(widgetStates));
  const changed=widgetStates.map(state=>state==="Callout-links"?"unexpected-state":state);
  assert.equal(changed.length,widgetStates.length);
  assert.throws(()=>assertWidgetStates(changed));
});
