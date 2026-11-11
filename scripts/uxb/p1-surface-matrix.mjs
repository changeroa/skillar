import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { applyViewport } from "./viewport.mjs";
import { arm, ready, signal } from "./trusted-keys.mjs";
import { mountHostedEmbed } from "./mount-hosted-embed.mjs";
import { P1_SURFACES as specs } from "./p1-surfaces.mjs";

const [out] = process.argv.slice(2);
// Before (b8b1d62) and the merged PR-7 toolbar/alert markup: the refresh control is the
// first outline Button and analysis failures render in the shared Alert.
const refreshButton = ".analysis-refresh:not(:disabled), .analysis-toolbar > button.lf-button--outline:first-of-type:not(:disabled)";
const alertRegion = ":is(.notice,.lf-alert)[role=alert]";
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank"), page = tab.page;
const selected = process.env.P1_SURFACES?.split(",");
const rows = selected
  ? JSON.parse(await readFile(`${out}/surface-matrix.json`, "utf8")).rows.filter(row => !selected.includes(row.name))
  : [];
await mkdir(`${out}/surfaces`, { recursive: true });

async function clickText(text, scope = "button") {
  const selector = await page.evaluate(({ text, scope }) => {
    const node = [...document.querySelectorAll(scope)].find(n => n.checkVisibility() && n.textContent.trim() === text);
    if (!node) throw new RangeError(`Missing ${scope}: ${text}`);
    node.dataset.p1Action = "current";
    return '[data-p1-action="current"]';
  }, { text, scope });
  await page.click(selector);
  await page.evaluate(() => document.querySelector('[data-p1-action="current"]')?.removeAttribute("data-p1-action"));
}
async function prepare(spec) {
  if (spec.surface) {
    if (spec.surface === "hosted-embed") await mountHostedEmbed(page);
    await ready(page, ".pe-sessions-region [data-session-id]");
    if (["trace", "attributes", "tool-args"].includes(spec.view)) {
      const session = spec.view === "tool-args" ? "ses_ac514fa3a9"
        : await page.evaluate(() => document.querySelector("[data-session-id]").dataset.sessionId);
      await page.evaluate(id => { location.hash = `#/sessions/${id}`; }, session);
      await ready(page, ".trace-event-row");
      if (spec.view === "tool-args") {
        await page.evaluate(() => {
          const row = [...document.querySelectorAll(".trace-event-row")].find(n => n.textContent.includes("tool: Bash"));
          if (!row) throw new RangeError("Missing seeded Bash tool row");
          row.dataset.p1Tool = "";
        });
        await page.click("[data-p1-tool]");
        await ready(page, ".event-inspector:not([hidden]) .tl__args summary");
        await page.click(".event-inspector:not([hidden]) .tl__args summary");
        await ready(page, ".tl__args pre");
        await page.evaluate(() => document.querySelector(".tl__args").scrollIntoView({ block: "center" }));
        return;
      }
      await arm(page, { kind: "present", selector: ".event-inspector:not([hidden])" });
      await page.click(".trace-event-row"); await signal(page);
      if (spec.view === "attributes") {
        await clickText("속성", ".event-inspector:not([hidden]) [role=tab]");
        await ready(page, ".event-attributes");
      }
    } else if (spec.view !== "sessions") {
      if (spec.surface === "local") await page.evaluate(view => { location.hash = `#/${view}`; }, spec.view);
      else await clickText(({ dashboard: "대시보드", flow: "흐름", workspaces: "작업 공간", heatmap: "활동" })[spec.view],
        ".local-tabs [role=tab]");
      await ready(page, spec.ready);
      await ready(page, refreshButton);
      if (spec.error) {
        await page.evaluate(scenario => {
          if (!["before8.localhost", "after8.localhost"].includes(location.hostname))
            throw new RangeError("Failure scenarios are restricted to the fixture origins");
          document.cookie = `x-qa-scenario=${encodeURIComponent(scenario)}; Path=/; SameSite=Lax`;
        }, spec.scenario);
        await page.click(refreshButton);
        await ready(page, `${alertRegion} details summary`);
        await page.click(`${alertRegion} details summary`);
        await ready(page, `${alertRegion} pre`);
        await page.evaluate(selector => document.querySelector(selector).scrollIntoView({ block: "center" }), alertRegion);
      }
    }
    return;
  }
  switch (spec.action) {
    case undefined: return;
    case "account-avatar":
      if (await page.evaluate(() => innerWidth === 390)) {
        await arm(page, { kind: "attribute", selector: "#app-menu", attribute: "aria-expanded", value: "true" });
        await page.click("#app-menu");
        await signal(page);
      }
      await ready(page, "#user-avatar,#user-picture");
      return;
    case "raw":
      await clickText("Raw", ".skill-document-preview [role=tab]");
      await ready(page, ".skill-document-preview pre");
      return;
    case "editor":
      await page.click(".skill-editor-disclosure summary");
      await ready(page, ".skill-editor-disclosure textarea");
      return;
    case "commands":
    case "commands-eval": {
      await mountHostedEmbed(page);
      await page.click(".snapshot__inspector > summary");
      await ready(page, ".commands summary");
      await page.click(".commands summary");
      if (spec.action === "commands-eval") {
        await page.evaluate(() => {
          const select = document.querySelector(".command-form select");
          select.value = "eval.add"; select.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      await ready(page, ".commands textarea");
      await page.evaluate(() => document.querySelector(".commands").scrollIntoView({ block: "start" }));
      return;
    }
    case "consent":
    case "consent-backfill": {
      await page.click("#dashboard-management > summary");
      await page.evaluate(() => {
        const summary = [...document.querySelectorAll("summary")].find(n => /업로드 동의/.test(n.textContent));
        if (!summary) throw new RangeError("Missing consent disclosure");
        summary.dataset.p1Consent = "";
      });
      await page.click("[data-p1-consent]");
      await ready(page, ".consent");
      if (spec.action === "consent-backfill") {
        await page.click('.consent label:has(input[value="managed-content"])');
        await page.click(".consent__history summary");
        await page.click(".consent__history label:has(input[type=checkbox])");
        await ready(page, ".consent__history input[type=datetime-local]");
      }
      await page.evaluate(backfill => document.querySelector(backfill
        ? ".consent__history input[type=datetime-local]" : ".consent").scrollIntoView({ block: backfill ? "center" : "start" }),
      spec.action === "consent-backfill");
      return;
    }
    case "device-grant":
      await page.click("#dashboard-management > summary");
      await clickText("기기 연결", ".connect button");
      await ready(page, ".connect pre");
      await page.evaluate(() => document.querySelector(".connect").scrollIntoView({ block: "start" }));
      return;
    case "skill-toast":
      await clickText("ID 복사", ".skill-peek-actions button");
      await ready(page, ".ui-toast,.lf-toast");
      return;
    default: throw new RangeError(`Unknown surface action: ${spec.action}`);
  }
}

try {
  for (const spec of specs.filter(spec => !selected || selected.includes(spec.name)))
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const version of ["before", "after"]) {
      const row = { name: spec.name, version, width, theme };
      try {
        const port = spec.surface === "local" ? 5182 : 5181;
        const route = spec.surface ? spec.surface === "local" ? "/#/sessions" : "/dashboard/" : spec.route;
        const origin = `http://${version}8.localhost:${port}`;
        for (const name of ["qa-client", "x-qa-scenario"])
          await page._sendToTarget("Network.deleteCookies", { name, url: origin });
        await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
        await tabs.repin(tab, { width, height: width === 390 ? 844 : 900 });
        await applyViewport(page, { width, height: width === 390 ? 844 : 900,
          deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390, coarse: width === 390 });
        await ready(page, spec.surface ? spec.surface === "local" ? ".pe-sessions-region [data-session-id]" : ".dash-source-picker summary" : spec.ready);
        await prepare(spec);
        await page.evaluate(async theme => {
          document.documentElement.dataset.theme = theme;
          await document.fonts.ready;
          for (const animation of document.getAnimations()) {
            if (typeof animation.currentTime !== "number") animation.pause();
            else if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish();
            else { animation.pause(); animation.currentTime = 0; }
          }
        }, theme);
        row.metrics = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
          code: document.querySelectorAll(".lf-codeblock").length,
          nativeDates: document.querySelectorAll('input[type="datetime-local"]').length,
          dateBoxes: [...document.querySelectorAll('input[type="datetime-local"]')].map(node => {
            const box = node.getBoundingClientRect(), css = getComputedStyle(node);
            return { top: box.top, bottom: box.bottom, fontSize: css.fontSize, padding: [css.paddingLeft, css.paddingRight] };
          }),
          url: location.href, assets: [...document.scripts].map(n => n.src).filter(Boolean),
          embedResources: performance.getEntriesByType("resource").map(n => n.name)
            .filter(url => url.includes("/ui/local-dashboard/")),
          embedMounted: !!document.querySelector(".dash-embed [role=tabpanel]"),
          embedTabs: document.querySelectorAll(".local-tabs [role=tab]").length,
          selectedSources: document.querySelectorAll('.dash-source-picker .source[aria-current="true"]').length,
          standalonePaletteTriggers: document.querySelectorAll("#pe-command-jump").length,
          invalidSvg: [...document.querySelectorAll("svg,svg *")].filter(n => n.namespaceURI !== "http://www.w3.org/2000/svg").length,
          owned: [...document.querySelectorAll("button.lf-button,button.lf-icon-button,.lf-select-wrap,input[type=datetime-local].lf-input,.lf-combobox__input,.lf-radio,.lf-switch,textarea.lf-textarea")]
            .filter(n => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).map(n => ({
              tag: n.tagName, class: n.className, multiline: n.matches("textarea"),
              height: n.getBoundingClientRect().height,
            })),
          components: Object.fromEntries(Object.entries({
            Avatar: ".lf-avatar", Textarea: ".lf-textarea", Combobox: ".lf-combobox__control",
            Switch: ".lf-switch", Radio: ".lf-radio", Toast: ".lf-toast", Spinner: ".lf-spinner",
            CodeBlock: ".lf-codeblock", MarkdownViewer: ".lf-markdown", DiffViewer: ".lf-diff-scroll",
            DateRangeInput: ".lf-date-range", DateRangeFields: "input[type=datetime-local].lf-input", TimePeriodSelect: ".lf-time-period",
          }).map(([name, selector]) => [name, [...document.querySelectorAll(selector)].filter(n => n.checkVisibility()).length])),
        }));
        assert.equal(row.metrics.width, width);
        assert.equal(row.metrics.overflow, false);
        assert.equal(row.metrics.invalidSvg, 0);
        if (spec.action === "consent-backfill") {
          assert.equal(row.metrics.dateBoxes.length, 2);
          assert.ok(row.metrics.dateBoxes.every(box => box.top >= 44 && box.bottom <= row.metrics.height));
          if (version === "after") for (const box of row.metrics.dateBoxes) {
            assert.equal(box.fontSize, "13px"); assert.deepEqual(box.padding, ["12px", "12px"]);
          }
        }
        if (version === "after") for (const target of row.metrics.owned) {
          const expected = width === 390 ? 44 : 32;
          assert.ok(target.multiline ? target.height >= expected : Math.abs(target.height - expected) < .01,
            `${spec.name}: ${target.class} has ${target.height}px; expected ${expected}px`);
        }
        if (spec.surface === "hosted-embed") {
          assert.equal(row.metrics.embedMounted, true);
          assert.equal(row.metrics.embedTabs, 4);
          assert.equal(row.metrics.selectedSources, 1);
          assert.equal(row.metrics.standalonePaletteTriggers, 0);
        }
        row.file = `${out}/surfaces/${spec.name}-${version}-${width}-${theme}.png`;
        await page.screenshot({ path: row.file });
        row.scrollEnds = await page.evaluate(async () => {
          const containers = [...document.querySelectorAll("main,main *")].filter(node =>
            node.checkVisibility() && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 &&
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY));
          containers.push(document.scrollingElement);
          for (const node of containers) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
          await new Promise(requestAnimationFrame);
          return containers.map(node => ({ tag: node.tagName, id: node.id, class: node.className,
            top: node.scrollTop, maximum: Math.max(0, node.scrollHeight - node.clientHeight) }));
        });
        assert.ok(row.scrollEnds.every(node => Math.abs(node.top - node.maximum) <= 1), "Actual content must reach its scrolled end");
        row.end = row.file.replace(".png", "-end.png");
        await page.screenshot({ path: row.end });
        row.status = "PASS";
      } catch (error) { row.status = "FAIL"; row.error = String(error); }
      rows.push(row);
      console.log(`P1_SURFACE ${spec.name} ${version} ${width} ${theme} ${row.status}`);
      await writeFile(`${out}/surface-matrix.json`, JSON.stringify({ specs, rows }, null, 2));
    }
} finally {
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_SURFACE_RESULT ${rows.filter(row => row.status === "PASS").length}/${rows.length}`);
process.exitCode = rows.some(row => row.status !== "PASS") ? 1 : 0;
