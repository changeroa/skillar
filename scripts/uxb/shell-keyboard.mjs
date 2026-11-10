import assert from "node:assert/strict";
import { press,arm,signal,ready } from "./trusted-keys.mjs";
import { runPaletteInteractions } from "../../site/test/command-palette.browser.mjs";
import { applyViewport } from "./viewport.mjs";
import { createTrustedInput } from "../../site/test/helpers/trusted-input.mjs";
import { mountHostedEmbed } from "./mount-hosted-embed.mjs";
import { verifyShellLifecycle } from "./shell-lifecycle.mjs";

export async function verifyShellKeyboard(page,config) {
  const cases=[];
  for(const width of [1440,390])for(const theme of ["light","dark"]){
    const profile={width,height:width===390?844:900,mobile:width===390,coarse:width===390};
    await applyViewport(page,profile);
    await page._sendToTarget("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:theme}]});
    const interactions=await runPaletteInteractions(page,`${config.hosted}/dashboard/`,profile);
    await applyViewport(page,profile);
    await ready(page,width===390?"#app-drawer #app-navigation":"header #app-navigation");
    if(width===390){
      await page.evaluate(()=>document.querySelector("#app-menu").focus());
      await arm(page,{kind:"attribute",selector:"#app-drawer",attribute:"open",value:""});
      await press(page,"Enter");await signal(page);
    }
    await press(page,"Tab");
    await page.evaluate(()=>document.querySelector('#app-navigation a').focus());
    const nativeNavFocus=await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);
      return{visible:e.matches(":focus-visible"),width:s.outlineWidth,color:s.outlineColor};});
    assert.equal(nativeNavFocus.visible,true);assert.equal(nativeNavFocus.width,"2px");
    assert.equal(nativeNavFocus.color,theme==="dark"?"rgb(145, 136, 221)":"rgb(59, 130, 246)");
    cases.push({app:"hosted",width,theme,interactions,nativeNavFocus});
    if(width===390){await arm(page,{kind:"focus",selector:"#app-menu"});await press(page,"Escape");await signal(page);}
    await page.goto(`${config.hosted}/dashboard/#/sessions`,{waitUntil:"domcontentloaded"});
    await applyViewport(page,profile);await ready(page,"[data-command-mount]");
    const embedded=await mountHostedEmbed(page);
    assert.ok(embedded.tabHeights.every(height=>height===(width===390?44:32)),JSON.stringify(embedded));
    await arm(page,{kind:"focus",selector:"#app-command-input"});
    await shortcut(page);await signal(page);
    const ownership=await page.evaluate(()=>({dialogs:document.querySelectorAll("dialog[open]").length,
      mounts:document.querySelectorAll("[data-command-mount]").length,local:document.querySelectorAll("#pe-command").length,
      active:document.querySelector("#app-command-input").getAttribute("aria-activedescendant"),
      selected:document.querySelector('#app-command [aria-selected="true"]')?.id}));
    assert.equal(ownership.dialogs,1);assert.equal(ownership.mounts,1);assert.equal(ownership.local,0);
    assert.equal(ownership.active,ownership.selected);
    await arm(page,{kind:"focus",selector:"#app-jump"});await press(page,"Escape");await signal(page);
    cases.push({app:"hosted-embed",width,theme,embedded,ownership});
    for(const [app,base] of [["site",config.galleryHosted],["local",config.galleryLocal]]){
      await page.goto(`${base}/__gallery.html?theme=${theme}`,{waitUntil:"domcontentloaded"});
      await applyViewport(page,profile);
      await ready(page,'[data-component="Tabs"]');
      const paint=await page.evaluate(()=>{const row=document.querySelector(".lf-topbar"),header=row.closest("header");
        return{row:getComputedStyle(row).backgroundColor,header:getComputedStyle(header).backgroundColor,
          height:row.getBoundingClientRect().height,border:getComputedStyle(row).borderBottomWidth};});
      assert.equal(paint.row,"rgba(0, 0, 0, 0)");
      assert.equal(paint.header,theme==="dark"?"rgb(15, 15, 15)":"rgb(255, 255, 255)");
      assert.equal(paint.height,Math.max(44,(width===390?44:32)+1));assert.equal(paint.border,"1px");
      const auto="#gallery-tabs-tab-table",chart="#gallery-tabs-tab-chart";
      await page.evaluate(selector=>document.querySelector(selector).focus(),auto);
      await arm(page,{kind:"attribute",selector:chart,attribute:"aria-selected",value:"true"});
      await press(page,"ArrowRight");await signal(page);
      const state=await page.evaluate(()=>({
        focus:document.activeElement.id,
        stops:[...document.querySelectorAll('#gallery-tabs-tab-table,#gallery-tabs-tab-chart,#gallery-tabs-tab-graph')].map(e=>e.tabIndex),
        panels:[...document.querySelectorAll('[id^="gallery-tabs-panel-"]')].map(e=>({id:e.id,hidden:e.hidden})),
      }));
      assert.equal(state.focus,"gallery-tabs-tab-chart");assert.deepEqual(state.stops,[-1,0,-1]);
      assert.deepEqual(state.panels.map(p=>p.hidden),[true,false,true]);
      await arm(page,{kind:"attribute",selector:auto,attribute:"aria-selected",value:"true"});
      await press(page,"ArrowRight");await signal(page);
      const manual="#gallery-underline-tab-table";
      await page.evaluate(selector=>document.querySelector(selector).focus(),manual);
      await arm(page,{kind:"focus",selector:"#gallery-underline-tab-chart"});
      await press(page,"End");await signal(page);
      assert.equal(await page.evaluate(()=>document.querySelector("#gallery-underline-tab-table").getAttribute("aria-selected")),"true");
      await arm(page,{kind:"attribute",selector:"#gallery-underline-tab-chart",attribute:"aria-selected",value:"true"});
      await press(page,"Enter");await signal(page);
      cases.push({app,width,theme,tabs:"automatic skip/wrap, manual focus/Enter, one stop, hidden panels",state,trusted:true});
    }
    await page.goto(`${config.local}/#/sessions`,{waitUntil:"domcontentloaded"});
    await applyViewport(page,profile);
    await ready(page,".pe-jump button");
    await page.evaluate(()=>document.querySelector(".pe-jump button").focus());
    await arm(page,{kind:"focus",selector:"#pe-command-input"});
    await shortcut(page);await signal(page);
    await arm(page,{kind:"attribute",selector:"#pe-command-input",attribute:"aria-activedescendant",value:"pe-command-option-dashboard"});
    await press(page,"ArrowDown");await signal(page);
    const palette=await page.evaluate(()=>({
      renderers:document.querySelectorAll(".lf-dialog--command[open]").length,
      active:document.querySelector("#pe-command-input").getAttribute("aria-activedescendant"),
      selected:[...document.querySelectorAll('#pe-command [aria-selected="true"]')].map(e=>({id:e.id,paint:getComputedStyle(e).backgroundColor})),
    }));
    assert.equal(palette.renderers,1);assert.equal(palette.selected.length,1);
    assert.equal(palette.selected[0].id,palette.active);assert.notEqual(palette.selected[0].paint,"rgba(0, 0, 0, 0)");
    await arm(page,{kind:"focus",selector:".pe-jump button"});
    await press(page,"Escape");await signal(page);
    assert.equal(await page.evaluate(()=>document.querySelectorAll(".lf-dialog--command[open]").length),0);
    if(width===390){
      await ready(page,'[aria-controls="pe-source-drawer"]');
      await page.evaluate(()=>document.querySelector('[aria-controls="pe-source-drawer"]').focus());
      await arm(page,{kind:"attribute",selector:"#pe-source-drawer",attribute:"open",value:""});
      await press(page,"Enter");await signal(page);
      await arm(page,{kind:"focus",selector:"#pe-command-input"});await shortcut(page);await signal(page);
      assert.equal(await page.evaluate(()=>document.querySelectorAll("dialog[open]").length),1);
      await press(page,"Escape");
    }
    cases.push({app:"local",width,theme,palette,trusted:true,modalReplacement:width===390});
  }
  cases.push({app:"hosted-native-lifecycle",...await verifyShellLifecycle(page,config.hosted)});
  return cases;
}

async function shortcut(page){
  const input=await createTrustedInput(page);
  try{
    await input.press({key:"k",code:"KeyK",windowsVirtualKeyCode:75,modifiers:2});
  }finally{await input.dispose();}
}
