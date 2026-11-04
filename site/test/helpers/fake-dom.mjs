// A deliberately small DOM for rendering Preact components under node:test without a browser.
// It implements what Preact 10 touches (createElementNS, createTextNode, insertBefore, removeChild,
// nextSibling, childNodes, data, attributes, event listeners) plus focus, click, keyboard and input
// dispatch, so interaction contracts can be asserted. Layout and CSS are out of scope.

const XHTML = "http://www.w3.org/1999/xhtml";
const FORM_CONTROLS = new Set(["button", "input", "textarea", "select"]);
const FOCUSABLE = new Set(["button", "input", "textarea", "select", "a", "summary"]);
const HANDLER_PROPERTIES = ["onclick", "oninput", "onkeydown", "onkeyup", "onchange", "onsubmit", "onfocus", "onblur"];

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.key = init.key ?? "";
    this.target = null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class FakeNode {
  constructor(document, nodeType) {
    this.ownerDocument = document;
    this.nodeType = nodeType;
    this.parentNode = null;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }
  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }
}

class FakeText extends FakeNode {
  constructor(document, data) {
    super(document, 3);
    this.dataValue = String(data);
  }
  get data() { return this.dataValue; }
  set data(value) {
    this.dataValue = String(value);
    this.ownerDocument.changed();
  }
  get textContent() { return this.dataValue; }
}

class FakeElement extends FakeNode {
  constructor(document, localName) {
    super(document, 1);
    this.localName = localName;
    this.namespaceURI = XHTML;
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = [];
    this.style = {};
    this.id = "";
    this.hidden = false;
    for (const name of HANDLER_PROPERTIES) this[name] = null;
    if (FORM_CONTROLS.has(localName)) {
      this.disabled = false;
      this.value = "";
      this.name = "";
      this.type = localName === "button" ? "submit" : "text";
    }
    if (localName === "input" || localName === "textarea") {
      this.checked = false;
      this.readOnly = false;
      this.spellcheck = true;
      this.autocomplete = "";
      this.autocapitalize = "";
      this.placeholder = "";
      this.rows = 2;
    }
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (reference && index === -1) throw new Error("insertBefore: the reference node is not a child.");
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    this.ownerDocument.changed();
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index === -1) throw new Error("removeChild: the node is not a child.");
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    const active = this.ownerDocument.activeElement;
    if (active === node || (node.nodeType === 1 && node.contains(active))) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.ownerDocument.changed();
    return node;
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) {
    this.attributes.set(name.toLowerCase(), String(value));
    this.ownerDocument.changed();
  }
  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
    this.ownerDocument.changed();
  }
  getAttribute(name) {
    const key = name.toLowerCase();
    if (this.attributes.has(key)) return this.attributes.get(key);
    return key === "id" && this.id !== "" ? this.id : null;
  }
  hasAttribute(name) { return this.attributes.has(name.toLowerCase()); }
  addEventListener(type, listener, options = false) {
    this.listeners.push({ type, listener, capture: options === true || options?.capture === true });
  }
  removeEventListener(type, listener, options = false) {
    const capture = options === true || options?.capture === true;
    this.listeners = this.listeners.filter(entry => !(entry.type === type && entry.listener === listener && entry.capture === capture));
  }
  invoke(event, capture) {
    event.currentTarget = this;
    for (const entry of [...this.listeners]) {
      if (entry.type === event.type && entry.capture === capture) entry.listener.call(this, event);
    }
  }
  dispatchEvent(event) {
    event.target = this;
    const path = [];
    for (let node = this; node && node.nodeType === 1; node = node.parentNode) path.push(node);
    for (const node of [...path].reverse()) {
      if (event.propagationStopped) break;
      node.invoke(event, true);
    }
    for (const node of path) {
      if (event.propagationStopped) break;
      node.invoke(event, false);
      if (!event.bubbles) break;
    }
    return !event.defaultPrevented;
  }
  /** Like a browser: disabled and detached controls cannot take focus, and only focusable elements do. */
  focus() {
    if (this.disabled === true || !this.isConnected) return;
    if (!FOCUSABLE.has(this.localName) && !this.attributes.has("tabindex")) return;
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  /** Like a browser: a disabled control swallows the click and no listener runs. */
  click() {
    if (this.disabled === true) return;
    this.dispatchEvent(new FakeEvent("click"));
  }
}

class FakeDocument {
  constructor() {
    this.nodeType = 9;
    this.parentNode = null;
    this.mutationListeners = new Set();
    this.documentElement = new FakeElement(this, "html");
    this.documentElement.parentNode = this;
    this.body = new FakeElement(this, "body");
    this.documentElement.childNodes.push(this.body);
    this.body.parentNode = this.documentElement;
    this.activeElement = this.body;
  }
  createElement(localName) { return new FakeElement(this, localName.toLowerCase()); }
  createElementNS(_namespace, localName) { return new FakeElement(this, localName.toLowerCase()); }
  createTextNode(data) { return new FakeText(this, data); }
  getElementById(id) { return all(this.documentElement, node => node.id === id)[0] ?? null; }
  changed() {
    for (const listener of [...this.mutationListeners]) listener();
  }
  onMutation(listener) {
    this.mutationListeners.add(listener);
    return () => this.mutationListeners.delete(listener);
  }
}

/** Installs a fresh document as the global Preact renders into and returns it. */
export function installFakeDom() {
  const document = new FakeDocument();
  globalThis.document = document;
  return document;
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
    let unsubscribe = () => {};
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      complete(value);
    };
    const check = () => {
      if (settled) return;
      const value = predicate();
      if (value) finish(resolve, value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`Timed out waiting for ${description}.`)), timeoutMs);
    unsubscribe = document.onMutation(() => queueMicrotask(check));
    check();
  });
}
