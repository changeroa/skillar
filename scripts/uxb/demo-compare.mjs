import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "../../site/node_modules/zod/index.js";
import { captureCrop, diffImages } from "./image-diff.mjs";
import { metricFailures } from "./metrics.mjs";
import { ready, press, arm, signal } from "./trusted-keys.mjs";
import { captureClipboardState } from "./clipboard-state.mjs";
import { inspectReferenceImage } from "./reference-pixels.mjs";
import { focusPaint } from "./table-keyboard.mjs";

const [referencesPath, outputPath] = process.argv.slice(2);
if (!referencesPath || !outputPath || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node scripts/uxb/demo-compare.mjs actual-demo-records.json output");
const controlNames = ["Button", "IconButton", "Badge", "StatusBadge", "Tag", "Input",
  "SearchInput", "Select", "Checkbox", "Link", "KeyboardShortcut", "Skeleton", "CopyButton"];
const records = z.array(z.object({
  id: z.string(), control: z.enum(controlNames), theme: z.enum(["light", "dark"]),
  state: z.string(), path: z.string(), url: z.url(), note: z.string(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  styles: z.record(z.string(), z.string()), inputStyles: z.record(z.string(), z.string()).nullable().optional(),
  counterpart: z.record(z.string(), z.unknown()), html: z.string(),
}).passthrough()).parse(JSON.parse(await readFile(referencesPath, "utf8")));
for (const record of records) {
  if (!record.url.startsWith("https://jp.cloud.langfuse.com/project/cmmnj9e9n0006ad06nyz28646"))
    throw Error("Reference is outside the permitted public Demo");
}
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const composition = await tabs.create("about:blank");
const results = [];
const selectors = { Button: "button", IconButton: "button", Badge: ".lf-badge", StatusBadge: ".lf-status",
  Tag: ".lf-tag", Input: "input", SearchInput: ".lf-search", Select: ".lf-select-wrap",
  Checkbox: ".lf-checkbox__box", Link: "a", KeyboardShortcut: "kbd", Skeleton: ".lf-skeleton > div",
  CopyButton: ".lf-copy > button" };
const styleKeys = ["height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily",
  "fontSize", "fontWeight", "lineHeight", "borderRadius", "borderWidth", "borderColor", "color", "backgroundColor", "boxShadow",
  "outlineWidth", "outlineOffset", "outlineStyle", "outlineColor", "opacity"];
function paintedShadow(value) {
  return value.split(/,(?![^(]*\))/).map(v => v.trim())
    .filter(v => !/rgba\([^)]*, 0\)/.test(v)).join(", ") || "none";
}
try {
  const sourceChecks = new Map();
  for (const reference of records) {
    const check = await inspectReferenceImage(composition.page, reference);
    if (!check.pass) throw Error(`Invalid Demo source ${reference.id}-${reference.theme}: ${check.failures.join("; ")}`);
    sourceChecks.set(reference.path, check);
  }
  for (const [app, origin] of [["site", "http://127.0.0.1:5177"], ["local", "http://127.0.0.1:5178"]]) {
    for (const theme of ["light", "dark"]) {
      const tab = await tabs.create("about:blank", { viewport: { width: 1440, height: 900 } });
      const page = tab.page;
      await page._sendToTarget("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" },
      ] });
      await page._sendToTarget("Emulation.setFocusEmulationEnabled", { enabled: true });
      for (const reference of records.filter(r => r.theme === theme)) {
        const url = new URL("/__gallery.html", origin), descriptor = reference.id === "01-button-disabled"
          ? { ...reference.counterpart, icon: "dashboard" } : reference.counterpart;
        url.searchParams.set("demoControl", reference.control);
        url.searchParams.set("theme", theme);
        for (const key of ["label", "variant", "icon", "value", "placeholder", "checked", "disabled", "stretch"])
          if (descriptor[key] !== undefined) url.searchParams.set(key, String(descriptor[key]));
        if (reference.control === "StatusBadge") url.searchParams.set("label", String(descriptor.type));
        if (reference.id === "03-badge-beta") url.searchParams.set("label", "BETA");
        if (reference.id === "03-badge-metric") url.searchParams.set("metric", "true");
        if (reference.control === "Tag") url.searchParams.set("variant", descriptor.icon === "tag" ? "default" : "header");
        if (reference.control === "Select" && !reference.id.includes("native-equivalent")) url.searchParams.set("size", "sm");
        if (reference.state === "disabled") url.searchParams.set("disabled", "true");
        url.searchParams.set("width", String(descriptor.width ?? reference.bounds.width));
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        const selector = `#demo-control ${selectors[reference.control]}`;
        await ready(page, selector);
        await page.evaluate(({ selector, bounds }) => {
          const root = document.getElementById("demo-control"), actual = document.querySelector(selector).getBoundingClientRect();
          root.style.left = `${49 + bounds.x - actual.x}px`;
          root.style.top = `${123 + bounds.y - actual.y}px`;
        }, { selector, bounds: reference.bounds });
        await page.mouse.move(0, 0);
        let restoreClipboard;
        try {
          if (reference.state === "copied") restoreClipboard = await captureClipboardState(page, { selector: ".lf-copy", action: "copied" });
          if (reference.state === "hover" || reference.state === "active") {
            const point = await page.evaluate(selector => {
              const r = document.querySelector(selector).getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }, selector);
            await page.mouse.move(point.x, point.y);
            if (reference.state === "active") await page.mouse.down();
          }
          if (reference.state === "focus-visible") {
            const focus = reference.control === "SearchInput" ? ".lf-search input"
              : reference.control === "Select" ? "select" : reference.control === "Checkbox" ? ".lf-checkbox input" : selector;
            await page.evaluate(selector => document.querySelector(selector).focus(), focus);
            await press(page, "Tab", 8);
            await arm(page, { kind: "focus", selector: focus });
            await press(page, "Tab"); await signal(page);
            if (!await page.evaluate(selector => document.querySelector(selector).matches(":focus-visible"), focus))
              throw Error(`Trusted Tab did not establish visible focus: ${focus}`);
          }
          await page.evaluate(async selector => {
            await Promise.all(document.querySelector(selector).getAnimations({ subtree: true })
              .filter(a => typeof a.effect?.getComputedTiming().duration === "number" && a.effect.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished));
          }, selector);
          const actual = await page.evaluate(({ selector, keys, tokenNames }) => {
            const element = document.querySelector(selector), s = getComputedStyle(element), r = element.getBoundingClientRect();
            const input = element.querySelector("input"), inputRect = input?.getBoundingClientRect();
            return { bounds: { width: r.width, height: r.height },
              styles: Object.fromEntries(keys.map(key => [key, s[key]])),
              inputStyles: input ? Object.fromEntries(keys.map(key => [key, getComputedStyle(input)[key]])) : null,
              inputInsets: inputRect ? { left: inputRect.left - r.left, right: r.right - inputRect.right,
                top: inputRect.top - r.top, bottom: r.bottom - inputRect.bottom } : null,
              tokens: Object.fromEntries(tokenNames.map(name => [name, s.getPropertyValue(`--lf-${name}`).trim()])),
              html: element.outerHTML,
              fontFaces: [...document.fonts].filter(face => face.family.replaceAll('"', "") === "plexMono")
                .map(face => ({ family: face.family, status: face.status, weight: face.weight })) };
          }, { selector, keys: styleKeys, tokenNames: Object.keys(reference.tokens ?? {}) });
          const id = `${app}-${theme}-${reference.id}`, file = join(output, `${id}.png`);
          const shot = await captureCrop(page, selector, { align: false });
          await writeFile(file, Buffer.from(shot.data, "base64"));
          const pixels = await diffImages(composition.page, { reference: reference.path, actual: file,
            sideBySide: join(output, `${id}-side.png`), diff: join(output, `${id}-diff.png`), channelTolerance: 0 });
          const expected = {}, measured = {};
          const textControl = !["IconButton", "Checkbox", "Skeleton", "CopyButton"].includes(reference.control);
          const styleReference = reference.id === "05-select-options"
            ? records.find(r => r.id === "05-select-score-default" && r.theme === reference.theme) : reference;
          const expectedStyles = reference.control === "SearchInput" ? reference.inputStyles : styleReference.styles;
          const actualStyles = reference.control === "SearchInput" ? actual.inputStyles : actual.styles;
          expected.height = styleReference.bounds.height; measured.height = actual.bounds.height;
          for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderRadius", "borderWidth"]) {
            expected[key] = parseFloat(expectedStyles[key]); measured[key] = parseFloat(actualStyles[key]);
          }
          if (textControl) {
            for (const key of ["fontSize", "lineHeight"]) {
              expected[key] = parseFloat(expectedStyles[key]); measured[key] = parseFloat(actualStyles[key]);
            }
            for (const key of ["fontFamily", "fontWeight"]) {
              expected[key] = expectedStyles[key]; measured[key] = actualStyles[key];
            }
          }
          for (const key of ["borderColor", "backgroundColor", ...(textControl ? ["color"] : [])]) {
            expected[key] = expectedStyles[key]; measured[key] = actualStyles[key];
          }
          expected.focusRing = paintedShadow(expectedStyles.boxShadow);
          measured.focusRing = paintedShadow(actualStyles.boxShadow);
          expected.opacity = expectedStyles.opacity; measured.opacity = actualStyles.opacity;
          for (const key of ["outlineWidth", "outlineOffset", "outlineStyle", "outlineColor"]) {
            if (expectedStyles.outlineStyle !== "none" || actualStyles.outlineStyle !== "none") {
              expected[key] = key === "outlineWidth" || key === "outlineOffset" ? parseFloat(expectedStyles[key]) : expectedStyles[key];
              measured[key] = key === "outlineWidth" || key === "outlineOffset" ? parseFloat(actualStyles[key]) : actualStyles[key];
            }
          }
          if (reference.control === "SearchInput") {
            // Both implementations paint the input, not the enclosing shell.
            // Compare the same visual owners and actual text insets, not the
            // incidental inherited font/border of an unpainted wrapper.
            const sourceInput = reference.inputStyles;
            for (const key of ["borderRadius", "borderWidth"])
              expected[key] = parseFloat(sourceInput[key]);
            for (const key of ["borderColor", "backgroundColor", "color"])
              expected[key] = sourceInput[key];
            for (const key of ["fontFamily", "fontWeight"]) {
              expected[key] = sourceInput[key]; measured[key] = actual.inputStyles[key];
            }
            for (const key of ["fontSize", "lineHeight"]) {
              expected[key] = parseFloat(sourceInput[key]); measured[key] = parseFloat(actual.inputStyles[key]);
            }
            for (const [side, key] of [["left", "paddingLeft"], ["right", "paddingRight"],
              ["top", "paddingTop"], ["bottom", "paddingBottom"]]) {
              expected[key] = parseFloat(sourceInput[key]) + parseFloat(sourceInput.borderWidth);
              measured[key] = actual.inputInsets[side] + parseFloat(actual.inputStyles[key]) + parseFloat(actual.inputStyles.borderWidth);
            }
            expected.focusRing = paintedShadow(sourceInput.boxShadow);
          }
          const differences = metricFailures(measured, expected, 1);
          const accessibleField = ["Input", "SearchInput"].includes(reference.control) && reference.state === "focus-visible";
          const hostedFocus = process.env.HOSTED_CASCADE === "1" && app === "site" && reference.state === "focus-visible" &&
            !["Checkbox", "Select"].includes(reference.control);
          const approvedOutline = item => hostedFocus && ["outlineWidth", "outlineOffset", "outlineStyle", "outlineColor"].includes(item.property);
          const approvedDifferences = differences.filter(item => (accessibleField && item.property === "focusRing") || approvedOutline(item))
            .map(item => ({ ...item, reason: "Owner requires contrasting 2px painted focus; hosted controls use the primary-accent outline" }));
          const failures = differences.filter(item => !(accessibleField && item.property === "focusRing") && !approvedOutline(item));
          if (hostedFocus) {
            const target = reference.control === "SearchInput" ? ".lf-search input" :
              reference.control === "Select" ? "select" : reference.control === "Checkbox" ? ".lf-checkbox input" : selector;
            const ring = await focusPaint(page, target);
            const owner = await page.evaluate(selector => {
              const node = document.querySelector(selector), css = getComputedStyle(node);
              const probe = document.createElement("span");
              probe.style.color = "var(--lf-primary-accent)"; node.parentElement.append(probe);
              const color = getComputedStyle(probe).color; probe.remove();
              return { color, width: css.getPropertyValue("--lf-focus-width").trim(), offset: css.getPropertyValue("--lf-focus-offset").trim(), actual: css.outlineColor };
            }, target);
            if (!ring.pass || owner.actual !== owner.color || actualStyles.outlineWidth !== owner.width || actualStyles.outlineOffset !== owner.offset || actualStyles.outlineStyle !== "solid")
              failures.push({ property: "ownerPaintedFocus", expected: owner, actual: ring });
          }
          if (accessibleField && !/ 4px/.test(actualStyles.boxShadow))
            failures.push({ property: "paintedFocusRing", expected: "visible 2px ring outside 2px gap", actual: actualStyles.boxShadow });
          const computedStyleStatus = failures.length ? "FAIL" : approvedDifferences.length ? "OWNER-APPROVED-DIFFERENCE" : "PASS";
          if (textControl && expected.fontFamily.includes("plexMono") && !actual.fontFaces.some(face => face.status === "loaded"))
            throw Error(`The actual Demo mono font did not load: ${id}`);
          const nativePopup = ["expanded", "options"].includes(reference.state);
          results.push({ id, app, control: reference.control, state: reference.state, theme,
            reference: reference.path, file, referenceUrl: reference.url, version: reference.version,
            computedReference: { id: styleReference.id, path: styleReference.path, state: styleReference.state },
            computedStyleStatus, sourceValidation: sourceChecks.get(reference.path), approvedDifferences,
            referenceTokens: reference.tokens, actualTokens: actual.tokens,
            counterpart: descriptor, note: reference.note, actual, expected, measured, failures, pixels,
            fontApplicability: textControl ? "text-bearing control" : "no text painted in this primitive crop",
            styleStatus: failures.length ? "FAIL" : nativePopup ? "NATIVE-ADAPTATION" : computedStyleStatus,
            pixelStatus: pixels.dimensionsMatch && pixels.diffPixels === 0 ? "IDENTICAL" : "DIFFERENT" });
          console.log(`DEMO_PAIR ${id} style=${results.at(-1).styleStatus} pixels=${pixels.rawDiffPixels}`);
        } finally {
          if (reference.state === "active") { await page.mouse.move(0, 0); await page.mouse.up(); }
          if (restoreClipboard) await restoreClipboard();
        }
      }
      await tab.close();
    }
  }
} finally {
  const controls = Object.fromEntries(controlNames.map(control => {
    const pairs = results.filter(r => r.control === control);
    return [control, { comparisons: pairs.length, stylePassed: pairs.filter(r => r.styleStatus === "PASS").length,
      styleFailed: pairs.filter(r => r.styleStatus === "FAIL").length,
      ownerApprovedDifferences: pairs.filter(r => r.styleStatus === "OWNER-APPROVED-DIFFERENCE").length,
      nativeAdaptations: pairs.filter(r => r.styleStatus === "NATIVE-ADAPTATION").length,
      pixelIdentical: pairs.filter(r => r.pixelStatus === "IDENTICAL").length }];
  }));
  await writeFile(join(output, "results.json"), JSON.stringify({ capturedAt: new Date().toISOString(),
    referenceKind: "actual public Langfuse Demo", channelTolerance: 0, geometryTolerance: 1,
    colorRule: "exact computed token color; no numeric color tolerance", controls, results }, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`DEMO_COMPLETE comparisons=${results.length} styleFailures=${results.filter(r => r.styleStatus === "FAIL").length}`);
process.exitCode = results.some(result => result.styleStatus === "FAIL") ? 1 : 0;
