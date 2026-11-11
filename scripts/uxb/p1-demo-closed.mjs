// Real view-only Demo references for closed P1 states (PR-8 reference-eligibility follow-up).
// Own tab on Chrome 9333, no sign-in. Never types, selects, toggles or submits: the only actions are
// navigation, the trusted pointer states, and one client-side "Add condition" row in the traces filter
// sidebar. Every non-read Demo request is failed client-side and must stay at zero per capture.
// Spinner loading states hold only read-only tRPC GETs until captured, then continue them.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { press, ready } from "./trusted-keys.mjs";
import { captureLiveStates } from "./p1-live-states.mjs";

const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser), tab = await tabs.create("about:blank"), { page } = tab;
const origin = "https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646";
const readPosts = [/\/api\/dashboard\/execute-query-stream/, /\/api\/trpc\/events\.batchIO/];
const rows = [], blocked = [], held = new Map();
let holding = null;
await mkdir(`${out}/demo-closed`, { recursive: true });
page.cdp.on("Fetch.requestPaused", event => {
  const { method, url } = event.request;
  if (method === "GET" && holding?.test(url)) { held.set(event.requestId, url.replace(/\?.*/, "")); return; }
  if (["GET", "HEAD", "OPTIONS"].includes(method) || method === "POST" && readPosts.some(p => p.test(url)))
    void page._sendToTarget("Fetch.continueRequest", { requestId: event.requestId });
  else {
    blocked.push({ method, url: url.replace(/\?.*/, "") });
    void page._sendToTarget("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
  }
});
await page._sendToTarget("Fetch.enable", { patterns: [{ urlPattern: "*://jp.cloud.langfuse.com/*", requestStage: "Request" }] });
async function release() {
  holding = null;
  for (const requestId of held.keys()) await page._sendToTarget("Fetch.continueRequest", { requestId }).catch(() => {});
  held.clear();
}
const viewportFor = width => width === 390
  ? { width: 390, height: 844, mobile: true, coarse: true, deviceScaleFactor: 3 }
  : { width: 1440, height: 900, mobile: false, coarse: false, deviceScaleFactor: 1 };
async function open(url, width, theme, readySelector) {
  const viewport = viewportFor(width);
  await tabs.repin(tab, { width: viewport.width, height: viewport.height });
  await applyViewport(page, viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await applyViewport(page, viewport);
  await page.evaluate(async theme => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    const style = document.createElement("style");
    style.textContent = '[data-sidebar="footer"]{display:none!important}';
    document.head.append(style);
    await document.fonts.ready;
  }, theme);
  await ready(page, readySelector);
  return viewport;
}
/**
 * Finds the first visible match whose predicate holds after the DOM has been quiet for 800ms
 * (bounded at 10s), and returns a structural nth-child selector that survives row re-renders.
 */
async function mark(css, predicateSource) {
  return page.evaluate(({ css, src }) => new Promise(resolve => {
    let timer;
    const finish = () => {
      observer.disconnect(); clearTimeout(limit);
      const accept = new Function("n", `return (${src})`);
      const node = [...document.querySelectorAll(css)].find(n => n.checkVisibility() && n.getBoundingClientRect().width > 0 && accept(n));
      if (!node) return resolve(null);
      const path = [];
      for (let n = node; n && n !== document.body; n = n.parentElement)
        path.unshift(`${n.localName}:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`);
      const r = node.getBoundingClientRect();
      resolve({ selector: `body > ${path.join(" > ")}`, width: r.width, height: r.height,
        text: node.textContent.trim().slice(0, 40), cls: String(node.getAttribute("class")).slice(0, 200) });
    };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(finish, 800); });
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    const limit = setTimeout(finish, 10000);
    timer = setTimeout(finish, 800);
  }), { css, src: predicateSource });
}
/** Resolves once the DOM has had no mutation for 800ms (bounded at 10s). */
async function quiet() {
  await page.evaluate(() => new Promise(resolve => {
    let timer;
    const done = () => { observer.disconnect(); clearTimeout(limit); clearTimeout(timer); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 800); });
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    const limit = setTimeout(done, 10000);
    timer = setTimeout(done, 800);
  }));
}
async function capture({ targets, theme, width, viewport, url, interaction, found }) {
  const before = blocked.length;
  const { selector } = found;
  const metrics = await page.evaluate(() => ({
    width: innerWidth, dpr: devicePixelRatio,
    footerHidden: [...document.querySelectorAll('[data-sidebar="footer"]')].every(n => !n.checkVisibility()),
    textLength: document.querySelector("main")?.innerText.length ?? 0,
  }));
  assert.equal(metrics.width, width);
  assert.equal(metrics.footerHidden, true);
  assert.ok(metrics.textLength > 50);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (typeof animation.currentTime !== "number") animation.pause();
      else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
      else { animation.pause(); animation.currentTime = 0; }
    }
  });
  // Caller context the Demo element inherits from (typography, and the parent's display for blockification).
  const context = await page.evaluate(selector => {
    const style = getComputedStyle(document.querySelector(selector).parentElement);
    return { display: style.display, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight };
  }, selector);
  const [first] = targets;
  const file = `${out}/demo-closed/${first.component}-${first.state}-${width}-${theme}.png`;
  const states = await captureLiveStates(page, { selector, file, specimen: first, viewport });
  for (const interactionState of Object.values(states)) {
    assert.equal(interactionState.style.visible, true);
    assert.ok(interactionState.capture.varied > 0, `${file} must contain painted pixels`);
  }
  assert.equal(blocked.length, before, `${file}: a non-read request was attempted during capture`);
  for (const target of targets) rows.push({ ...target, theme, width, viewportWidth: width, provenance: "REAL-DEMO", url,
    selector, found, context, style: states.rest.style, states, geometry: states.rest.style.geometry, file,
    accountFooterHidden: true, interaction, metrics });
  console.log(`P1_DEMO_CLOSED ${targets.map(t => `${t.component}/${t.state}`).join(",")} ${width} ${theme}`);
}

