import assert from "node:assert/strict";
import { arm,press,ready,signal } from "./trusted-keys.mjs";
import { createTrustedInput } from "../../site/test/helpers/trusted-input.mjs";

export async function verifyShellLifecycle(page,base){
  const storage="uxb-native-lifecycle",notRestored=[];
  const offCache=page.cdp.on("Page.backForwardCacheNotUsed",event=>notRestored.push(event));
  const {identifier}=await page._sendToTarget("Page.addScriptToEvaluateOnNewDocument",{source:
    '('+((key)=>{
      window.__uxbNativeShown=false;
      const handlers=["pagehide","pageshow"].map(type=>{
        const handler=event=>{
          window.__uxbNativeShown=type==="pageshow";
          const events=JSON.parse(sessionStorage.getItem(key)??"[]");
          events.push({type,path:location.pathname,persisted:event.persisted,trusted:event.isTrusted});
          sessionStorage.setItem(key,JSON.stringify(events));
        };
        addEventListener(type,handler);return [type,handler];
      });
      window.__uxbTransitionCleanup=()=>{for(const [type,handler] of handlers)removeEventListener(type,handler);};
    }).toString()+')('+JSON.stringify(storage)+');'});
  const shown=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    if(window.__uxbNativeShown){resolve();return;}
    const timer=setTimeout(()=>{removeEventListener("pageshow",check);reject(Error("Native pageshow missing"));},15000);
    function check(){clearTimeout(timer);resolve();}
    addEventListener("pageshow",check,{once:true});
  }));
  const listeners=async()=>{
    const result=await page._sendToTarget("Runtime.evaluate",{expression:'getEventListeners(window).keydown?.length ?? 0',
      includeCommandLineAPI:true,returnByValue:true});
    return result.result.value;
  };
  try{
    await page.goto(base+"/dashboard/?lifecycle=1",{waitUntil:"domcontentloaded"});
    await ready(page,"[data-command-mount]");await shown();
    const before=await listeners();assert.equal(before,1);
    await page.evaluate(key=>sessionStorage.setItem(key,"[]"),storage);
    await page.goto(base+"/skills/",{waitUntil:"domcontentloaded"});await ready(page,"h1");
    await shown();await page.goBack();await shown();await ready(page,"[data-command-mount]");
    const events=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)??"[]"),storage);
    const hide=events.find(event=>event.type==="pagehide"&&event.path==="/dashboard/");
    const show=events.findLast(event=>event.type==="pageshow"&&event.path==="/dashboard/");
    assert.ok(hide);assert.ok(show);assert.ok(events.every(event=>event.trusted));
    const after=await listeners();assert.equal(after,1);
    const input=await createTrustedInput(page);
    try{
      await arm(page,{kind:"focus",selector:"#app-command-input"});
      await input.press({key:"k",code:"KeyK",windowsVirtualKeyCode:75,modifiers:4});await signal(page);
      assert.equal(await page.evaluate(()=>document.querySelectorAll("dialog[open]").length),1);
      await arm(page,{kind:"focus",selector:"#app-jump"});await press(page,"Escape");await signal(page);
    }finally{await input.dispose();}
    return{events,notRestored,listenersBefore:before,listenersAfter:after,probeListenersAfter:await listeners(),cacheRestored:hide.persisted&&show.persisted,
      status:hide.persisted&&show.persisted?"PASS":"NATIVE_LIFECYCLE_PASS_BFCACHE_NOT_RESTORED"};
  }finally{
    offCache();await page.evaluate(key=>{window.__uxbTransitionCleanup?.();sessionStorage.removeItem(key);},storage);
    await page._sendToTarget("Page.removeScriptToEvaluateOnNewDocument",{identifier});
  }
}
