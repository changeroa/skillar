import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { observePaint, paintChannels, availablePaint } from "./widget-paint.mjs";
import { normalizeComponentStyle } from "./component-style.mjs";
const draft = Boolean(process.env.INTERACTION_PAINT_DRAFT);
const inventory = draft ? null : JSON.parse(await readFile(new URL("./local-interaction-paint-inventory.json", import.meta.url), "utf8"));
export const interactionPaintCases = inventory ? Object.keys(inventory.cases) : [];

export async function measureInteractionPaint(page, context) {
  const required = inventory?.templates[inventory.cases[context.id]];
  if (!draft) assert.ok(required, `Missing fixed interaction inventory ${context.id}`);
  return page.evaluate(({ context, required, draft, observer, channels, availability, normalizer }) => {
    const rawObserve = (0, eval)(`(${observer})`), channelList = (0, eval)(`(${channels})`);
    const available = (0, eval)(`(${availability})`);
    const normalize = (0, eval)(`(${normalizer})`);
    const observe = node => {
      const paint = rawObserve(node);
      return { ...paint, fontWeight: getComputedStyle(node).fontWeight,
        pseudo: Object.fromEntries(Object.entries(paint.pseudo).map(([key, value]) =>
          [key, { ...value, boxShadow: getComputedStyle(node, `::${key}`).boxShadow }])) };
    };
    const root = document.querySelector(context.selector);
    if (!root) throw Error("Missing interaction root");
    const nodes = () => [root, ...root.querySelectorAll("*")];
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const rgba = css => {
      if (!CSS.supports("color", css)) throw Error(`Missing independent source color ${css}`);
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const sourcePart = node => context.component === "SessionSort" && node.localName === "span" ? context.sources["table-header-label"] :
      node.closest(".trace-event-row__summary,time") ? context.sources["tree-time"] :
      node.closest(".trace-event-row__kind") ? context.sources[root.getAttribute("aria-selected") === "true" ? "tree-label" : "tree-label-default"] :
      node.matches(".pe-muted") ? context.sources["tree-time"] : null;
    const kind = root.dataset.eventKind;
    const category = ["prompt", "skill_span", "native_skill"].includes(kind) ? "span" :
      kind === "llm_call" ? "generation" : kind === "search" ? "retriever" :
      ["load", "tool_call", "read_file"].includes(kind) ? "tool" : kind === "error" ? "guardrail" : "event";
    const colorFor = node => {
      const part = sourcePart(node);
      if (part) return rgba(part.styles.color);
      if (node.closest("svg") && ["Tree", "Timeline"].includes(context.component)) {
        return rgba(context.palette[`--observation-${category}-line`]);
      }
      return context.expected.color;
    };
    const author = () => {
      const all = nodes(), parts = [];
      const glyph = context.reference.parts?.find(p => ["path", "circle", "line"].includes(p.tag))?.paint ??
        context.sources["tree-icon"].paint;
      const base = context.reference.parts?.[0]?.paint ?? context.sources["tree-icon"].paint;
      for (const [index, node] of all.entries()) {
        const actual = observe(node), painted = channelList(node, actual);
        if (!actual.visible || !painted.length) continue;
        const paint = { opacity: node === root ? context.expected.opacity : "1",
          effectiveOpacity: Number(context.expected.opacity), fillOpacity: base.fillOpacity,
          strokeOpacity: base.strokeOpacity, dash: context.expected.strokeDasharray };
        const color = colorFor(node), part = sourcePart(node);
        const text = [...node.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (text) Object.assign(paint, { fontSize: part?.styles.fontSize ?? context.expected.fontSize,
          lineHeight: part?.styles.lineHeight ?? context.expected.lineHeight,
          fontWeight: part?.styles.fontWeight ?? context.expected.fontWeight });
        for (const field of painted) {
          if (field === "color" || field === "stroke") paint[field] = color;
          else if (field === "fill") paint.fill = node.getAttribute("fill") === "currentColor" ||
            node.closest("svg")?.getAttribute("fill") === "currentColor" ? color : glyph.fill;
          else if (field === "backgroundColor" && node === root) paint.backgroundColor = context.expected.backgroundColor;
          else if (field === "backgroundColor" && node.matches(".event-gantt-bar,.event-gantt-point"))
            paint.backgroundColor = rgba(context.palette[`--observation-${category}`]);
          else if (/^border.*Color$/.test(field) && node === root) {
            const side = field === "borderColor" ? "borderTop" : field.replace("Color", "");
            paint[field] = context.expected[`${side}Color`];
            paint[field.replace("Color", "Width")] = context.expected[`${side}Width`];
          } else if (field === "borderBottomColor" && node.matches(".event-gantt-track")) {
            paint.borderBottomColor = context.expected.borderBottomColor;
            paint.borderBottomWidth = context.sources.card.styles.borderTopWidth;
          } else if (field === "boxShadow" && node === root) paint.boxShadow = actual.boxShadow;
          else if (field === "boxShadow" && node.matches(".event-gantt-bar,.event-gantt-point")) {
            const source = context.sources["bar-selected"].styles;
            if (JSON.stringify(normalize(source, source.height).boxShadow) !==
              JSON.stringify(normalize({ ...source, boxShadow: actual.boxShadow }, source.height).boxShadow))
              throw Error(`Timeline selection ring differs ${context.id}`);
            paint.boxShadow = actual.boxShadow;
          }
          else if (field.startsWith("pseudo:") && node === root) {
            paint.pseudo = structuredClone(actual.pseudo);
            for (const [key, pseudo] of Object.entries(paint.pseudo)) {
              const ink = context.component === "JsonViewer" && key === "before" ?
                rgba(context.sources["tree-time"].styles.color) : color;
              if (JSON.stringify(pseudo.color) !== JSON.stringify(ink))
                throw Error(`Unproved native pseudo ink ${context.id} ${key}`);
              const thumb = context.component === "EventViewTabs" && key === "before";
              const background = thumb ? context.indicator?.paint.backgroundColor : ink;
              if (pseudo.opacity !== "1" || (Array.isArray(pseudo.backgroundColor) &&
                pseudo.backgroundColor[3] > 0 && JSON.stringify(pseudo.backgroundColor) !== JSON.stringify(background)))
                throw Error(`Unproved native pseudo paint ${context.id} ${key}`);
              const shadow = thumb ? context.indicator?.styles.boxShadow : "none";
              if (JSON.stringify(normalize({ ...context.reference.styles, boxShadow: pseudo.boxShadow }, "auto").boxShadow) !==
                JSON.stringify(normalize({ ...context.reference.styles, boxShadow: shadow }, "auto").boxShadow))
                throw Error(`Unproved native pseudo shadow ${context.id} ${key}`);
            }
          } else throw Error(`Unmapped painted descendant ${context.id} ${index} ${field}`);
        }
        if (painted.includes("stroke")) paint.strokeWidth = glyph.strokeWidth;
        const expected = { index, tag: node.localName, class: node.getAttribute("class"),
          channels: painted, text, marker: actual.listStyleType, paint };
        if (!available(actual, expected))
          throw Error(`Source descendant mismatch ${context.id} ${index}: ${JSON.stringify({ actual, expected })}`);
        parts.push(expected);
      }
      if (!parts.length) throw Error(`No painted interaction parts ${context.id}`);
      return { nodeCount: all.length, parts };
    };
    const fixed = required ?? author();
    const inspect = () => {
      const all = nodes(), values = [];
      const membership = all.length === fixed.nodeCount;
      for (const expected of fixed.parts) {
        const node = all[expected.index], actual = node ? observe(node) : null;
        values.push({ index: expected.index, pass: Boolean(node) && node.localName === expected.tag &&
          node.getAttribute("class") === expected.class && available(actual, expected) &&
          JSON.stringify(channelList(node, actual)) === JSON.stringify(expected.channels), actual });
      }
      const extras = all.flatMap((node, index) => {
        const paint = observe(node);
        return paint.visible && channelList(node, paint).length && !fixed.parts.some(p => p.index === index) ? [index] : [];
      });
      return { pass: membership && !extras.length && values.every(v => v.pass), membership, extras, values };
    };
    const baseline = inspect(), mutations = [], childPathProbes = [];
    if (!baseline.pass) return { pass: false, baseline, mutations, childPathProbes };
    if (draft) return { pass: true, baseline, required: fixed, mutations, childPathProbes };
    const originalNodes = nodes();
    for (const part of fixed.parts) {
      const node = originalNodes[part.index];
      const probes = [["opacity", ".37"], ["fill-opacity", ".39"], ["stroke-opacity", ".41"],
        ["stroke-dasharray", "7px, 3px"], ...(part.channels.includes("stroke") ? [["stroke-width", "19px"]] : []),
        ...(node === root ? [] : [["display", "none"], ["visibility", "hidden"]]),
        ...part.channels.filter(c => !c.startsWith("pseudo:")).map(c => [
          c.replace(/[A-Z]/g, v => `-${v.toLowerCase()}`), ["boxShadow", "backgroundImage", "fill", "stroke"].includes(c) ? "none" : "transparent"])];
      for (const [property, value] of probes) {
        const old = node.getAttribute("style");
        const parentStyle = node.localName === "path" && context.state === "hover" ?
          JSON.stringify([...getComputedStyle(root)].map(f => [f, getComputedStyle(root).getPropertyValue(f)])) : null;
        let corrupted;
        try {
          node.style.setProperty(property, value, "important");
          corrupted = inspect();
          mutations.push({ index: part.index, property, applied: old !== node.getAttribute("style"), rejected: !corrupted.pass });
          if (node.localName === "path" && property === "display" && context.state === "hover")
            childPathProbes.push({ index: part.index, hover: root.matches(":hover"), hidden: !observe(node).visible,
              parentFieldsUnchanged: parentStyle === JSON.stringify([...getComputedStyle(root)].map(f => [f, getComputedStyle(root).getPropertyValue(f)])),
              rejected: !corrupted.pass });
        } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
        if (!inspect().pass) throw Error(`Interaction did not restore ${context.id} ${part.index} ${property}`);
      }
      for (const channel of part.channels.filter(c => c.startsWith("pseudo:"))) {
        const style = document.createElement("style");
        node.dataset.interactionPaintProbe = "";
        style.textContent = `[data-interaction-paint-probe]::${channel.slice(7)}{content:none!important;display:none!important}`;
        try {
          document.head.append(style);
          mutations.push({ index: part.index, property: channel, applied: true, rejected: !inspect().pass });
        } finally { style.remove(); delete node.dataset.interactionPaintProbe; }
        if (!inspect().pass) throw Error(`Pseudo part did not restore ${context.id} ${part.index}`);
      }
      if (node !== root) {
        const parent = node.parentNode, next = node.nextSibling;
        try { node.remove(); mutations.push({ index: part.index, property: "remove", applied: true, rejected: !inspect().pass }); }
        finally { parent.insertBefore(node, next); }
        if (!inspect().pass) throw Error(`Removed part did not restore ${context.id} ${part.index}`);
      }
    }
    return { pass: mutations.every(p => p.applied && p.rejected) &&
      childPathProbes.every(p => p.hover && p.hidden && p.parentFieldsUnchanged && p.rejected),
      baseline, mutations, childPathProbes };
  }, { context, required, draft, observer: observePaint.toString(), channels: paintChannels.toString(),
    availability: availablePaint.toString(), normalizer: normalizeComponentStyle.toString() });
}
