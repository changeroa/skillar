import {readFile,writeFile,mkdir} from "node:fs/promises";
import {pathToFileURL,fileURLToPath} from "node:url";
import {widgetStates} from "./widget-states.mjs";
import {observePaint,paintChannels,availablePaint,comparePaint,plotPaintFields,iconPaintFields,chartPaintCoverage} from "./widget-paint.mjs";
import {ready,arm,signal,press} from "./trusted-keys.mjs";
import {focusWidgetControl} from "./widget-visual-guards.mjs";
import {captureCrop} from "./image-diff.mjs";
const inventoryPath=fileURLToPath(new URL("./widget-paint-inventory.json",import.meta.url));

export async function runWidgetPaintQA(out,{bootstrap=false}={}){
 const root=`${out}/paint-review`;await mkdir(root,{recursive:true});
 const sources=JSON.parse(await readFile(`${root}/sources.json`,"utf8")).sources;
 const inventory=bootstrap?{}:JSON.parse(await readFile(inventoryPath,"utf8"));
 const {loadOmowright}=await import(pathToFileURL(process.env.OMOWRIGHT_HELPER).href);
 const {omowright}=await loadOmowright(),browser=await omowright.connect("http://127.0.0.1:9333"),tabs=omowright.createAgentTabs(browser);
 const {page}=await tabs.create("about:blank",{viewport:{width:1440,height:900}});
 const cases=[],assertions=[],mutations=[],draft={};let summary;
 const check=(context,rows)=>assertions.push(...rows.map(r=>({...context,...r})));
 async function move(selector){
  const p=selector?await page.evaluate(s=>{const n=document.querySelector(s);n.scrollIntoView({block:"center"});const shape=n.querySelector("rect,circle")??n,b=shape.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}},selector):{x:0,y:0};
  await page._sendToTarget("Input.dispatchMouseEvent",{type:"mouseMoved",...p});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 }
 try{
  for(const app of ["site","local"])for(const theme of ["light","dark"]){
   await page.goto(`http://127.0.0.1:${app==="site"?5183:5184}/__gallery.html?widgets=1&theme=${theme}`,{waitUntil:"domcontentloaded"});await ready(page,'[data-specimen="Callout-info-top"]');
   await page.evaluate(({observe,channels})=>{
    globalThis.__observePaint=(0,eval)(`(${observe})`);globalThis.__paintChannels=(0,eval)(`(${channels})`);
    const s=document.createElement("style");s.textContent="*,*::before,*::after{transition:none!important;animation:none!important}";document.head.append(s);
   },{observe:observePaint.toString(),channels:paintChannels.toString()});
   for(const name of widgetStates){
    const selector=`[data-specimen="${name}"]`;
    const iconCount=await page.locator(`${selector} svg[viewBox="0 0 24 24"]`).count();
    const point=await page.locator(`${selector} [data-chart-point]`).count();
    const fallback=await page.locator(`${selector} .lf-chart__data`).count();
    const views=[{state:"default"},...Array.from({length:iconCount},(_,icon)=>[{state:"hover",icon},{state:"focus",icon}]).flat(),...(point?[{state:"hover",point:true},{state:"focus",point:true},{state:"series-hidden",hiddenPose:"default"},{state:"series-hidden-hover",hiddenPose:"hover"},{state:"series-hidden-focus",hiddenPose:"focus"}]:[]),...(fallback?[{state:"table-expanded"}]:[])];
    for(const view of views){
     let nativeFocus=null;
     await page.evaluate(()=>document.activeElement?.blur());await move(null);
     if(view.icon!==undefined){
      const iconSelector=await page.evaluate(({selector,icon})=>{const n=document.querySelector(selector).querySelectorAll('svg[viewBox="0 0 24 24"]')[icon];n.dataset.paintIcon=String(icon);return`${selector} [data-paint-icon="${icon}"]`},{selector,icon:view.icon});
      if(view.state==="hover")await move(iconSelector);
      else{
       const button=await page.evaluate(({s,index})=>{const n=document.querySelector(s).closest("button,a,summary");if(!n)return null;n.dataset.paintIconTrigger=String(index);return`${s.split(" [data-paint-icon")[0]} [data-paint-icon-trigger="${index}"]`},{s:iconSelector,index:view.icon});
       if(button){await focusWidgetControl(page,button);nativeFocus=button;}
      }
     }else if(view.hiddenPose){
      const target=`${selector} .lf-chart__legend button`;
      await arm(page,{kind:"attribute",selector:target,attribute:"aria-pressed",value:"false",key:"__paintToggleSignal"});
      await focusWidgetControl(page,target);await press(page,"Enter");await signal(page,"__paintToggleSignal");
      if(view.hiddenPose==="focus")nativeFocus=target;
      else{await page.evaluate(()=>document.activeElement?.blur());await move(view.hiddenPose==="hover"?target:null);}
     }else if(view.state==="table-expanded"){
      const target=`${selector} .lf-chart__data > summary`;
      await arm(page,{kind:"present",selector:`${selector} .lf-chart__data[open]`,key:"__paintDisclosureSignal"});
      await focusWidgetControl(page,target);await press(page,"Enter");await signal(page,"__paintDisclosureSignal");
     }else if(view.point){
      const target=`${selector} [data-chart-point]`;
      await arm(page,{kind:"present",selector:`${selector} [role="tooltip"]`,key:"__paintTooltipSignal"});
      if(view.state==="focus")await focusWidgetControl(page,target);else await move(target);
      await signal(page,"__paintTooltipSignal");
     }
     const context={app,theme,name,...view,focusApplicable:view.state==="focus"||view.hiddenPose==="focus"?Boolean(nativeFocus||view.point):undefined};
     const data=await page.evaluate(selector=>{
      const root=document.querySelector(selector),observe=globalThis.__observePaint;
      const heading=root.querySelector(":scope > h2");
      const elements=[root,...root.querySelectorAll("*")].filter(n=>!n.closest("defs")&&n!==heading&&!heading?.contains(n));
      const path=node=>{if(node===root)return ":scope";const parts=[];for(let n=node;n!==root;n=n.parentElement){const siblings=[...n.parentElement.children].filter(s=>s.localName===n.localName);parts.unshift(`${n.localName}:nth-of-type(${siblings.indexOf(n)+1})`)}return`:scope > ${parts.join(" > ")}`};
      const nodes=elements.map(n=>{const paint=observe(n);return{selector:path(n),paint,channels:globalThis.__paintChannels(n,paint)}});
      const plots=[...root.querySelectorAll(".lf-chart__scroll > svg :is(g,line,rect,path,circle,text)")].filter(n=>!n.closest("defs")&&!n.closest("[hidden]")).map(n=>{
       let kind=n.localName==="line"&&n.closest(".lf-chart__grid")?"grid":n.classList.contains("lf-chart__axis")?"axis":n.localName==="path"?"line":n.localName==="circle"?"point":n.localName==="rect"?"bar":n.localName==="text"?"tick":n.classList.contains("lf-chart__series")?"series":null;
       if(kind==="series"&&n.children.length===0&&!n.hasAttribute("data-chart-point")&&!n.hasAttribute("role"))kind="null-slot";
       const group=n.closest(".lf-chart__series"),ordinal=group?Number(group.getAttribute("class").match(/lf-chart__series--(\d+)/)[1]):null;
       return {selector:path(n),kind,ordinal,paint:observe(n),active:n.closest("[data-chart-point]")?.matches(":hover,:focus-visible")??false,hover:n.closest("[data-chart-point]")?.matches(":hover")??false,chartKind:root.querySelector(".lf-chart")?.dataset.kind,histogram:Boolean(root.querySelector('[data-kind="histogram"]'))};
      }).filter(n=>n.kind);
      const icons=[...root.querySelectorAll('svg[viewBox="0 0 24 24"]')].map((n,index)=>({index,selector:path(n),paint:observe(n),button:n.closest("button")?observe(n.closest("button")):null,glyph:n.closest(".lf-chart__legend-item")?.dataset.hidden==="true"?"Minus":"Check",buttonVariant:n.closest("button")?.className.includes("--ghost")?"ghost":n.closest("button")?.className.includes("--primary")?"primary":"outline",inAlert:Boolean(n.closest(".lf-alert__icon")),inEmpty:Boolean(n.closest(".lf-empty__icon"))}));
      const swatches=[...root.querySelectorAll(".lf-chart__swatch")].map(n=>({selector:path(n),ordinal:Number(n.parentElement.className.match(/lf-chart__series--(\d+)/)[1]),paint:observe(n),histogram:Boolean(root.querySelector('[data-kind="histogram"]'))}));
      const hiddenSeries=[...root.querySelectorAll(".lf-chart__series[hidden]")].map(n=>({selector:path(n),paint:observe(n)}));
      return {nodes,plots,icons,swatches,hiddenSeries,svg:Boolean(root.querySelector(".lf-chart__scroll > svg")),activeSeries:root.querySelectorAll('.lf-chart__legend button[aria-pressed="true"]').length};
     },selector);
     const key=`${name}/${view.state}/${view.icon??(view.point?"point":"root")}`;
     if(["Bar","Line","Histogram"].includes(name)){
      check(context,chartPaintCoverage(data,name.toLowerCase()));
     }
     for(const n of data.hiddenSeries)check({...context,part:n.selector,kind:"hidden-series"},[{field:"deselected-series-has-no-paint",actual:n.paint.visible,expected:false,pass:!n.paint.visible}]);
     const expected=bootstrap?undefined:inventory.templates[inventory.cases[key]];
     if(bootstrap&&!draft[key])draft[key]=data.nodes.filter(n=>n.paint.visible&&n.channels.length).map(n=>({selector:n.selector,channels:n.channels,text:Boolean(n.paint.text),...(n.channels.includes("pseudo:marker")?{marker:n.paint.listStyleType}:{})}));
     if(!bootstrap){
      check(context,[{field:"inventory",pass:Array.isArray(expected)&&(expected.length>0||name==="Metric-strip-empty")}]);
      if(name==="Metric-strip-empty")check(context,[{field:"empty-strip-has-no-painted-parts",pass:data.nodes.every(n=>!n.paint.visible||n.channels.length===0)}]);
      for(const required of expected??[]){
       const n=data.nodes.find(n=>n.selector===required.selector);
       check(context,[{field:`paint:${required.selector}`,pass:Boolean(n)&&availablePaint(n.paint,required)}]);
      }
     }
     for(const n of data.plots){
      const refs=sources[theme].charts;
      const barRef=n.histogram?(n.hover?"hoverHistogram":"histogram"):n.hover?"hoverBar":n.active?"focusBar":"bar";
      let reference=structuredClone(refs[n.kind==="bar"?barRef:n.kind==="tick"?(n.histogram?"histogramTick":n.chartKind==="bar"?"barTick":"tick"):n.kind==="null-slot"?"series":n.kind]);
      if(!reference)throw Error(`Missing real source kind ${n.kind}`);
      if(n.ordinal){
       if(n.kind==="bar"&&!n.histogram)reference.fill=refs.palette[n.ordinal].fill;
       if(n.kind==="line")reference.stroke=refs.palette[n.ordinal].stroke;
       if(n.kind==="point"&&n.active){
        reference=structuredClone(view.state==="focus"?refs.focusPoint:refs.activePoint);
        if(Array.isArray(reference.fill)&&reference.fill[3]>0)reference.fill=refs.palette[n.ordinal].stroke;
       }
      }
      const comparisons=comparePaint(n.paint,reference,n.kind==="point"?[...plotPaintFields,"radius"]:n.kind==="tick"?[...plotPaintFields,"fontSize"]:plotPaintFields);
      if(n.kind==="null-slot")comparisons[0]={field:"unmeasured-slot-has-no-paint",actual:n.paint.visible,expected:false,pass:n.paint.visible===false};
      check({...context,part:n.selector,kind:n.kind},comparisons);
     }
     for(const n of data.swatches){
      const ref=sources[theme].charts;
      check({...context,part:n.selector,kind:"swatch"},[{field:"backgroundColor",pass:JSON.stringify(n.paint.backgroundColor)===JSON.stringify(n.histogram?ref.histogram.fill:ref.palette[n.ordinal].stroke)}]);
     }
     for(const icon of data.icons){
      let ref,key;
      if(name.startsWith("Callout"))key=`Callout-${name.includes("warning")?"warning":"info"}-${view.icon===icon.index?view.state:"default"}`;
      else if(icon.inAlert)key=`Alert-${name.includes("primary")?"primary":name.includes("destructive")?"destructive":name.includes("warning")?"warning":name.includes("success")?"success":"default"}-${name.endsWith("-sm")?"sm":"default"}${view.icon===icon.index&&view.state==="hover"?"-hover":""}`;
      else if(icon.inEmpty)key="Empty";
      else if(name.startsWith("Alert"))key=`Alert-dismiss-${view.icon===icon.index?view.state:"default"}`;
      else key=`${icon.glyph}-${icon.buttonVariant}-${icon.index===0&&view.hiddenPose?view.hiddenPose:view.icon===icon.index?view.state:"default"}`;
      ref=sources[theme].icons[key];if(!ref)throw Error(`Missing icon reference ${key}`);
      check({...context,part:icon.selector,kind:"icon",reference:key},comparePaint(icon.paint,ref.glyph??ref,iconPaintFields));
      if(icon.button){
       check({...context,part:icon.selector,kind:"icon-control"},[{field:"required-control-reference",pass:Boolean(ref.button)}]);
       if(ref.button)check({...context,part:icon.selector,kind:"icon-control"},comparePaint(icon.button,ref.button,["color","backgroundColor"]));
      }
     }
     // Reversible removal of EVERY audited painted part, not a sampled root.
     const required=bootstrap?draft[key]:expected??[];
     const probes=await page.evaluate(({selector,required})=>{
      const root=document.querySelector(selector),observe=globalThis.__observePaint;
      return required.map(item=>{
       const n=item.selector===":scope"?root:root.querySelector(item.selector);
       if(!n)return {selector:item.selector,missing:true};
       const original=n.getAttribute("style");
       try{n.style.setProperty("visibility","hidden","important");return{selector:item.selector,actual:observe(n)};}
       finally{if(original===null)n.removeAttribute("style");else n.setAttribute("style",original)}
      });
     },{selector,required});
     for(const probe of probes){
      const entry=required.find(n=>n.selector===probe.selector);
      mutations.push({...context,kind:"remove-painted-part",selector:probe.selector,pass:!probe.missing&&!availablePaint(probe.actual,entry)});
     }
     const channelProbes=await page.evaluate(({selector,required})=>{
      const root=document.querySelector(selector),observe=globalThis.__observePaint,results=[];
      for(const item of required)for(const channel of item.channels){
       const n=item.selector===":scope"?root:root.querySelector(item.selector);
       if(!n){results.push({selector:item.selector,channel,missing:true});continue;}
       const original=n.getAttribute("style"),oldProbe=n.getAttribute("data-widget-paint-probe");let sheet;
       try{
        if(channel.startsWith("pseudo:")){
         n.setAttribute("data-widget-paint-probe","active");
         sheet=document.createElement("style");sheet.textContent=`[data-widget-paint-probe="active"]::${channel.slice(7)}{content:none!important;color:transparent!important;background:none!important}`;document.head.append(sheet);
        }else{
         const property=channel==="borderColor"?"border-top-width":/^border(Right|Bottom|Left)Color$/.test(channel)?channel.replace("Color","Width").replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`):channel.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`);
         const value=channel==="borderColor"||/^border(Right|Bottom|Left)Color$/.test(channel)?"0px":["boxShadow","backgroundImage"].includes(channel)?"none":"transparent";
         n.style.setProperty(property,value,"important");
        }
        results.push({selector:item.selector,channel,actual:observe(n)});
       }finally{
        sheet?.remove();if(original===null)n.removeAttribute("style");else n.setAttribute("style",original);
        if(oldProbe===null)n.removeAttribute("data-widget-paint-probe");else n.setAttribute("data-widget-paint-probe",oldProbe);
       }
      }
      return results;
     },{selector,required});
     for(const probe of channelProbes)mutations.push({...context,kind:`remove-channel:${probe.channel}`,selector:probe.selector,pass:!probe.missing&&!availablePaint(probe.actual,required.find(n=>n.selector===probe.selector))});
     const paintProbes=await page.evaluate(({selector,plots,icons})=>{
      const root=document.querySelector(selector),observe=globalThis.__observePaint,results=[];
      for(const n of plots.filter(n=>["bar","line","grid","axis","tick"].includes(n.kind)||n.kind==="point"&&Array.isArray(n.paint.fill)&&n.paint.fill[3]>0)){
       const element=root.querySelector(n.selector),field=["bar","point","tick"].includes(n.kind)?"fill":"stroke",original=element.getAttribute("style");
       try{element.style.setProperty(field,"transparent","important");results.push({selector:n.selector,kind:n.kind,field,actual:observe(element),reference:n.paint})}
       finally{if(original===null)element.removeAttribute("style");else element.setAttribute("style",original)}
      }
      for(const n of icons){
       const element=root.querySelector(n.selector),original=element.getAttribute("style");
       try{element.style.setProperty("display","none","important");results.push({selector:n.selector,kind:"hide-icon",actual:observe(element),reference:n.paint})}
       finally{if(original===null)element.removeAttribute("style");else element.setAttribute("style",original)}
      }
      return results;
     },{selector,plots:data.plots,icons:data.icons});
     for(const probe of paintProbes)mutations.push({...context,kind:probe.kind,selector:probe.selector,field:probe.field,pass:comparePaint(probe.actual,probe.reference,probe.kind==="hide-icon"?iconPaintFields:plotPaintFields).some(a=>!a.pass)});
     {
      await page.evaluate(async selector=>{const n=document.querySelector(selector+" > :not(h2)");n.scrollIntoView({block:"start"});window.scrollBy(0,-8);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))},selector);
      if(view.state==="hover"||view.hiddenPose==="hover"){
       const point=await page.evaluate(({selector,icon,hiddenPose})=>{const root=document.querySelector(selector),n=hiddenPose?root.querySelector(".lf-chart__legend button"):icon!==undefined?root.querySelectorAll('svg[viewBox="0 0 24 24"]')[icon]:root.querySelector("[data-chart-point] rect,[data-chart-point] circle");const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}},{selector,icon:view.icon,hiddenPose:view.hiddenPose});
       await page._sendToTarget("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
       await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      }
      const crop=await captureCrop(page,`${selector} > :not(h2)`,{align:true});
      await writeFile(`${root}/${app}-${theme}-${name}-${view.state}-${view.icon??(view.point?"point":"root")}.png`,Buffer.from(crop.data,"base64"));
     }
     cases.push({...context,key,plots:data.plots,icons:data.icons,paintedParts:required.length});
     if(view.hiddenPose){await focusWidgetControl(page,`${selector} .lf-chart__legend button`);await press(page,"Enter");}
     if(view.state==="table-expanded"){await focusWidgetControl(page,`${selector} .lf-chart__data > summary`);await press(page,"Enter");}
    }
   }
   console.log("WIDGET_PAINT_CONTEXT",app,theme,cases.length);
  }
  if(!bootstrap)for(const app of ["site","local"])for(const theme of ["light","dark"]){
   const keys=cases.filter(c=>c.app===app&&c.theme===theme).map(c=>c.key),required=Object.keys(inventory.cases);
   check({app,theme},[{field:"complete-paint-case-membership",pass:keys.length===required.length&&new Set(keys).size===required.length&&required.every(key=>keys.includes(key))}]);
  }
 }finally{
  if(bootstrap)await writeFile(`${root}/inventory-draft.json`,JSON.stringify(draft,null,2));
  summary={cases:cases.length,assertions:assertions.length,failures:assertions.filter(a=>!a.pass).length,mutations:mutations.length,mutationFailures:mutations.filter(a=>!a.pass).length,bootstrap};
  await writeFile(`${root}/results.json`,JSON.stringify({summary,cases,assertions,mutations},null,2));
  await tabs.closeAll();await browser.close();
 }
 console.log("WIDGET_PAINT",JSON.stringify(summary));
 if(summary.failures||summary.mutationFailures)throw Error("Widget paint gate failed");
 return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runWidgetPaintQA(process.argv[2],{bootstrap:process.argv.includes("--bootstrap")});
