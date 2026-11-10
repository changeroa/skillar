import { mkdir, readFile, writeFile } from "node:fs/promises";
import { captureCrop, diffImages } from "./image-diff.mjs";
import { ready, arm, signal, press } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";
import { measureWidgetFocus, ownerControlHeight,focusWidgetControl } from "./widget-visual-guards.mjs";
import { assertWidgetStates, conditionalParts } from "./widget-states.mjs";
const output = process.argv[2];
if (!output || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/omowright.mjs node scripts/uxb/widgets-qa.mjs evidence-directory");
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
await mkdir(`${output}/matrix`, { recursive: true });
await mkdir(`${output}/parity`, { recursive: true });
await mkdir(`${output}/focus-pixels`, { recursive: true });
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333"), tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } }), page = tab.page;
const matrix = [], assertions = [], comparisons = [], conditionalStates=[];
const fields = ["paddingTop","paddingRight","paddingBottom","paddingLeft","fontSize","lineHeight","fontWeight","fontFamily",
  "borderRadius","borderTopWidth","borderTopColor","backgroundColor","color","boxShadow","outlineWidth","outlineStyle","outlineColor"];
const check = (name, pass, evidence) => assertions.push({ name, pass, evidence });
async function measure(selector) {
  return page.evaluate(({ selector, fields }) => {
    const n = document.querySelector(selector), s = getComputedStyle(n);
    return { box: n.getBoundingClientRect().toJSON(), styles: Object.fromEntries(fields.map(k => [k, s[k]])) };
  }, { selector, fields });
}
try {
  for (const [app, port] of [["site",5183],["local",5184]]) for (const width of [390,1440,1920]) for (const theme of ["light","dark"]) {
    const prefix = `${app}-${width}-${theme}`, mobile = width === 390, height = mobile ? 844 : 900;
    await applyViewport(page,{width,height,deviceScaleFactor:mobile?3:1,mobile,coarse:mobile});
    await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await page.goto(`http://127.0.0.1:${port}/__gallery.html?widgets=1&theme=${theme}`, { waitUntil: "domcontentloaded" });
    await applyViewport(page,{width,height,deviceScaleFactor:mobile?3:1,mobile,coarse:mobile});
    await ready(page, "#gallery[data-ready=true]");
    const viewport = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, coarse: matchMedia("(pointer:coarse)").matches,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    check(`${prefix} actual viewport`, viewport.width === width && viewport.dpr === (mobile ? 3 : 1) && viewport.coarse === mobile, viewport);
    check(`${prefix} document fits`, !viewport.overflow, viewport);
    await page.screenshot({ path: `${output}/matrix/${prefix}-top.png` });
    const names = await page.evaluate(() => [...document.querySelectorAll("[data-specimen]")].map(n => n.dataset.specimen));
    assertWidgetStates(names);
    for(const [name,parts]of Object.entries(conditionalParts)){
      const observed=await page.evaluate(({name,parts})=>{
        const root=document.querySelector(`[data-specimen="${name}"]`);
        return {present:parts.present.map(selector=>({selector,found:Boolean(root.querySelector(selector))})),
          absent:parts.absent.map(selector=>({selector,found:Boolean(root.querySelector(selector))}))};
      },{name,parts});
      check(`${prefix} conditional ${name}`,observed.present.every(p=>p.found)&&observed.absent.every(p=>!p.found),observed);
    }
    for (const name of names) {
      const selector = `[data-specimen="${name}"]`;
      await page.evaluate(selector => document.querySelector(selector).scrollIntoView({ block: "center", behavior: "instant" }), selector);
      const capture = await captureCrop(page, selector, { align: false });
      const path = `${output}/matrix/${prefix}-${name}.png`;
      await writeFile(path, Buffer.from(capture.data, "base64"));
      matrix.push({ app, width, theme, name, path, dimensions: capture.bounds });
    }
    const baseline = await page.evaluate(() => [...document.querySelectorAll(".lf-chart")].flatMap(chart => {
      const line = chart.querySelector("[data-zero-baseline]");
      if (!line) return [];
      return [...chart.querySelectorAll("rect[data-value]")].map(n => ({
        value: Number(n.dataset.value), bottom: n.y.baseVal.value + n.height.baseVal.value,
        baseline: Number(n.dataset.baseline), paintedBottom: n.getBoundingClientRect().bottom,
        paintedBaseline: line.getBoundingClientRect().y, zeroHeight: n.height.baseVal.value,
      }));
    }));
    check(`${prefix} exact R7 zero baseline`, baseline.length > 0 && baseline.every(n => n.bottom === n.baseline &&
      Math.abs(n.paintedBottom - n.paintedBaseline) < .02 && (n.value !== 0 || n.zeroHeight === 1)), baseline);
    const baselineMutation=await page.evaluate(()=>{
      const read=()=>[...document.querySelectorAll(".lf-chart rect[data-value]")].every(n=>{
        const axis=n.closest(".lf-chart").querySelector("[data-zero-baseline]");
        return n.y.baseVal.value+n.height.baseVal.value===Number(n.dataset.baseline)&&
          Math.abs(n.getBoundingClientRect().bottom-axis.getBoundingClientRect().y)<.02&&
          (Number(n.dataset.value)!==0||n.height.baseVal.value===1);
      });
      const n=document.querySelector(".lf-chart rect[data-value]"),old=n.getAttribute("height"),before=read();
      n.setAttribute("height",String(Number(old)+1));const rejected=!read();
      n.setAttribute("height",old);return{before,rejected,restored:read()};
    });
    check(`${prefix} baseline geometry mutation is rejected`,baselineMutation.before&&baselineMutation.rejected&&baselineMutation.restored,baselineMutation);
    const chartSemantics=await page.evaluate(()=>[...document.querySelectorAll(".lf-chart")].map(chart=>{
      const title=chart.querySelector("figcaption").textContent,svg=chart.querySelector(".lf-chart__scroll > svg");
      const table=chart.querySelector("table"),points=[...chart.querySelectorAll("[data-chart-point]")];
      return{title,named:!svg||svg.getAttribute("aria-label")===title,
        namedPoints:points.every(n=>Boolean(n.getAttribute("aria-label"))&&n.getAttribute("role")==="img"&&n.tabIndex===0),
        fallback:table.querySelector("caption").textContent.includes(title)&&[...table.querySelectorAll("th")].every(n=>["row","col"].includes(n.getAttribute("scope"))),
        zero:table.textContent.includes("0"),missing:table.textContent.includes("미측정"),
        noFabricatedPoint:!chart.querySelector('[data-chart-point][aria-label$="미측정"]')};
    }));
    check(`${prefix} every chart and point has an accessible name`,chartSemantics.length===9&&chartSemantics.every(n=>n.named&&n.namedPoints),chartSemantics);
    check(`${prefix} every chart retains a named complete fallback`,chartSemantics.every(n=>n.fallback&&n.noFabricatedPoint),chartSemantics);
    const distinct=await page.evaluate(()=>{
      const zero=document.querySelector('[data-specimen="Metric-zero"] strong'),missing=document.querySelector('[data-specimen="Metric-unmeasured"] strong');
      const table=document.querySelector('[data-specimen="Bar"] table');
      return{zero:zero.textContent,zeroMeasured:zero.dataset.measured,missing:missing.textContent,missingMeasured:missing.dataset.measured,
        cells:[...table.querySelectorAll("td")].map(n=>n.textContent)};
    });
    check(`${prefix} missing measurements remain distinct from zero`,distinct.zero==="0"&&distinct.zeroMeasured==="true"&&
      distinct.missing!=="0"&&distinct.missingMeasured==="false"&&distinct.cells.includes("0")&&distinct.cells.includes(distinct.missing),distinct);
    const controls = await page.evaluate(() => [...document.querySelectorAll(".lf-button,.lf-icon-button,.lf-callout__dismiss,select,.lf-chart summary,.lf-callout .lf-message-actions a")]
      .map(n => ({ h: n.getBoundingClientRect().height, visible: Boolean(n.getClientRects().length) })));
    const ownerContext={width,coarse:viewport.coarse};
    check(`${prefix} owner target heights`, controls.some(n=>n.visible)&&controls.filter(n => n.visible).every(n => ownerControlHeight(n.h,ownerContext).pass), controls);
    const targetMutation=await page.evaluate(()=>{
      const n=document.querySelector(".lf-button"),old=n.getAttribute("style");
      const before=n.getBoundingClientRect().height;
      n.style.setProperty("height","60px","important");n.style.setProperty("min-height","60px","important");
      const mutated=n.getBoundingClientRect().height;
      if(old===null)n.removeAttribute("style");else n.setAttribute("style",old);
      return{before,mutated,upstreamMutationHeight:60,restored:n.getBoundingClientRect().height};
    });
    check(`${prefix} coupled upstream and product 60px mutation is rejected`,ownerControlHeight(targetMutation.before,ownerContext).pass&&
      targetMutation.mutated===60&&!ownerControlHeight(targetMutation.mutated,ownerContext).pass&&ownerControlHeight(targetMutation.restored,ownerContext).pass,targetMutation);
    const glyphs = await page.evaluate(() => [...document.querySelectorAll(".lf-chart__legend button svg")]
      .map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })));
    check(`${prefix} plot sizing does not leak into control glyphs`, glyphs.length > 0 &&
      glyphs.every(n => n.width === 14 && n.height === 14), glyphs);
    const swatches=await page.evaluate(()=>[...document.querySelectorAll(".lf-chart__swatch")].map(n=>({
      width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,color:getComputedStyle(n).backgroundColor,
    })));
    check(`${prefix} series markers map plotted colors to controls`,swatches.length===glyphs.length&&
      swatches.every(n=>n.width===8&&n.height===8&&!["transparent","rgba(0, 0, 0, 0)"].includes(n.color)),swatches);
    const focusables = await page.evaluate(() => [...document.querySelectorAll("button,select,summary,a[href],[data-chart-point]")]
      .filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length).map((n,i) => { n.dataset.qaFocus = String(i); return `[data-qa-focus="${i}"]`; }));
    for (const selector of focusables) {
      await focusWidgetControl(page,selector);
      const index=focusables.indexOf(selector);
      const focus=await measureWidgetFocus(page,selector,`${output}/focus-pixels/${prefix}-${index}`);
      check(`${prefix} focus ${selector}`,focus.pass,focus);
      check(`${prefix} removing focus ring fails ${selector}`,focus.mutationRejected,selector);
    }
    for(const name of names.filter(name=>name.startsWith("Callout-")||name==="Alert-dismissible")){
      const selector=`[data-specimen="${name}"]`,restore=`${selector} > button`;
      await focusWidgetControl(page,`${selector} ${name==="Alert-dismissible"?".lf-icon-button":".lf-callout__dismiss"}`);
      const surface=name==="Alert-dismissible"?".lf-alert":".lf-callout";
      await arm(page,{kind:"present",selector:`${selector}:has(> button):not(:has(${surface}))`});await press(page,"Enter");await signal(page);
      await focusWidgetControl(page,restore);
      const focus=await measureWidgetFocus(page,restore,`${output}/focus-pixels/${prefix}-${name}-restore`);
      const height=await page.evaluate(selector=>document.querySelector(selector).getBoundingClientRect().height,restore);
      check(`${prefix} conditional restore focus ${name}`,focus.pass&&focus.mutationRejected&&ownerControlHeight(height,ownerContext).pass,focus);
      await page.screenshot({path:`${output}/matrix/${prefix}-${name}-dismissed.png`});
      await arm(page,{kind:"present",selector:`${selector}:has(${surface}):not(:has(> button))`});await press(page,"Enter");await signal(page);
      await page.screenshot({path:`${output}/matrix/${prefix}-${name}-restored.png`});
      conditionalStates.push({app,width,theme,name,focus,dismissedPath:`${output}/matrix/${prefix}-${name}-dismissed.png`,restoredPath:`${output}/matrix/${prefix}-${name}-restored.png`});
    }
    const point = '[data-specimen="Bar"] [data-chart-point]';
    await arm(page,{kind:"attribute",selector:'[data-specimen="Bar"] [role=tooltip]',attribute:"role",value:"tooltip",key:"__tooltipSignal"});
    await focusWidgetControl(page,point);await signal(page,"__tooltipSignal");
    check(`${prefix} keyboard tooltip`, await page.evaluate(() => Boolean(document.querySelector('[data-specimen="Bar"] [role=tooltip]'))), point);
    await page.screenshot({ path:`${output}/matrix/${prefix}-chart-focus.png` });
    await arm(page,{kind:"absent",selector:'[data-specimen="Bar"] [role=tooltip]'});await press(page,"Escape");await signal(page);
    check(`${prefix} tooltip Escape`, await page.evaluate(() => !document.querySelector('[data-specimen="Bar"] [role=tooltip]')), point);
    const details='[data-specimen="Bar"] details';
    await focusWidgetControl(page,`${details} summary`);
    await arm(page,{kind:"attribute",selector:details,attribute:"open",value:""}); await press(page,"Enter"); await signal(page);
    check(`${prefix} data table reachable`,await page.evaluate(selector=>document.querySelector(selector).open&&document.querySelectorAll(`${selector} tbody tr`).length===3,details),details);
    await page.screenshot({path:`${output}/matrix/${prefix}-data-table.png`});
    await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));
    await page.screenshot({path:`${output}/matrix/${prefix}-end.png`});
  }
  const sources = [...JSON.parse(await readFile(`${output}/real-sources.json`,"utf8")), ...JSON.parse(await readFile(`${output}/mit-sources.json`,"utf8"))];
  await applyViewport(page,{width:1440,height:900});
  for(const source of sources) for(const [app,port] of [["site",5183],["local",5184]]) {
    const kind=source.id.startsWith("Alert")?"Alert":source.id, spec={kind,width:source.box.width,title:"기록",text:source.text};
    let selector="#widget-reference > *";
    if(kind==="StatusMessage") { spec.level="ERROR";spec.size="compact";spec.surface="popover"; }
    if(kind==="Callout") { spec.variant=source.variant;spec.align=source.align;spec.text="업로드 동의와 출처를 확인하면 기록을 볼 수 있습니다."; }
    if(kind==="Metric") { spec.value=Number(source.text); selector=".lf-metric__value";spec.width=400; }
    if(kind==="Alert") {
      const parsed=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,"text/html");return {title:d.querySelector("[data-slot=alert-title]")?.textContent,text:d.querySelector("[data-slot=alert-description]")?.textContent}},source.html);
      spec.title=parsed.title;spec.text=parsed.text;
    }
    if(kind==="Empty") {
      const parsed=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,"text/html");return {title:d.querySelector("h2")?.textContent,text:d.querySelector(".text-muted-foreground")?.textContent}},source.html);
      spec.title=parsed.title;spec.text=parsed.text;spec.emptyVariant="intro";
    }
    if(["Bar","Line","Histogram"].includes(kind)) { spec.width=source.box.width;selector=".lf-chart__scroll > svg"; }
    const name=`${app}-${source.id}-${source.variant??"default"}-${source.align??"default"}-${source.theme}`;
    await page.goto(`http://127.0.0.1:${port}/__gallery.html?theme=${source.theme}&widgetReference=${encodeURIComponent(JSON.stringify(spec))}`,{waitUntil:"domcontentloaded"});
    await applyViewport(page,{width:1440,height:900});
    await ready(page,"#gallery[data-ready=true]");
    const actual=await measure(selector),crop=await captureCrop(page,selector,{align:false}),path=`${output}/parity/${name}.png`;
    await writeFile(path,Buffer.from(crop.data,"base64"));
    const differences=fields.filter(field=>!field.startsWith("outline")&&source.styles[field]!==actual.styles[field])
      .map(field=>({field,reference:source.styles[field],actual:actual.styles[field]}));
    const pixels=await diffImages(page,{reference:source.path,actual:path,sideBySide:`${output}/parity/${name}-side.png`,diff:`${output}/parity/${name}-diff.png`});
    comparisons.push({name,kind,source:source.path,actual:path,provenance:source.provenance??"real public Demo",differences,pixels});
  }
} finally {
  await writeFile(`${output}/widgets-qa.json`,JSON.stringify({capturedAt:new Date().toISOString(),matrix,assertions,comparisons,conditionalStates},null,2));
  await tabs.closeAll();await browser.close();
}
console.log(`WIDGET_QA captures=${matrix.length} assertions=${assertions.length} failed=${assertions.filter(x=>!x.pass).length} comparisons=${comparisons.length} styleFailures=${comparisons.filter(x=>x.differences.length).length}`);
if(assertions.some(result=>!result.pass))process.exitCode=1;
