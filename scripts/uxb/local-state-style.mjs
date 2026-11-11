import { readFile } from "node:fs/promises";
import { componentStyleFields, normalizeComponentStyle } from "./component-style.mjs";
import { observePaint } from "./widget-paint.mjs";
import { measurement, mutationVerdict } from "./certification-guards.mjs";
const membership = JSON.parse(await readFile(new URL("./local-state-style-inventory.json", import.meta.url), "utf8")).cases;

export async function measureStateStyles(page, context) {
  const { scope, references, width, theme, caseId, sourceRecords } = context;
  const required = membership[caseId];
  if (!required || !Object.keys(required).length) throw Error(`Missing state style inventory ${caseId}`);
  const reference = (kind, state) => references.find(r => r.id === `mit-${kind}-${state}-${width}-${theme}`);
  const alert = reference("Alert", "error"), status = reference("StatusMessage", "loading"), empty = reference("Empty", "empty");
  const dataBody = sourceRecords.find(r => r.name === "table" && r.width === width &&
    r.theme === theme && r.position === "top").parts.table.styles;
  const cardFrame = sourceRecords.find(r => r.name === "dashboard" && r.width === width &&
    r.theme === theme && r.position === "top").parts.card.styles;
  const fullPanelShape = sourceRecords.find(r => r.name === "peek" && r.width === 1440 &&
    r.theme === theme && r.position === "top").parts.peek.styles;
  const profiles = [
    { selector: ".lf-alert", part: alert?.parts[0] },
    { selector: ".lf-alert__title", part: alert?.parts.find(p => p.tag === "h5") },
    { selector: ".lf-alert__description", part: alert?.parts.find(p => p.tag === "div" && p.class?.startsWith("text-sm ")) },
    { selector: ".lf-status-message[data-level=DEFAULT]", part: status?.parts[0] },
    { selector: ".lf-empty", part: empty?.parts[0] },
    { selector: ".lf-empty__title", part: empty?.parts.find(p => p.tag === "h3") },
    { selector: ".lf-empty__description", part: empty?.parts.find(p => p.tag === "p") },
    { selector: ":scope", nativePanel: [".session-peek", ".workspace-peek"].includes(scope) ? scope : null,
      nativeBody: dataBody, nativeFrame: cardFrame, fullPanelShape,
      part: sourceRecords.find(r => r.name === ([".session-peek", ".workspace-peek"].includes(scope) ? "peek" : "tree") &&
        r.width === width && r.theme === theme && r.position === "top").parts[
          [".session-peek", ".workspace-peek"].includes(scope) ? "peek" : "tree-label"] },
  ].filter(profile => Object.hasOwn(required, profile.selector));
  if (profiles.length !== Object.keys(required).length) throw Error(`Unknown required state profile ${caseId}`);
  const observed = await page.evaluate(({ scope, profiles, observer, normalizer, fields, required, width }) => {
    const observe = (0, eval)(`(${observer})`), normalize = (0, eval)(`(${normalizer})`);
    const root = document.querySelector(scope), values = [], probes = [];
    const stable = document.createElement("style");
    stable.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
    document.head.append(stable);
    try {
      for (const profile of profiles) {
        const nodes = (profile.selector === ":scope" ? [root] : [...root.querySelectorAll(profile.selector)])
          .filter(node => node?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        if (nodes.length !== required[profile.selector])
          throw Error(`Missing required state target ${profile.selector}: ${nodes.length}/${required[profile.selector]}`);
        if (!profile.part) throw Error(`Missing pinned source for ${profile.selector}`);
        for (const [index, node] of nodes.entries()) {
          const expected = normalize(profile.part.styles, profile.part.styles.typedHeight ?? "auto");
          if (profile.nativePanel) {
            const session = profile.nativePanel === ".session-peek";
            expected.height = session && width !== 390 ? "auto" :
              `${innerHeight - (session || width === 390 ? 0 : 48)}px`;
            for (const side of ["Top", "Right", "Bottom", "Left"])
              expected[`border${side}Width`] = width === 390 ? "0px" :
                profile.nativeFrame[`border${side}Width`] ?? profile.nativeFrame.borderTopWidth;
            if (width === 390) expected.borderRadius = profile.fullPanelShape.borderRadius;
            if (!session) Object.assign(expected, { fontSize: profile.nativeBody.fontSize, lineHeight: profile.nativeBody.lineHeight });
          }
          const read = () => normalize(getComputedStyle(node), node.computedStyleMap().get("height").toString());
          const actual = read();
          for (const field of fields) {
            values.push({ selector: profile.selector, index, field, actual: actual[field], expected: expected[field] });
            const old = node.getAttribute("style");
            try {
              if (/^border.*Width$/.test(field)) node.style.setProperty("border-style", "solid", "important");
              if (field.startsWith("outline")) node.style.setProperty("outline", "7px solid rgb(1,2,3)", "important");
              const value = field === "color" || field.endsWith("Color") ? "rgb(1,2,3)" :
                field === "opacity" ? "0.123" : field === "textDecorationLine" ? "underline" :
                field === "textDecorationStyle" ? "wavy" : field === "strokeDasharray" ? "3px, 7px" : field === "fontWeight" ? "900" :
                field === "boxShadow" ? "0 0 0 7px rgb(1,2,3)" : field === "outlineStyle" ? "dashed" : "111px";
              node.style.setProperty(field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value, "important");
              const mutated = read();
              probes.push({ selector: profile.selector, index, field, before: actual,
                actual: mutated, expected, applied: node.getAttribute("style") !== old });
            } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
          }
          for (const field of ["color", "backgroundColor"]) {
            values.push({ selector: profile.selector, index, field, actual: observe(node)[field], expected: profile.part.paint[field] });
          }
        }
      }
    } finally { stable.remove(); }
    return { values, probes };
  }, { scope, profiles, observer: observePaint.toString(), normalizer: normalizeComponentStyle.toString(),
    fields: componentStyleFields, required, width });
  return {
    measurements: observed.values.map(v => ({ ...v, ...measurement(v.actual, v.expected) })),
    mutations: observed.probes.map(p => ({ selector: p.selector, index: p.index, field: p.field,
      ...mutationVerdict({ pass: componentStyleFields.every(f => measurement(p.before[f], p.expected[f]).pass) },
        { pass: measurement(p.actual[p.field], p.expected[p.field]).pass }, p.applied) })),
  };
}
