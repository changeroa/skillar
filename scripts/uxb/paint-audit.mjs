import { observePaint, paintChannels, availablePaint } from "./widget-paint.mjs";
import assert from "node:assert/strict";

export async function verifyPaintObservation(page) {
  const result = await page.evaluate(({ observer, channels }) => {
    const observe = (0, eval)(`(${observer})`), node = document.createElement("span");
    const channelsFor = (0, eval)(`(${channels})`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.textContent = "paint observation contract";
    node.style.cssText = "position:fixed;top:16px;left:16px;width:100px;height:20px;display:block;visibility:visible;opacity:1;color:black;background:white";
    document.body.append(node);
    svg.setAttribute("width", "100"); svg.setAttribute("height", "40");
    svg.innerHTML = '<path d="M0 0H20V20H0Z" fill="black"/><path d="M30 0L50 20" fill="black" stroke="black"/><text x="60" y="20" fill="black" stroke="white" stroke-width="2">T</text>';
    document.body.append(svg);
    try {
      const normal = observe(node).visible;
      node.style.clipPath = "inset(50%)";
      const fullyClipped = observe(node).visible;
      node.style.clipPath = "inset(25%)";
      const partlyClipped = observe(node).visible;
      node.style.clipPath = "none"; node.style.clip = "rect(0px, 0px, 0px, 0px)";
      const legacyClipped = observe(node).visible;
      node.style.clip = "auto"; node.style.boxShadow = "0 0 0 2px oklab(0 0 0 / .8)";
      const color4Shadow = observe(node).shadowPainted;
      const filledPathFill = observe(svg.children[0]).fillPainted, unfilledPathFill = observe(svg.children[1]).fillPainted;
      const textStroke = channelsFor(svg.children[2], observe(svg.children[2])).includes("stroke");
      return { normal, fullyClipped, partlyClipped, legacyClipped, color4Shadow, filledPathFill, unfilledPathFill, textStroke };
    } finally { node.remove(); svg.remove(); }
  }, { observer: observePaint.toString(), channels: paintChannels.toString() });
  assert.deepEqual(result, { normal: true, fullyClipped: false, partlyClipped: true, legacyClipped: false,
    color4Shadow: true, filledPathFill: true, unfilledPathFill: false, textStroke: true });
  return result;
}

/** Run in the browser; each removal is observed before its original style returns. */
export function auditPaint(root, observe, channelsFor, available, required) {
  if (!Array.isArray(required) || !required.length) throw Error("Missing committed paint inventory");
  const stable = document.createElement("style"), inventory = [], probes = [];
  stable.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.append(stable);
  try {
    const nodes = [root, ...root.querySelectorAll("*")];
    for (const expected of required) {
      const { index, tag, channels } = expected, node = nodes[index];
      if (!node || node.localName !== tag) {
        inventory.push({ index, tag, channels, baseline: { pass: false }, missing: true });
        continue;
      }
      const paint = observe(node);
      const baseline = { pass: available(paint, expected) };
      inventory.push({ index, tag: node.localName, class: node.getAttribute("class"), paint, channels, baseline });
      for (const [property, value] of [["opacity", ".37"], ["fill-opacity", ".39"], ["stroke-opacity", ".41"],
        ["stroke-dasharray", "7px, 3px"], ["visibility", "hidden"]]) {
        const old = node.getAttribute("style");
        try {
          node.style.setProperty(property, value, "important");
          probes.push({ index, channel: property, baseline, mutated: { pass: available(observe(node), expected) },
            applied: node.getAttribute("style") !== old });
        } finally { if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old); }
      }
      for (const channel of channels) {
        const old = node.getAttribute("style"), css = document.createElement("style");
        try {
          if (channel.startsWith("pseudo:")) {
            node.setAttribute("data-cert-paint", String(index));
            css.textContent = `[data-cert-paint="${index}"]::${channel.slice(7)}{content:none!important;display:none!important}`;
            document.head.append(css);
          } else node.style.setProperty(channel.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`),
            ["backgroundImage", "boxShadow"].includes(channel) ? "none" : ["stroke", "fill"].includes(channel) ? "none" : "transparent", "important");
          probes.push({ index, channel, baseline, mutated: { pass: available(observe(node), expected) },
            applied: channel.startsWith("pseudo:") ? css.isConnected : node.getAttribute("style") !== old });
        } finally {
          if (old === null) node.removeAttribute("style"); else node.setAttribute("style", old);
          css.remove(); node.removeAttribute("data-cert-paint");
        }
      }
    }
  } finally { stable.remove(); }
  return { inventory, probes };
}

export async function auditPagePaint(page, scope, required) {
  return page.evaluate(({ scope, audit, observer, channels, availability, required }) => {
    const root = document.querySelector(scope);
    if (!root) throw Error(`Missing paint root ${scope}`);
    const parse = source => (0, eval)(`(${source})`);
    return parse(audit)(root, parse(observer), parse(channels), parse(availability), required);
  }, { scope, required, audit: auditPaint.toString(), observer: observePaint.toString(),
    channels: paintChannels.toString(), availability: availablePaint.toString() });
}
