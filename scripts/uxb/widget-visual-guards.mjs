import { writeFile } from "node:fs/promises";
import { arm,signal,press } from "./trusted-keys.mjs";
import { focusPaintOwner } from "./focus-paint.mjs";

export async function focusWidgetControl(page,selector) {
  await page.evaluate(selector=>{
    const n=document.querySelector(selector);
    if(n.tabIndex!==0)throw new Error(`Not a native tab stop: ${selector}`);
    n.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});
    // Reverse Tab from a page's first control can leave its document. Start from
    // an owned, adjacent tab stop instead; only trusted Tab may focus the target.
    const reference=n.localName==="summary"?n.parentElement:n;
    const svg=reference.namespaceURI==="http://www.w3.org/2000/svg";
    const sentinel=svg?document.createElementNS(reference.namespaceURI,"g"):document.createElement("span");
    sentinel.setAttribute("tabindex","0");sentinel.setAttribute("aria-hidden","true");sentinel.dataset.widgetTabSentinel="true";
    sentinel.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    if(svg){const rect=document.createElementNS(reference.namespaceURI,"rect");rect.setAttribute("width","1");rect.setAttribute("height","1");sentinel.appendChild(rect)}
    reference.before(sentinel);sentinel.focus({preventScroll:true});
    if(document.activeElement!==sentinel)throw new Error("Native Tab origin did not take focus");
  },selector);
  try {await arm(page,{kind:"focus",selector});await press(page,"Tab");await signal(page)}
  catch(error) {
    const state=await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,240),documentFocus:document.hasFocus()}));
    throw new Error(`Native focus ${selector}: ${error.message}; ${JSON.stringify(state)}`);
  }
  finally {await page.evaluate(()=>document.querySelector("[data-widget-tab-sentinel]")?.remove())}
}

export function ownerControlHeight(height, { width, coarse }) {
  const expected=coarse||width<=768?44:32;
  return {height,expected,pass:Math.abs(height-expected)<.01};
}

/** Compare composited focus paint with the identical focused frame minus its ring. */
export function focusPaintEvidence({ focused, removed, width, height, box, dpr, focusVisible }) {
  if(focused.length!==removed.length||focused.length!==width*height*4)throw new RangeError("Focus rasters must match");
  const luminance=(pixels,i)=>{
    const channels=[0,1,2].map(c=>{const v=pixels[i+c]/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});
    return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
  };
  let contrastPixels=0,changedPixels=0,maxContrast=1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    // Include inset rings, but never certify label/content changes as an indicator.
    if(x>box.left+4*dpr&&x<box.right-4*dpr&&y>box.top+4*dpr&&y<box.bottom-4*dpr)continue;
    const i=(y*width+x)*4;
    if([0,1,2,3].every(c=>focused[i+c]===removed[i+c]))continue;
    changedPixels++;
    const a=luminance(focused,i),b=luminance(removed,i),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    maxContrast=Math.max(maxContrast,contrast);
    if(contrast>=3)contrastPixels++;
  }
  const requiredPixels=Math.ceil(2*((box.right-box.left)+(box.bottom-box.top))*dpr);
  return {focusVisible,changedPixels,contrastPixels,requiredPixels,maxContrast,
    pass:focusVisible&&contrastPixels>=requiredPixels};
}

async function raster(page,bounds) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const frame=await page._sendToTarget("Page.captureScreenshot",{format:"png",captureBeyondViewport:false,fromSurface:true});
  return page.evaluate(({frame,bounds})=>new Promise((resolve,reject)=>{
    const image=new Image(),timer=setTimeout(()=>reject(new Error("Focus frame decode timed out")),8000);
    image.onerror=()=>{clearTimeout(timer);reject(new Error("Invalid focus frame"))};
    image.onload=()=>{
      clearTimeout(timer);
      const canvas=document.createElement("canvas");canvas.width=bounds.width;canvas.height=bounds.height;
      const c=canvas.getContext("2d",{willReadFrequently:true});c.drawImage(image,-bounds.x,-bounds.y);
      const data=c.getImageData(0,0,canvas.width,canvas.height).data;
      let binary="";for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
      resolve({png:canvas.toDataURL("image/png").split(",")[1],rgba:btoa(binary)});
    };
    image.src=`data:image/png;base64,${frame}`;
  }),{frame:frame.data,bounds});
}

export async function measureWidgetFocus(page,selector,stem) {
  const context=await page.evaluate(({selector,owner})=>{
    const n=document.querySelector(selector),target=(0,eval)(`(${owner})`)(n);
    const rect=target.getBoundingClientRect(),dpr=devicePixelRatio;
    const x=Math.max(0,Math.floor((rect.left-8)*dpr)),y=Math.max(0,Math.floor((rect.top-8)*dpr));
    const width=Math.min(innerWidth*dpr,Math.ceil((rect.right+8)*dpr))-x;
    const height=Math.min(innerHeight*dpr,Math.ceil((rect.bottom+8)*dpr))-y;
    return {focusVisible:n===document.activeElement&&n.matches(":focus-visible"),dpr,x,y,width,height,
      box:{left:rect.left*dpr-x,right:rect.right*dpr-x,top:rect.top*dpr-y,bottom:rect.bottom*dpr-y},
      name:n.getAttribute("aria-label")??n.textContent,point:n.hasAttribute("data-chart-point"),tabIndex:n.tabIndex};
  },{selector,owner:focusPaintOwner.toString()});
  const focused=await raster(page,context);
  const originals=await page.evaluate(({selector,owner})=>{
    const n=document.querySelector(selector),target=(0,eval)(`(${owner})`)(n);
    return [...new Set([n,target])].map((element,index)=>{
      element.dataset.focusPaintTarget=String(index);const old=element.getAttribute("style");
      element.style.setProperty("outline","none","important");element.style.setProperty("box-shadow","none","important");
      return {index,old};
    });
  },{selector,owner:focusPaintOwner.toString()});
  let removed;
  try {removed=await raster(page,context)}
  finally {await page.evaluate(originals=>{for(const {index,old}of originals){
    const n=document.querySelector(`[data-focus-paint-target="${index}"]`);
    if(old===null)n.removeAttribute("style");else n.setAttribute("style",old);
    delete n.dataset.focusPaintTarget;
  }},originals)}
  const evidence=focusPaintEvidence({...context,focused:Buffer.from(focused.rgba,"base64"),removed:Buffer.from(removed.rgba,"base64")});
  // The same pixel predicate must reject the ringless frame; a CSS shadow is not evidence.
  const mutation=focusPaintEvidence({...context,focused:Buffer.from(removed.rgba,"base64"),removed:Buffer.from(removed.rgba,"base64")});
  await writeFile(`${stem}-focused.png`,Buffer.from(focused.png,"base64"));
  await writeFile(`${stem}-removed.png`,Buffer.from(removed.png,"base64"));
  return {...context,...evidence,mutationRejected:!mutation.pass,focusedPath:`${stem}-focused.png`,removedPath:`${stem}-removed.png`};
}
