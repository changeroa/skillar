import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const helper = process.env.OMOWRIGHT_HELPER;
if (!helper) throw Error("OMOWRIGHT_HELPER is required");
const { loadOmowright } = await import(helper);
import { applyViewport } from "./viewport.mjs";
import { focusPaint, proveFocusMutation, tableKeyboard, skillsKeyboard } from "./table-keyboard.mjs";
import { verifyShellLifecycle } from "./shell-lifecycle.mjs";
import { arm, press, ready, signal } from "./trusted-keys.mjs";
const [base, out] = process.argv.slice(2);
if (!base || !out || !["localhost", "pr6-runtime.localhost"].includes(new URL(base).hostname))
  throw Error("Usage: pr6-runtime.mjs localhost-origin output-directory");
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
const page = tab.page;
const results = [], focus = [], structure = [], sizing = [], mutations = [];
function assertControlHeight(height, width, message) {
  assert.equal(height, width === 390 ? 44 : 32, message);
}
await mkdir(out, { recursive: true });
async function record(name, operation) {
  await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page._sendToTarget("Network.setCookie", { name:"x-qa-scenario",value:"",url:base });
  try { const evidence = await operation(); results.push({ name, status: "PASS", evidence }); }
  catch (error) { results.push({ name, status: "FAIL", error: String(error), stack: error.stack?.split("\n").slice(0,5) }); }
  console.log(`RUNTIME ${name} ${results.at(-1).status}`);
  if (results.at(-1).status === "FAIL") console.log(`RUNTIME_DETAIL ${results.at(-1).error}`);
  await writeFile(`${out}/runtime.json`,JSON.stringify({results,focus,sizing,mutations,structure},null,2));
}
async function open(route, selector, width = 1440, mode = "light") {
  await page._sendToTarget("Network.setCookie", { name:"x-qa-scenario",value:"",url:base });
  await page.goto(base + route, { waitUntil: "domcontentloaded" });
  await ready(page, selector);
  await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
  await applyViewport(page, { width, height: width === 390 ? 844 : 900, mobile: width === 390, coarse: width === 390 });
  await page.evaluate(mode => { document.documentElement.dataset.theme = mode; localStorage.setItem("skillar-theme", mode); }, mode);
}
async function readRules() {
  return page.evaluate(() => {
    const main=document.querySelector("main"),nav=document.querySelector(".app-navigation"),table=main?.querySelector(".skills-table-main table:has(tr[id^='skill-row-'])");
    const rows=table?[...table.querySelectorAll("tbody tr")].filter(row=>{const b=row.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}).length:null;
    const h1=main?.querySelector("h1");
    const bars=[...document.querySelectorAll(".lf-chart__bar")].map(bar=>({y:Number(bar.getAttribute("y")),height:Number(bar.getAttribute("height"))}));
    const expected=bars.length?Math.max(...bars.map(bar=>bar.y+bar.height)):null;
    return {h1Count:main?.querySelectorAll("h1").length,subtitle:h1?.nextElementSibling?.textContent?.length??0,
      activeNav:nav?.querySelectorAll('[aria-current="page"]').length??0,
      identity:!!document.querySelector("#sidebar-account .account-user,#sidebar-account .dash-account"),
      signout:!!document.querySelector('#sidebar-account form[action="/auth/logout"]'),
      breadcrumb:!!document.querySelector(".app-breadcrumb"),palette:!!document.querySelector("#app-jump"),
      rows,overflow:document.documentElement.scrollWidth>innerWidth,bars:bars.length,
      commonBaseline:bars.every(bar=>Math.abs(bar.y+bar.height-expected)<=1),
      noReadHistoryColumn:![...document.querySelectorAll("th")].some(th=>/읽기 기록/.test(th.textContent))};
  });
}
try {
  await record("shared table keyboard and URL controls", () => tableKeyboard(page, base));
  await record("hosted skills URL and selection keyboard", () => skillsKeyboard(page, base));
  await record("native pagehide/pageshow and bfcache", () => verifyShellLifecycle(page, base));
  await record("new skill action preserves URL and focuses mounted publisher", async () => {
    await open("/skills/", "tr[id^='skill-row-']");
    const url = await page.evaluate(() => location.href);
    await page.evaluate(() => [...document.querySelectorAll(".library-heading button")].find(button => button.textContent === "새 스킬").setAttribute("id","qa-new-skill"));
    await arm(page, { kind: "focus", selector: "#publish-title" });
    await page.click("#qa-new-skill"); await signal(page);
    assert.equal(await page.evaluate(() => location.href), url);
    return { urlUnchanged: true, publisherFocus: true };
  });
  for (const width of [1440,390]) for (const mode of ["light","dark"]) {
    const routes = [
      ["/dashboard/",".home-changes rect"],
      ["/skills/","tr[id^='skill-row-']"],
      ["/skills/?skill=11223344-1122-4122-8122-000000000002&view=full&tab=versions",".version-list .version"],
      ["/connections/",".connections-grid tbody tr"],
      ["/login/?auth=signed-in","#signed-in:not([hidden])"],
      ["/login/?auth=signed-out","#signed-out:not([hidden])"],
      ["/404.html",".not-found"],
    ];
    for (const [route, selector] of routes) await record(`real-page focus/size ${width} ${mode} ${route}`, async () => {
      await open(route, selector, width, mode);
      const rules = await readRules();
      await press(page,"Tab");
      const targets = await page.evaluate(() => {
        const seen = new Set();
        return [...document.querySelectorAll("main button,main input,main select,main summary,main a.button,main [role=tab]")].filter(node => {
          if (!node.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}) || node.disabled || node.tabIndex < 0) return false;
          const key = node.tagName+"|"+node.className+"|"+(node.getAttribute("role")??"")+"|"+(node.getAttribute("type")??"");
          if (seen.has(key)) return false; seen.add(key); return true;
        }).map((node,index) => {
          node.setAttribute("data-pr6-focus",String(index));
          return { selector:`[data-pr6-focus="${index}"]`, tag:node.tagName, type:node.getAttribute("type"),
            label:(node.getAttribute("aria-label")||node.textContent||"").trim().slice(0,70) };
        });
      });
      for (const target of targets) {
        const dimensions = await page.evaluate(selector => {
          const node=document.querySelector(selector),css=getComputedStyle(node),rect=node.getBoundingClientRect();
          return {height:rect.height,font:css.fontSize,radius:css.borderRadius,padding:css.padding,border:css.borderColor,opacity:css.opacity};
        },target.selector);
        if (!(target.tag === "INPUT" && ["checkbox","radio"].includes(target.type))) {
          assertControlHeight(dimensions.height,width,`${route}: ${target.label}`);
          sizing.push({route,width,mode,...target,...dimensions});
        }
        const baseline = {route,width,mode,...target,...await focusPaint(page,target.selector)};
        focus.push(baseline);
        assert.equal(baseline.pass,true,`Missing painted focus: ${route} ${target.label}`);
        if (target.tag === "INPUT" && ["checkbox","radio"].includes(target.type)) {
          const styles = await page.evaluate(selector => {
            const node=document.querySelector(selector),paint=node.nextElementSibling;
            const saved=[node.getAttribute("style"),paint.getAttribute("style")];
            for(const part of [node,paint])part.style.cssText+=";outline:none!important;box-shadow:none!important;border-color:transparent!important";
            return saved;
          },target.selector);
          try { assert.equal((await focusPaint(page,target.selector)).pass,false,"Removing both checkbox focus paints must fail"); }
          finally { await page.evaluate(({selector,styles})=>{
            const node=document.querySelector(selector);
            [node,node.nextElementSibling].forEach((part,index)=>styles[index]===null?part.removeAttribute("style"):part.setAttribute("style",styles[index]));
          },{selector:target.selector,styles}); }
        } else await proveFocusMutation(page,target.selector);
        const mutation = await page.evaluate(selector => {
          const node=document.querySelector(selector),style=node.getAttribute("style");
          node.style.setProperty("height","60px","important");node.style.setProperty("min-height","60px","important");
          const height=node.getBoundingClientRect().height;
          style===null?node.removeAttribute("style"):node.setAttribute("style",style);
          return height;
        },target.selector);
        assert.equal(mutation,60,"The mutation must actually apply");
        if (!(target.tag === "INPUT" && ["checkbox","radio"].includes(target.type))) {
          assert.throws(()=>assertControlHeight(mutation,width,"Mutated control must be rejected"),assert.AssertionError);
          mutations.push({route,width,mode,selector:target.selector,ringRemovedRejected:true,height60Rejected:true,measuredHeight:mutation});
        } else mutations.push({route,width,mode,selector:target.selector,ringRemovedRejected:true,height60Rejected:null});
      }
      await page.evaluate(() => {
        document.activeElement?.blur();
        const main=document.querySelector("main"); if(main)main.scrollTop=0;
        document.scrollingElement.scrollTop=0;
      });
      assert.equal(rules.h1Count,1); assert.equal(rules.overflow,false);
      assert.equal(rules.noReadHistoryColumn,true);assert.equal(rules.commonBaseline,true);
      if (!route.includes("signed-out")&&!route.includes("404")) {
        assert.equal(rules.breadcrumb,true);assert.equal(rules.palette,true);
        assert.equal(rules.identity,true);assert.equal(rules.signout,true);
      }
      structure.push({route,width,mode,...rules});
      if (rules.rows!==null) assert.ok(rules.rows>=(width===390?3:8),JSON.stringify(rules));
      await page.screenshot({path:`${out}/focus-${structure.length}.png`});
      return {targets:targets.length, rules};
    });
    await record(`empty skills ${width} ${mode}`,async()=>{
      await open("/skills/?library=empty","#skills-app .ui-table tbody",width,mode);
      const text=await page.evaluate(()=>document.querySelector("#skills-app").innerText);
      assert.ok(text.includes("새 스킬 게시"));assert.equal(await page.evaluate(()=>document.querySelectorAll('tr[id^="skill-row-"]').length),0);
      await page.screenshot({path:`${out}/empty-skills-${mode}-${width}.png`});
      return {realEmpty:true,nextAction:true};
    });
  }
} finally {
  await writeFile(`${out}/runtime.json`,JSON.stringify({results,focus,sizing,mutations,structure},null,2));
  await tabs.closeAll();
}
console.log(`RUNTIME_COMPLETE ${results.filter(row=>row.status==="PASS").length}/${results.length}`);
process.exit(results.some(row=>row.status==="FAIL")||focus.some(row=>!row.pass)?1:0);