try {
  // P1_DEMO_CLOSED_ONLY=msi and P1_DEMO_CLOSED_THEMES=dark,light narrow a diagnostic rerun.
  const only = process.env.P1_DEMO_CLOSED_ONLY;
  for (const theme of (process.env.P1_DEMO_CLOSED_THEMES ?? "light,dark").split(",")) {
    // Switch: evaluator rules table status column; view-only access renders them disabled. Never toggled.
    if (only !== "msi") for (const width of [1440, 390]) {
      const viewport = await open(`${origin}/evals/rules`, width, theme, "tbody tr [role=switch]");
      for (const checked of ["checked", "unchecked"]) {
        const found = await mark("tbody [role=switch]",
          `n.dataset.state === "${checked}" && n.disabled && n.className.includes("h-5 w-9") && n.className.includes("data-[state=checked]:bg-dark-green")`);
        if (!found) { console.log(`P1_DEMO_CLOSED_MISSING Switch ${checked} ${width} ${theme}`); continue; }
        await capture({ targets: [{ component: "Switch", state: `default-green-${checked}-disabled` }], theme, width, viewport,
          url: `${origin}/evals/rules`, found,
          interaction: "Actual evaluator-rule Enabled Switch (pinned Switch, default size, green, disabled for the view-only Demo user). Pointer states only; never toggled." });
      }
    }
    // Spinner xxs-muted-inline: table pagination count while its read-only GETs are held.
    if (only !== "msi") for (const width of [1440, 390]) {
      holding = /\/api\/trpc\//;
      try {
        const viewport = await open(`${origin}/sessions`, width, theme, "svg.animate-spin.size-3.inline.text-muted-foreground");
        assert.ok(held.size > 0, "Loading state must be held by actual read-only GETs");
        const found = await mark("svg.animate-spin", `n.getAttribute("class") === "lucide lucide-loader-circle animate-spin text-muted-foreground size-3 inline"`);
        assert.ok(found, "pagination spinner");
        await capture({ targets: [{ component: "Spinner", state: "xxs-muted-inline" }], theme, width, viewport, url: `${origin}/sessions`, found,
          interaction: "Actual DataTablePagination count Spinner (size xxs, muted, inline). Only read-only tRPC GETs are held until this capture, then continued; no error or write is induced." });
      } finally { await release(); }
    }
    // Spinner xxs-inherit: prompts Automations count indicator (hidden below md in the pinned source).
    if (only !== "msi") try {
      holding = /\/api\/trpc\/[^?]*automations\.count/;
      const viewport = await open(`${origin}/prompts`, 1440, theme, "a svg.animate-spin.size-3.block, button svg.animate-spin.size-3.block");
      assert.ok(held.size > 0, "Automations count must be held by an actual read-only GET");
      const found = await mark("svg.animate-spin", `n.getAttribute("class") === "lucide lucide-loader-circle animate-spin size-3 block" && /Automations/.test(n.closest("a,button")?.textContent ?? "")`);
      assert.ok(found, "automations spinner");
      await capture({ targets: [{ component: "Spinner", state: "xxs-inherit" }], theme, width: 1440, viewport, url: `${origin}/prompts`, found,
        interaction: "Actual AutomationButton count Spinner (size xxs, omitted variant inherits the button colour, block). Only the read-only automations.count GET is held until this capture, then continued." });
    } finally { await release(); }
    // Closed empty MultiSelectInput: traces filter sidebar, Categorical Scores facet, client-side "Add condition" row.
    {
      // A value chosen in an earlier theme persists in this tab's own sessionStorage; start each theme clean.
      await open(`${origin}/traces`, 1440, theme, "tbody tr");
      await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("observations-events-"))
        .forEach(key => sessionStorage.removeItem(key)));
      const viewport = await open(`${origin}/traces`, 1440, theme, "tbody tr");
      await quiet();
      assert.equal(await page.evaluate(() => /score/i.test(decodeURIComponent(location.search))), false, "no score filter at start");
      const facet = await page.evaluate(() => [...document.querySelectorAll("button")].some(n => n.checkVisibility() && n.textContent.trim() === "Categorical Scores"));
      if (!facet) {
        const box = await page.evaluate(() => { const n = [...document.querySelectorAll("button")].find(n => n.checkVisibility() && /^Add filter/.test(n.textContent.trim())); n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
        for (const type of ["mousePressed", "mouseReleased"]) await page._sendToTarget("Input.dispatchMouseEvent", { type, ...box, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
        await ready(page, '[data-radix-popper-content-wrapper] [cmdk-item][data-value="score_categories"]');
        await quiet();
        const item = await page.evaluate(() => { const n = document.querySelector('[data-radix-popper-content-wrapper] [cmdk-item][data-value="score_categories"]'); n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
        for (const type of ["mousePressed", "mouseReleased"]) await page._sendToTarget("Input.dispatchMouseEvent", { type, ...item, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      }
      await quiet();
      const head = await page.evaluate(() => {
        const n = [...document.querySelectorAll("button[aria-controls]")].find(n => n.checkVisibility() && n.textContent.trim() === "Categorical Scores");
        if (!n || n.getAttribute("aria-expanded") === "true") return null;
        n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
      });
      if (head) for (const type of ["mousePressed", "mouseReleased"]) await page._sendToTarget("Input.dispatchMouseEvent", { type, ...head, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      await quiet();
      const add = await page.evaluate(() => {
        const trigger = [...document.querySelectorAll("button[aria-controls]")].find(n => n.checkVisibility() && n.textContent.trim() === "Categorical Scores");
        const region = trigger && document.getElementById(trigger.getAttribute("aria-controls"));
        const button = [...(region?.querySelectorAll("button") ?? [])].find(n => n.textContent.trim() === "Add condition");
        if (!button) return { missing: true, expanded: trigger?.getAttribute("aria-expanded") ?? null, region: region?.textContent.trim().slice(0, 80) ?? null,
          heads: [...document.querySelectorAll("button.group\\/facet")].map(n => `${n.textContent.trim().slice(0, 24)}:${n.getAttribute("aria-controls")}`).slice(-8),
          url: location.search.slice(0, 160) };
        button.scrollIntoView({ block: "center" }); const r = button.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
      });
      assert.ok(!add.missing, `Categorical Scores Add condition: ${JSON.stringify(add)}`);
      for (const type of ["mousePressed", "mouseReleased"]) await page._sendToTarget("Input.dispatchMouseEvent", { type, ...add, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      await ready(page, "fieldset button[role=combobox][aria-expanded=false]");
      // The values MultiSelectInput stays disabled until the draft row has a score key. Choosing the key
      // in this unapplied draft only reads score values; the view's filter must stay unchanged.
      await quiet();
      const filterBefore = await page.evaluate(() => new URL(location.href).searchParams.get("filter"));
      const keyTrigger = await page.evaluate(() => {
        const n = [...document.querySelectorAll("fieldset button[role=combobox]")].find(n => n.checkVisibility() && n.textContent.trim() === "Name");
        if (!n) return null; n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + r.height / 2, controls: n.getAttribute("aria-controls") };
      });
      assert.ok(keyTrigger, "score key select");
      // Keyboard keeps the choice scoped to this key SelectInput: Enter opens it, Enter takes the highlighted key.
      await page.evaluate(() => [...document.querySelectorAll("fieldset button[role=combobox]")]
        .find(n => n.checkVisibility() && n.textContent.trim() === "Name").focus());
      await press(page, "Enter");
      await ready(page, "[data-radix-popper-content-wrapper] [cmdk-item][data-selected=true]");
      const option = await page.evaluate(() => document.querySelector("[data-radix-popper-content-wrapper] [cmdk-item][data-selected=true]").textContent.trim().slice(0, 40));
      await press(page, "Enter");
      await quiet();
      assert.equal(await page.evaluate(() => !!document.querySelector("[data-radix-popper-content-wrapper]")), false, "key popup closed");
      const filterAfter = await page.evaluate(() => new URL(location.href).searchParams.get("filter"));
      // The page may restore its default view filter meanwhile; what must not appear is a score filter.
      assert.equal(/score/i.test(decodeURIComponent(filterAfter ?? "")), false,
        `Choosing a draft key must not apply a score filter (key ${option}; ${filterBefore} -> ${filterAfter})`);
      const msi = `n.textContent.trim() === "Select" && n.getAttribute("aria-expanded") === "false" && !n.disabled && !!n.querySelector("svg")`;
      let found = await mark("fieldset button[role=combobox]", msi);
      for (let attempt = 0; !found && attempt < 3; attempt++) { await quiet(); found = await mark("fieldset button[role=combobox]", msi); }
      if (found) found.draftKey = option;
      assert.ok(found, `closed empty MultiSelectInput: ${JSON.stringify(await page.evaluate(() =>
        [...document.querySelectorAll("fieldset [role=combobox]")].map(n => ({ tag: n.tagName, text: n.textContent.trim().slice(0, 30),
          expanded: n.getAttribute("aria-expanded"), disabled: n.disabled, svg: !!n.querySelector("svg"), w: n.getBoundingClientRect().width,
          inner: n.innerHTML.replace(/class="[^"]*"/g, "").slice(0, 300) }))))}`);
      assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get("filter")?.includes("score_categories") ?? false), false,
        "An empty condition row must not apply a filter");
      await capture({ targets: [{ component: "MultiSelect", state: "empty" }, { component: "Combobox", state: "default" }, { component: "Combobox", state: "empty" }],
        theme, width: 1440, viewport, url: `${origin}/traces`, found,
        interaction: "Actual pinned MultiSelectInput, closed with no value (placeholder \"Select\"), in a client-side Categorical Scores condition row; no value chosen, no filter applied." });
      // Closed with one value: choosing a value applies a client-side view filter (a read query, no write).
      await page.evaluate(selector => document.querySelector(selector).focus(), found.selector);
      await press(page, "Enter");
      await ready(page, "[data-radix-popper-content-wrapper] [cmdk-item]");
      await quiet();
      const value = await page.evaluate(() => {
        const items = [...document.querySelectorAll("[data-radix-popper-content-wrapper] [cmdk-item]")].filter(n => n.checkVisibility());
        return { items: items.map(n => n.textContent.trim().slice(0, 30)), highlighted: items.findIndex(n => n.dataset.selected === "true") };
      });
      const target = value.items.findIndex(text => text !== "Select All");
      assert.ok(target >= 0, `a categorical value: ${JSON.stringify(value)}`);
      for (let step = Math.max(value.highlighted, 0); step < target; step++) await press(page, "ArrowDown");
      await press(page, "Enter");
      await quiet();
      await press(page, "Escape");
      await quiet();
      const selectedFound = await mark("fieldset button[role=combobox]",
        `/^1 selected$/.test(n.textContent.trim()) && n.getAttribute("aria-expanded") === "false" && !n.disabled`);
      assert.ok(selectedFound, `closed MultiSelectInput with one value: ${JSON.stringify(value)}`);
      assert.equal(await page.evaluate(() => !!document.querySelector("[data-radix-popper-content-wrapper]")), false, "value popup closed");
      selectedFound.value = value.items[target];
      await capture({ targets: [{ component: "MultiSelect", state: "selected" }], theme, width: 1440, viewport, url: `${origin}/traces`, found: selectedFound,
        interaction: "Actual pinned MultiSelectInput, closed with one chosen value (selected label), in the same Categorical Scores condition row. Choosing the value applies a client-side view filter (read query); nothing is saved." });
    }
  }
} finally {
  await release();
  await writeFile(`${out}/demo-records-closed.json`, JSON.stringify(rows, null, 2));
  await page._sendToTarget("Fetch.disable").catch(() => {});
  await tabs.closeAll(); await browser.close();
}
assert.ok(blocked.every(entry => /\/api\/project\/[^/]+\/visit$/.test(entry.url)), `Unexpected non-read requests: ${JSON.stringify(blocked)}`);
console.log(`P1_DEMO_CLOSED_RESULT ${rows.length} rows; blocked visit beacons ${blocked.length}`);
