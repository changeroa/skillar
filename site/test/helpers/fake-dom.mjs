// A small jsdom-backed DOM harness for rendering React components under node:test without a browser.
// (Replaces the previous hand-rolled fake DOM, which only supported the old renderer.)

import { JSDOM, VirtualConsole } from "jsdom";
import { FakeEvent } from "./fake-event.mjs";

// Node's own Event/EventTarget, captured before jsdom's globals are installed. Tests also
// build plain node EventTargets as window stand-ins; let those accept jsdom-dispatched events.
const NodeEvent = globalThis.Event;
const NodeEventTarget = globalThis.EventTarget;
export { FakeEvent };

// React evaluates canUseDOM and input-event support once at module load, so a global
// document must exist before react-dom is imported. Install one at module evaluation;
// tests then get fresh documents from installFakeDom as before.
installFakeDom();

/** Installs a fresh jsdom document as the global React renders into and returns it. */
export function installFakeDom() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => {
    // Surface listener exceptions that jsdom would otherwise swallow silently.
    const original = error.detail?.detail ?? error.detail ?? error;
    console.error("jsdom listener error:", original && original.cause ? original.cause.stack : original?.detail?.stack ?? original?.stack ?? original);
  });
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://skillar.sh/skills/",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  // Browsers expose GlobalEventHandlers on Document; jsdom does not. React probes
  // "oninput" in document once to decide its modern change-event path.
  if (!("oninput" in window.document)) {
    Object.defineProperty(window.document, "oninput", { value: null, writable: true, configurable: true });
  }
  // Tests may install their own window/location/history/matchMedia doubles before mounting;
  // only replace globals that are unset or still owned by a previous installFakeDom call.
  const HARNESS = "__skillarHarness";
  const setGlobal = (key, value) => {
    const current = globalThis[key];
    if (current === undefined || current === null || current[HARNESS] === true) {
      try { value[HARNESS] = true; } catch { /* non-extensible */ }
      globalThis[key] = value;
    }
  };
  setGlobal("window", window);
  const globals = ["document", "Element", "Node", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
    "HTMLButtonElement", "HTMLSelectElement", "HTMLAnchorElement", "HTMLFormElement", "SVGElement", "SVGSVGElement",
    "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "CustomEvent", "InputEvent", "FocusEvent",
    "SubmitEvent", "MutationObserver", "navigator", "getComputedStyle", "DocumentFragment", "Text", "Comment",
    "XMLSerializer", "DOMParser", "NodeFilter", "Range", "File", "Blob", "FormData", "CustomEvent",
    "requestAnimationFrame", "cancelAnimationFrame", "Document", "HTMLDialogElement"];
  for (const key of globals) {
    if (window[key] !== undefined) {
      try { globalThis[key] = window[key]; } catch { /* read-only global */ }
    }
  }
  setGlobal("matchMedia", window.matchMedia);
  setGlobal("location", window.location);
  setGlobal("history", window.history);
  // Polyfills for browser APIs jsdom lacks but components and tests touch.
  if (!window.matchMedia) window.matchMedia = query => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  });
  if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  if (window.HTMLDialogElement) {
    if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
    if (!window.HTMLDialogElement.prototype.show) window.HTMLDialogElement.prototype.show = function show() { this.open = true; };
    if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
  // Browsers fire focusin/focusout alongside focus/blur; jsdom's manual dispatch does not.
  const rawDispatch = window.EventTarget.prototype.dispatchEvent;
  window.EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
    const result = rawDispatch.call(this, event);
    if (event.type === "focus") rawDispatch.call(this, new window.FocusEvent("focusin", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    else if (event.type === "blur") rawDispatch.call(this, new window.FocusEvent("focusout", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    // React derives enter/leave from over/out; pair the synthetic enter/leave the way a browser visit does.
    if (/^mouseenter$/i.test(event.type)) rawDispatch.call(this, new window.MouseEvent("mouseover", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    else if (/^mouseleave$/i.test(event.type)) rawDispatch.call(this, new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    else if (/^pointerenter$/i.test(event.type)) rawDispatch.call(this, new window.PointerEvent("pointerover", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    else if (/^pointerleave$/i.test(event.type)) rawDispatch.call(this, new window.PointerEvent("pointerout", { bubbles: true, relatedTarget: event.relatedTarget ?? null }));
    return result;
  };
  // Record listener registrations so tests can inspect what a component wired up.
  const originalAdd = window.EventTarget.prototype.addEventListener;
  const originalRemove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
    if (listener) {
      this.listeners = this.listeners ?? [];
      this.listeners.push({ type, listener, capture: options === true || (options && options.capture === true) });
    }
    return originalAdd.call(this, type, listener, options);
  };
  window.EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
    const capture = options === true || (options && options.capture === true);
    if (this.listeners) this.listeners = this.listeners.filter(
      entry => !(entry.type === type && entry.listener === listener && entry.capture === capture));
    return originalRemove.call(this, type, listener, options);
  };
  for (const name of ["every", "map", "filter", "some", "find", "reduce", "flatMap", "at"]) {
    if (!window.HTMLCollection.prototype[name]) {
      window.HTMLCollection.prototype[name] = function (...args) { return Array.prototype[name].apply([...this], args); };
    }
  }
  // File inputs: jsdom enforces the browser's no-programmatic-files rule; tests replace selections.
  const probeInput = window.document.createElement("input");
  probeInput.type = "file";
  const emptyFileList = probeInput.files;
  Object.defineProperty(window.HTMLInputElement.prototype, "files", {
    get() { return this._mockFiles ?? emptyFileList; },
    set(value) { this._mockFiles = value; },
    configurable: true,
  });
  const valueDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  Object.defineProperty(window.HTMLInputElement.prototype, "value", {
    get() {
      if (this.type === "file" && this._mockValue !== undefined) return this._mockValue;
      return valueDescriptor.get.call(this);
    },
    set(value) {
      if (this.type === "file") { this._mockValue = String(value); return; }
      this._mockValue = undefined;
      valueDescriptor.set.call(this, value);
    },
    configurable: true,
  });
  for (const name of ["every", "map", "filter", "some", "find", "reduce", "flatMap"]) {
    if (!window.NodeList.prototype[name]) {
      window.NodeList.prototype[name] = function (...args) { return Array.prototype[name].apply([...this], args); };
    }
  }
  if (!window.NodeList.prototype.at) window.NodeList.prototype.at = function at(index) {
    return this[index < 0 ? this.length + index : index] ?? undefined;
  };
  if (!window.NamedNodeMap.prototype.keys) {
    window.NamedNodeMap.prototype.keys = function* keys() { for (let i = 0; i < this.length; i++) yield this[i].name; };
    window.NamedNodeMap.prototype.values = function* values() { for (let i = 0; i < this.length; i++) yield this[i].value; };
    window.NamedNodeMap.prototype.entries = function* entries() { for (let i = 0; i < this.length; i++) yield [this[i].name, this[i].value]; };
  }
  if (NodeEventTarget && !NodeEventTarget.prototype.__skillarCrossRealm) {
    const originalDispatch = NodeEventTarget.prototype.dispatchEvent;
    NodeEventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
      if (NodeEvent && !(event instanceof NodeEvent)) {
        const converted = new NodeEvent(event.type, { bubbles: event.bubbles, cancelable: event.cancelable });
        for (const key of Object.getOwnPropertyNames(event)) {
          if (key === "type" || key === "target" || key === "currentTarget" || key === "srcElement" || key === "eventPhase" || key === "defaultPrevented" || key === "bubbles" || key === "cancelable" || key === "timeStamp" || key === "isTrusted" || key === "NONE" || key === "AT_TARGET" || key === "BUBBLING_PHASE" || key === "CAPTURING_PHASE") continue;
          try { converted[key] = event[key]; } catch { /* read-only */ }
        }
        const result = originalDispatch.call(this, converted);
        if (converted.defaultPrevented) event.preventDefault();
        return result;
      }
      return originalDispatch.call(this, event);
    };
    NodeEventTarget.prototype.__skillarCrossRealm = true;
  }
  return window.document;
}

/** Every element under root (root included) matching the predicate, in document order. */
export function all(root, predicate) {
  const out = [];
  const walk = node => {
    if (node.nodeType !== 1) return;
    if (predicate(node)) out.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

export function byTag(root, localName) {
  return all(root, node => node.localName === localName);
}

export function classed(root, className) {
  return all(root, node => (node.getAttribute("class") ?? "").split(/\s+/).includes(className));
}

export function buttonNamed(root, label) {
  return all(root, node => node.localName === "button" && node.textContent === label);
}

/** Resolves once the predicate holds after a DOM mutation; rejects when the bounded wait runs out. */
export function waitFor(document, predicate, description, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const observer = new (document.defaultView.MutationObserver)(() => queueMicrotask(check));
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      complete(value);
    };
    const check = () => {
      if (settled) return;
      const value = predicate();
      if (value) finish(resolve, value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`Timed out waiting for ${description}.`)), timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    check();
  });
}
