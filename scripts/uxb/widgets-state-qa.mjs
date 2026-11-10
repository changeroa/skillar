import { mkdir, readFile, writeFile } from "node:fs/promises";
import { captureCrop, diffImages } from "./image-diff.mjs";
import { ready, arm, signal, press } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";

const output=process.argv[2];
if(!output||!process.env.OMOWRIGHT_HELPER)throw new Error("Usage: OMOWRIGHT_HELPER=/path/omowright.mjs node scripts/uxb/widgets-state-qa.mjs evidence-directory");
const {loadOmowright}=await import(process.env.OMOWRIGHT_HELPER);
const source=JSON.parse(await readFile(`${output}/state-sources.json`,"utf8"));
const recorded=JSON.parse(await readFile(`${output}/real-sources.json`,"utf8"));
const references=[...recorded.filter(s=>s.id==="StatusMessage").map(s=>({...s,id:"StatusMessage-ERROR-compact"})),...source.records];
const frame=["paddingTop","paddingRight","paddingBottom","paddingLeft","borderRadius","borderTopWidth","borderTopColor","backgroundColor","color","boxShadow"];
const type=["fontSize","lineHeight","fontWeight","fontFamily","color"];
const rules=[];
const add=(selector,id,fields)=>rules.push({selector,id,fields});
function card(){
 add(".lf-card","Card",frame);
 add(".lf-card__header","Card-header",frame.slice(0,4));
 add(".lf-card__title","Card-title",[...type,"letterSpacing"]);
 add(".lf-card__description","Metric-note",type);
 add(".lf-card__content","Card-content",frame.slice(0,4));
 add(".lf-card__footer","Card-content",frame.slice(0,4));
}
function empty(intro=false){
 const id=intro?"Empty-intro":"Empty";
 add(".lf-empty",id,[...frame,"gap"]);
 add(".lf-empty__title",`${id}-title`,type);
 add(".lf-empty__description",`${id}-description`,type);
}
function alert(variant,size){
 const id=variant==="default"&&size==="default"?"Alert":`Alert-${variant}-${size}`;
 add(".lf-alert",id,[...frame,...type]);
 add(".lf-alert__title",`${id}-title`,[...type,"letterSpacing"]);
 add(".lf-alert__description",`${id}-description`,type);
}
function metric(){
 add(".lf-metric-strip","Card-content",["gap"]);
 add(".lf-metric__label","Card-title",["fontSize","lineHeight","fontFamily","color"]);
 add('.lf-metric__value[data-measured=true]',"Metric",type);
 add('.lf-metric__value[data-measured=false]',"Metric",type.filter(field=>field!=="color"));
 add('.lf-metric__value[data-measured=false]',"Metric-note",["color"]);
 add(".lf-metric__note","Metric-note",type);
}
function rulesFor(name){
 rules.length=0;
 if(name==="Card"||name.startsWith("Widget-")){
  card();
  if(name==="Widget-loading")add(".lf-skeleton > div","Skeleton",["backgroundColor","borderRadius"]);
  if(name==="Widget-empty")empty();
  if(name==="Widget-error")alert("destructive","default");
 }else if(name.startsWith("Metric"))metric();
 else if(["Bar","Line","Histogram"].includes(name)){
  add(".lf-chart__scroll > svg",name,frame);
  add(".lf-chart__label",`${name}-text`,["fontSize","fontWeight","fontFamily","fill"]);
  add("figcaption","Card-title",[...type,"letterSpacing"]);
 }else if(name.startsWith("Chart-")||name.endsWith("-empty")||name.endsWith("-unmeasured")||name==="Empty")empty();
 else if(name==="Empty-intro")empty(true);
 else if(name.startsWith("Alert-")){const [,variant,size]=name.split("-");alert(variant,size)}
 else if(name.startsWith("StatusMessage-"))add(".lf-status-message",name,[...frame,...type]);
 else if(name.startsWith("Callout-")){
  add(".lf-callout",name,frame);
  add(".lf-callout__description",`${name}-description`,["fontSize","lineHeight","gap","alignItems"]);
  add(".lf-callout__content",`${name}-content`,["gap","alignItems","flexDirection"]);
  add(".lf-callout__text p",`${name}-text`,type);
  add(".lf-message-actions button",`${name}-action`,[...type,"paddingLeft","paddingRight","borderRadius","borderTopWidth","borderTopColor","backgroundColor"]);
 }
 if(!rules.length)throw new Error(`No source mapping for ${name}`);
 return [...rules];
}
const {omowright}=await loadOmowright(),browser=await omowright.connect("http://127.0.0.1:9333"),tabs=omowright.createAgentTabs(browser);
const tab=await tabs.create("about:blank",{viewport:{width:1440,height:900}}),page=tab.page;
const cases=[],assertions=[],mutations=[];
await mkdir(`${output}/state-parity`,{recursive:true});
async function styles(selector,fields){
 return page.evaluate(({selector,fields})=>[...document.querySelectorAll(selector)].map(n=>{
  const s=getComputedStyle(n);return Object.fromEntries(fields.map(field=>[field,s[field]]));
 }),{selector,fields});
}
async function compare(reference,actual,field){
 let expected=reference.styles[field],value=actual[field],painted=true,reason;
 if(field.startsWith("padding")||["gap","alignItems","flexDirection","fontSize","lineHeight","fontWeight","fontFamily","letterSpacing","borderRadius","borderTopWidth"].includes(field))reason="geometry/typography";
 if(field==="borderTopColor"&&reference.styles.borderTopWidth==="0px"){painted=false;reason="zero-width border"}
 if(field==="backgroundColor"&&["transparent","rgba(0, 0, 0, 0)"].includes(expected)&&["transparent","rgba(0, 0, 0, 0)"].includes(value)){painted=false;reason="transparent background"}
 if(field==="boxShadow"){
  const visible=s=>s.split(/,\s*(?![^()]*\))/).filter(s=>!s.includes("rgba(0, 0, 0, 0)")).join(", ")||"none";
  expected=visible(expected);value=visible(value);
  if(expected==="none"&&value==="none"){painted=false;reason="no painted shadow"}
 }
 let pass=expected===value;
 if(!pass&&["color","fill","stroke","borderTopColor","backgroundColor"].includes(field)){
  pass=await page.evaluate(colors=>{
   const rgba=color=>{const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
    const c=canvas.getContext("2d",{willReadFrequently:true});c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data]};
   const [a,b]=colors.map(rgba);return a.every((n,index)=>n===b[index]);
  },[expected,value]);
 }
 if(!painted&&field==="borderTopColor")pass=true;
 return {field,reference:reference.styles[field],actual:actual[field],painted,reason,pass};
}
try{
 for(const [app,port]of [["site",5183],["local",5184]])for(const theme of ["light","dark"]){
  await page.goto(`http://127.0.0.1:${port}/__gallery.html?widgets=1&theme=${theme}`,{waitUntil:"domcontentloaded"});
  await applyViewport(page,{width:1440,height:900});await ready(page,"#gallery[data-ready=true]");
  await page.evaluate(async()=>{await document.fonts.ready});
  const names=await page.evaluate(()=>[...document.querySelectorAll("[data-specimen]")].map(n=>n.dataset.specimen));
  if(names.length!==39||new Set(names).size!==39)throw new Error(`Incomplete shipped state inventory: ${names.length}`);
  for(const name of names){
   for(const view of ["default",...(["Bar","Line","Histogram"].includes(name)?["hover","focus","series-hidden","data-expanded"]:[])]){
   const selector=`[data-specimen="${name}"]`,mapped=rulesFor(name),measurements=[];
   await page.evaluate(selector=>document.querySelector(selector).scrollIntoView({block:"center",behavior:"instant"}),selector);
   if(["Bar","Line","Histogram"].includes(name)){
    await page.evaluate(selector=>{document.activeElement?.blur();document.querySelector(`${selector} details`).open=false},selector);
    await page._sendToTarget("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});
    const legend=`${selector} .lf-chart__legend-item:last-child button`;
    if(await page.evaluate(selector=>document.querySelector(selector).getAttribute("aria-pressed")==="false",legend)){
     await arm(page,{kind:"attribute",selector:legend,attribute:"aria-pressed",value:"true"});
     await page.evaluate(selector=>document.querySelector(selector).click(),legend);await signal(page);
    }
    if(view==="focus"||view==="hover"){
     await arm(page,{kind:"attribute",selector:`${selector} [role=tooltip]`,attribute:"role",value:"tooltip"});
     const point=`${selector} [data-chart-point]`;
     if(view==="focus")await page.evaluate(selector=>document.querySelector(selector).focus(),point);else await page.locator(point).hover();
     await signal(page);mapped.push({selector:"[role=tooltip]",id:"Chart-tooltip",fields:[...frame,...type]});
    }else if(view==="series-hidden"){
     await arm(page,{kind:"attribute",selector:legend,attribute:"aria-pressed",value:"false"});
     await page.evaluate(selector=>document.querySelector(selector).click(),legend);await signal(page);
    }else if(view==="data-expanded"){
     await page.evaluate(selector=>document.querySelector(`${selector} summary`).focus(),selector);
     await arm(page,{kind:"attribute",selector:`${selector} details`,attribute:"open",value:""});
     await press(page,"Enter");await signal(page);
    }
   }
   for(const rule of mapped){
    const ref=references.find(s=>s.id===rule.id&&s.theme===theme);
    if(!ref)throw new Error(`Missing reference ${rule.id}/${theme}`);
    const nodes=await styles(`${selector} ${rule.selector}`,rule.fields);
    if(!nodes.length&&!rule.selector.includes("data-measured")&&!rule.selector.includes("__note")&&!rule.selector.includes("__footer")&&rule.selector!==".lf-metric-strip"&&rule.selector!==".lf-card__description")throw new Error(`Missing measured part ${name}/${rule.selector}`);
    for(const [index,node]of nodes.entries()){
     const checks=await Promise.all(rule.fields.map(field=>compare(ref,node,field)));
     for(const check of checks)assertions.push({app,theme,state:name,view,part:rule.selector,index,source:ref.id,sourcePath:ref.path,provenance:ref.provenance,...check});
     measurements.push({part:rule.selector,index,source:ref.id,sourcePath:ref.path,actual:node,checks});
    }
   }
   const primary=references.find(s=>s.id===mapped[0].id&&s.theme===theme),prefix=`${output}/state-parity/${app}-${name}-${view}-${theme}`;
   const crop=await captureCrop(page,`${selector} > :not(h2)`,{align:false});await writeFile(`${prefix}.png`,Buffer.from(crop.data,"base64"));
   const pixels=await diffImages(page,{reference:primary.path,actual:`${prefix}.png`,sideBySide:`${prefix}-side.png`,diff:`${prefix}-diff.png`});
   const geometryRule=mapped.find(rule=>rule.fields.some(field=>["paddingLeft","fontSize"].includes(field)));
   const geometryField=geometryRule.fields.includes("paddingLeft")?"paddingLeft":"fontSize";
   const ref=references.find(s=>s.id===geometryRule.id&&s.theme===theme);
   const target=`${selector} ${geometryRule.selector}`;
   const mutation=await page.evaluate(({target,field})=>{
    const n=document.querySelector(target),old=n.getAttribute("style"),before=getComputedStyle(n)[field];
    n.style.setProperty(field.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`),`${parseFloat(before)+1}px`,"important");
    const after=getComputedStyle(n)[field];
    if(old===null)n.removeAttribute("style");else n.setAttribute("style",old);
    return{before,after,restored:getComputedStyle(n)[field]};
   },{target,field:geometryField});
   const baseline=await compare(ref,{[geometryField]:mutation.before},geometryField);
   const corrupted=await compare(ref,{[geometryField]:mutation.after},geometryField);
   mutations.push({app,theme,state:name,view,field:geometryField,...mutation,pass:baseline.pass&&!corrupted.pass&&mutation.restored===mutation.before});
   cases.push({app,theme,state:name,view,reference:primary.path,provenance:primary.provenance,actual:`${prefix}.png`,sideBySide:`${prefix}-side.png`,diff:`${prefix}-diff.png`,pixels,measurements});
   }
  }
 }
}finally{
 const summary={cases:cases.length,assertions:assertions.length,painted:assertions.filter(a=>a.painted).length,nonPainted:assertions.filter(a=>!a.painted).length,failures:assertions.filter(a=>!a.pass).length,
  geometryMutations:mutations.length,geometryMutationFailures:mutations.filter(m=>!m.pass).length};
 await writeFile(`${output}/state-parity.json`,JSON.stringify({summary,cases,assertions,mutations},null,2));
 console.log(`STATE_PARITY ${JSON.stringify(summary)}`);if(summary.failures||summary.geometryMutationFailures||summary.cases!==204)process.exitCode=1;
 await tabs.closeAll();await browser.close();
}
