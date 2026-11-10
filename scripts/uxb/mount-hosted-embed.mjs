import assert from "node:assert/strict";
import { arm,ready,signal } from "./trusted-keys.mjs";

async function click(page,selector){
  const point=await page.evaluate(selector=>{
    const node=document.querySelector(selector);node.scrollIntoView({block:"center",behavior:"instant"});
    const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
  },selector);
  for(const type of ["mousePressed","mouseReleased"])
    await page._sendToTarget("Input.dispatchMouseEvent",{type,...point,button:"left",clickCount:1});
}
/** Exercise the real source-picker handler and LocalViews mount, never inject a substitute. */
export async function mountHostedEmbed(page){
  await ready(page,".dash-source-picker summary");
  await arm(page,{kind:"attribute",selector:".dash-source-picker",attribute:"open",value:""});
  await click(page,".dash-source-picker summary");await signal(page);
  const source='.dash-source-picker .source-list button[aria-pressed="false"]';
  await ready(page,source);
  await arm(page,{kind:"attribute",selector:".pe-sessions-region",attribute:"class",value:"pe-sessions-region"});
  await click(page,source);await signal(page);
  await ready(page,'.dash-embed .pe-sessions-region [data-session-id]');
  await page.evaluate(()=>document.querySelector(".local-top").scrollIntoView({block:"start",behavior:"instant"}));
  const result=await page.evaluate(()=>({
    mounted:!!document.querySelector('.dash-embed [role="tabpanel"] .pe-sessions-region'),
    selectedSources:document.querySelectorAll('.dash-source-picker .source[aria-current="true"]').length,
    tabs:document.querySelectorAll('.local-tabs [role="tab"]').length,
    tabHeights:[...document.querySelectorAll('.local-tabs [role="tab"]')].map(e=>e.getBoundingClientRect().height),
    sessionRows:document.querySelectorAll('.dash-embed .pe-sessions-region [data-session-id]').length,
    standalonePaletteTriggers:document.querySelectorAll("#pe-command-jump").length,
  }));
  assert.equal(result.mounted,true);assert.equal(result.selectedSources,1);
  assert.ok(result.tabs>0);assert.equal(result.standalonePaletteTriggers,0);
  return result;
}
