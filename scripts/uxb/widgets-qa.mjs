import { mkdir, readFile, writeFile } from "node:fs/promises";
import { captureCrop, diffImages } from "./image-diff.mjs";
import { ready, arm, signal, press } from "./trusted-keys.mjs";
import { applyViewport } from "./viewport.mjs";
const output = process.argv[2];
if (!output || !process.env.OMOWRIGHT_HELPER) throw Error("Usage: OMOWRIGHT_HELPER=/path/omowright.mjs node scripts/uxb/widgets-qa.mjs evidence-directory");
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
await mkdir(`${output}/matrix`, { recursive: true });
await mkdir(`${output}/parity`, { recursive: true });
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333"), tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } }), page = tab.page;
const matrix = [], assertions = [], comparisons = [];
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
    const controls = await page.evaluate(() => [...document.querySelectorAll(".lf-button,.lf-icon-button,select,.lf-chart summary")]
      .map(n => ({ h: n.getBoundingClientRect().height, visible: Boolean(n.getClientRects().length) })));
    check(`${prefix} owner target heights`, controls.filter(n => n.visible).every(n => Math.abs(n.h - (mobile ? 44 : 32)) < 1), controls);
    const glyphs = await page.evaluate(() => [...document.querySelectorAll(".lf-chart__legend button svg")]
      .map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })));
    check(`${prefix} plot sizing does not leak into control glyphs`, glyphs.length > 0 &&
      glyphs.every(n => n.width === 14 && n.height === 14), glyphs);
    const swatches=await page.evaluate(()=>[...document.querySelectorAll(".lf-chart__swatch")].map(n=>({
      width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,color:getComputedStyle(n).backgroundColor,
    })));
    check(`${prefix} series markers map plotted colors to controls`,swatches.length===glyphs.length&&
      swatches.every(n=>n.width===8&&n.height===8&&!["transparent","rgba(0, 0, 0, 0)"].includes(n.color)),swatches);
    const focusables = await page.evaluate(() => [...document.querySelectorAll("button,select,summary,[data-chart-point]")]
      .filter(n => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length).map((n,i) => { n.dataset.qaFocus = String(i); return `[data-qa-focus="${i}"]`; }));
    for (const selector of focusables) {
      await page.evaluate(selector => { const n = document.querySelector(selector); n.scrollIntoView({ block: "center", behavior: "instant" }); n.focus(); }, selector);
      await press(page, "Tab", 8);
      const restShadow = await page.evaluate(selector => getComputedStyle(document.querySelector(selector)).boxShadow, selector);
      await arm(page, { kind: "focus", selector }); await press(page, "Tab"); await signal(page);
      const focus = await page.evaluate(({selector,restShadow}) => {
        const n=document.querySelector(selector),old=n.getAttribute("style");
        const read=()=>{
          const s=getComputedStyle(n),colors=s.boxShadow.match(/rgba?\([^)]*\)/g)??[];
          const shadowPainted=s.boxShadow!==restShadow&&colors.some(color=>!color.startsWith("rgba(")||
            Number(color.slice(color.lastIndexOf(",")+1,-1))>0)&&
            (s.boxShadow.match(/-?[\d.]+px/g)??[]).some(length=>parseFloat(length)!==0);
          return {visible:n.matches(":focus-visible"),ring:s.outlineStyle!=="none"&&parseFloat(s.outlineWidth)>0&&
            !["transparent","rgba(0, 0, 0, 0)"].includes(s.outlineColor)||shadowPainted};
        };
        const painted=read();
        n.style.setProperty("outline","none","important");n.style.setProperty("box-shadow","none","important");
        const mutationRejected=!read().ring;
        if(old===null)n.removeAttribute("style");else n.setAttribute("style",old);
        return {painted,mutationRejected};
      },{selector,restShadow});
      check(`${prefix} focus ${selector}`,focus.painted.visible&&focus.painted.ring,focus.painted);
      check(`${prefix} removing focus ring fails ${selector}`,focus.mutationRejected,selector);
    }
    const point = '[data-specimen="Bar"] [data-chart-point]';
    await page.evaluate(selector => { document.querySelector(selector).focus(); }, point);
    await press(page, "Tab", 8); await arm(page,{kind:"focus",selector:point}); await press(page,"Tab"); await signal(page);
    check(`${prefix} keyboard tooltip`, await page.evaluate(() => Boolean(document.querySelector('[data-specimen="Bar"] [role=tooltip]'))), point);
    await page.screenshot({ path:`${output}/matrix/${prefix}-chart-focus.png` });
    await press(page,"Escape");
    check(`${prefix} tooltip Escape`, await page.evaluate(() => !document.querySelector('[data-specimen="Bar"] [role=tooltip]')), point);
    const details='[data-specimen="Bar"] details';
    await page.evaluate(selector=>document.querySelector(`${selector} summary`).focus(),details);
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
  await writeFile(`${output}/widgets-qa.json`,JSON.stringify({capturedAt:new Date().toISOString(),matrix,assertions,comparisons},null,2));
  await tabs.closeAll();await browser.close();
}
console.log(`WIDGET_QA captures=${matrix.length} assertions=${assertions.length} failed=${assertions.filter(x=>!x.pass).length} comparisons=${comparisons.length} styleFailures=${comparisons.filter(x=>x.differences.length).length}`);
if(assertions.some(result=>!result.pass))process.exitCode=1;
