import assert from "node:assert/strict";
import test from "node:test";
import { act, byTag, FakeEvent, h, loadViews, mount } from "./helpers/t10-dom.mjs";
import { shellMetric } from "../../scripts/uxb/shell-metrics.mjs";
import { applyViewport } from "../../scripts/uxb/viewport.mjs";
import { sidebarContext } from "../../scripts/uxb/shell-context.mjs";

const { Tabs, Breadcrumb, Topbar } = await loadViews(`
  export { Tabs } from "./local/dashboard/foundation/shell/tabs.ts";
  export { Breadcrumb, Topbar } from "./local/dashboard/foundation/shell/navigation.tsx";
`);
const tabs = [
  { id:"table",label:"Table",content:"rows" },
  { id:"disabled",label:"Unavailable",content:"missing",disabled:true },
  { id:"chart",label:"Chart",content:"bars" },
];
test("automatic tabs skip unavailable panels while preserving hidden panel identity", async t => {
  // Given
  const { container, dom } = await mount(t,Tabs,{id:"mode",label:"Display",tabs});
  const buttons=byTag(container,"button"), panels=byTag(container,"section");
  buttons[0].focus();
  // When
  await act(()=>buttons[0].dispatchEvent(new FakeEvent("keydown",{key:"ArrowRight"})));
  // Then
  assert.equal(dom.activeElement,buttons[2]);
  assert.deepEqual(buttons.map(b=>b.getAttribute("tabindex")),["-1","-1","0"]);
  assert.deepEqual(panels.map(p=>p.hidden),[true,true,false]);
  assert.equal(byTag(container,"section")[0],panels[0]);
  assert.equal(buttons[2].getAttribute("aria-controls"),panels[2].id);
});
test("manual tab movement changes focus without committing selection", async t => {
  // Given
  const { container,dom }=await mount(t,Tabs,{id:"manual",label:"Display",tabs,activation:"manual"});
  const buttons=byTag(container,"button");
  // When
  await act(()=>buttons[0].dispatchEvent(new FakeEvent("keydown",{key:"End"})));
  // Then
  assert.equal(dom.activeElement,buttons[2]);
  assert.deepEqual(buttons.map(b=>b.getAttribute("aria-selected")),["true","false","false"]);
  assert.deepEqual(byTag(container,"section").map(p=>p.hidden),[false,true,true]);
});
test("controlled tabs notify their owner without replacing the owner's value", async t => {
  // Given
  const changed=[];
  const { container }=await mount(t,Tabs,{id:"controlled",label:"Display",tabs,value:"table",onChange:id=>changed.push(id)});
  // When
  await act(()=>byTag(container,"button")[2].click());
  // Then
  assert.deepEqual(changed,["chart"]);
  assert.deepEqual(byTag(container,"section").map(p=>p.hidden),[false,true,true]);
});
test("breadcrumb exposes one current location instead of a redundant destination link", async t => {
  // Given
  const items=[{label:"Root",href:"/"},{label:"Current",href:"/current/"}];
  // When
  const { container }=await mount(t,Breadcrumb,{items});
  // Then
  assert.equal(byTag(container,"ol").length,1);
  assert.equal(byTag(container,"a").length,1);
  assert.equal(byTag(container,"span").at(-1).getAttribute("aria-current"),"page");
});
test("touch metrics reject upstream-sized controls even when source and product agree", () => {
  // Given
  const context={coarse:true,viewport:[1440,900]}, source={tag:"BUTTON",box:{height:32}};
  // When
  const result=shellMetric({source,actual:source,field:"height",context});
  // Then
  assert.equal(result.pass,false);
  assert.equal(result.expected,44);
  assert.equal(result.origin,"owner-override");
});
test("desktop metrics accept the owner target instead of upstream's smaller geometry", () => {
  // Given
  const source={tag:"BUTTON",box:{height:24}},actual={tag:"BUTTON",box:{height:32}};
  // When
  const result=shellMetric({source,actual,field:"height",context:{coarse:false,viewport:[1440,900]}});
  // Then
  assert.equal(result.pass,true);
  assert.equal(result.source,24);
  assert.equal(result.expected,32);
});
test("touch track metrics reject unchanged upstream height around undersized tabs",()=>{
  // Given
  const source={tag:"DIV",box:{height:28},styles:{paddingTop:"2px",paddingBottom:"2px",borderTopWidth:"0px",borderBottomWidth:"0px"}};
  // When
  const result=shellMetric({source,actual:source,field:"height",context:{family:"Tabs",part:"surface",coarse:true,viewport:[1440,900]}});
  // Then
  assert.equal(result.pass,false);assert.equal(result.expected,48);
});
test("command option metrics enforce the touch inset instead of upstream padding",()=>{
  // Given
  const source={tag:"DIV",styles:{lineHeight:"20px",paddingTop:"6px"}};
  // When
  const result=shellMetric({source,actual:source,field:"paddingTop",context:{family:"CommandOption",coarse:true,viewport:[1440,900]}});
  // Then
  assert.equal(result.pass,false);assert.equal(result.expected,"12px");
});
test("a configured phone viewport survives navigation's cached-size restoration",async()=>{
  // Given: model the observed Omowright navigation contract, not a timer.
  let cached={width:1440,height:900},observed={...cached};
  const page={
    async _sendToTarget(method,value){if(method==="Emulation.setDeviceMetricsOverride")observed={width:value.width,height:value.height};},
    setCachedViewportSize(value){cached=value;},
    navigate(){observed={...cached};},
  };
  await applyViewport(page,{width:390,height:844,mobile:true,coarse:true});
  // When
  page.navigate();
  // Then
  assert.deepEqual(observed,{width:390,height:844});
});
test("topbar keeps a native header landmark with caller content and actions",async t=>{
  const {container}=await mount(t,Topbar,{children:"Location",actions:h("button",{type:"button"},"Go")});
  const header=byTag(container,"header")[0];
  assert.equal(byTag(container,"header").length,1);
  assert.ok(header.textContent.includes("Location"));
  assert.equal(byTag(header,"button")[0].textContent,"Go");
});
test("sidebar fixture derives its bounded parent from source context, not component height",()=>{
  const source={viewport:[1440,900],parent:{position:"fixed",box:{top:29,bottom:900,height:871}}};
  assert.equal(sidebarContext(source).height,"calc(100dvh - 29px)");
  assert.equal(sidebarContext(source).alignItems,"stretch");
  assert.throws(()=>sidebarContext({...source,viewport:[390,844]}),RangeError);
  const short={tag:"ASIDE",box:{height:156}},reference={tag:"DIV",box:{height:871}};
  assert.equal(shellMetric({source:reference,actual:short,field:"height",
    context:{family:"Sidebar",part:"surface",viewport:[1440,900],coarse:false}}).pass,false);
});
test("topbar parity still rejects paint applied to the chrome row",()=>{
  const source={tag:"DIV",styles:{backgroundColor:"rgba(0, 0, 0, 0)"}};
  const actual={tag:"DIV",styles:{backgroundColor:"rgb(255, 255, 255)"}};
  assert.equal(shellMetric({source,actual,field:"backgroundColor",
    context:{family:"Topbar",part:"surface",viewport:[1440,900],coarse:false}}).pass,false);
});
test("touch topbar fits the owner control plus its measured divider exactly",()=>{
  const source={tag:"DIV",box:{height:44},styles:{borderBottomWidth:"1px"}};
  const context={family:"Topbar",part:"surface",viewport:[390,844],coarse:true};
  assert.equal(shellMetric({source,actual:source,field:"height",context}).pass,false);
  assert.equal(shellMetric({source,actual:{...source,box:{height:45}},field:"height",context}).pass,true);
});
