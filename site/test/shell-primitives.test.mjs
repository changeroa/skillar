import assert from "node:assert/strict";
import test from "node:test";
import { act, byTag, FakeEvent, loadViews, mount } from "./helpers/t10-dom.mjs";
import { shellMetric } from "../../scripts/uxb/shell-metrics.mjs";

const { Tabs, Breadcrumb } = await loadViews(`
  export { Tabs } from "./local/dashboard/foundation/shell/tabs.ts";
  export { Breadcrumb } from "./local/dashboard/foundation/shell/navigation.tsx";
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
