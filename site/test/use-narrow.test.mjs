import assert from "node:assert/strict";
import test from "node:test";
import { h,loadViews,mount } from "./helpers/t10-dom.mjs";

const { useNarrow }=await loadViews('export { useNarrow } from "./local/dashboard/components/use-narrow.ts";');
test("responsive mode catches a viewport change before the listener subscribes",async t=>{
  // Given: a real media-query change can occur between render and subscription.
  const previous=globalThis.matchMedia;
  const events=new EventTarget();
  const media={
    matches:false,
    addEventListener(name,listener){this.matches=true;events.addEventListener(name,listener);},
    removeEventListener(name,listener){events.removeEventListener(name,listener);},
  };
  globalThis.matchMedia=()=>media;
  t.after(()=>{globalThis.matchMedia=previous;});
  function Probe(){return h("output",{"data-mode":useNarrow()?"narrow":"wide"});}
  // When
  const { container }=await mount(t,Probe,{});
  // Then
  assert.equal(container.childNodes[0].getAttribute("data-mode"),"narrow");
});
