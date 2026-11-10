import { ready,press } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";

/** Measure the actual page cascade, never an isolated control recipe. */
export async function measureShellTargets(page,config){
  const results=[];
  const paths=[
    ["hosted","/dashboard/"],["hosted","/skills/"],["hosted","/connections/"],["hosted","/login/"],
    ["hosted","/dashboard/#/sessions"],["local","/#/sessions"],["local","/#/dashboard"],
    ["local","/#/flow"],["local","/#/workspaces"],["local","/#/heatmap"],
  ];
  for(const [width,coarse] of [[1440,false],[390,true],[1440,true],[390,false],[1023,false]])for(const theme of ["light","dark"]){
    const profile={width,height:width===390?844:900,mobile:width===390,coarse};
    await applyViewport(page,profile);
    await page._sendToTarget("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:theme}]});
    for(const [app,path] of paths){
      await page.goto(config[app]+path,{waitUntil:"domcontentloaded"});
      await applyViewport(page,profile);
      await ready(page,app==="hosted"?"body.app-shell [data-command-mount]":".lf-topbar");
      if(app==="hosted")await ready(page,".app-account form button");
      if(app==="local"&&width<=1023)await ready(page,'[aria-controls="pe-source-drawer"]');
      const collect=async state=>results.push(await page.evaluate(({app,path,width,coarse,theme,state})=>{
        const scope=app==="hosted"?".app-topbar,.app-navigation,.app-drawer":".pe-sidebar,.lf-topbar,.pe-mobile-nav,#pe-source-drawer";
        const controls=[...new Set([...document.querySelectorAll(scope)].flatMap(root=>[...root.querySelectorAll('a[href],button,input:not([type="hidden"]),select,summary')]))]
          .filter(e=>e.checkVisibility());
        const target=matchMedia("(pointer:coarse)").matches||innerWidth<=768?44:32;
        return{app,path,width,coarse,actualCoarse:matchMedia("(pointer:coarse)").matches,theme,state,target,
          controls:controls.map(e=>{const r=e.getBoundingClientRect();return{
            tag:e.tagName,id:e.id,role:e.getAttribute("role"),name:e.getAttribute("aria-label")??e.innerText?.slice(0,60),
            height:r.height,width:r.width,pass:r.height===target,
          };})};
      },{app,path,width,coarse,theme,state}));
      await collect("default");
      const source=app==="hosted"?".app-breadcrumb summary":null;
      if(source && await page.evaluate(s=>document.querySelector(s)?.checkVisibility()??false,source)){
        await page.evaluate(s=>document.querySelector(s).focus(),source);await press(page,"Enter");
        await collect("source-picker");await press(page,"Enter");
      }
      const menu=app==="hosted"?"#app-menu":'.lf-topbar [aria-controls="pe-source-drawer"]';
      if(await page.evaluate(s=>document.querySelector(s)?.checkVisibility()??false,menu)){
        await page.evaluate(s=>document.querySelector(s).focus(),menu);await press(page,"Enter");
        await ready(page,app==="hosted"?"#app-drawer[open]":"#pe-source-drawer[open]");
        await collect("drawer");await press(page,"Escape");
      }
    }
  }
  return{cases:results,controls:results.reduce((n,r)=>n+r.controls.length,0),
    failures:results.flatMap(row=>row.controls.filter(c=>!c.pass).map(control=>({app:row.app,path:row.path,profile:[row.width,row.coarse],theme:row.theme,state:row.state,target:row.target,control})))};
}
