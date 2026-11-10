import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { installFakeDom, FakeEvent } from "./helpers/fake-dom.mjs";
import { act, byTag, loadViews } from "./helpers/t10-dom.mjs";

// The module also initializes page chrome. These absent mounts model a page without that chrome.
globalThis.document = { querySelector: () => null };
globalThis.window = { matchMedia: () => ({ matches: true }) };
const { syncDashboardTabs } = await loadViews('export { syncDashboardTabs } from "./site/src/shell.ts";');
const { mountCommandPalette } = await loadViews('export { mountCommandPalette } from "./site/src/command-palette.tsx";');
delete globalThis.window;
delete globalThis.document;

function fixture() {
  const document = installFakeDom();
  const nav = document.createElement("nav");
  const panel = document.createElement("div");
  const primary = document.createElement("a");
  primary.setAttribute("aria-current", "page");
  const tabs = ["sessions", "workspaces", "flow", "heatmap"].map(view => {
    const tab = document.createElement("a");
    tab.setAttribute("href", `#/${view}?runtime=codex`);
    nav.appendChild(tab);
    return tab;
  });
  nav.querySelectorAll = () => tabs;
  document.body.appendChild(primary);
  document.body.appendChild(nav);
  document.body.appendChild(panel);
  return { nav, panel, tabs, primary };
}

for (const [hash, selected] of [
  ["", 0],
  ["#/sessions", 0],
  ["#/sessions/session-1?runtime=codex", 0],
  ["#/workspaces", 1],
  ["#/workspaces/workspace-1", 1],
  ["#/flow?runtime=codex", 2],
  ["#/heatmap", 3],
  ["#/unknown", 0],
]) {
  test(`embedded dashboard tabs reflect the existing route ${hash || "(default)"}`, () => {
    const { nav, panel, tabs, primary } = fixture();
    tabs[0].setAttribute("aria-current", "page");
    const hrefs = tabs.map(tab => tab.getAttribute("href"));

    syncDashboardTabs(nav, panel, hash);

    assert.equal(nav.getAttribute("role"), "tablist");
    assert.equal(primary.getAttribute("aria-current"), "page");
    assert.deepEqual(tabs.map(tab => tab.getAttribute("aria-current")), [null, null, null, null]);
    assert.deepEqual(tabs.map(tab => tab.getAttribute("aria-selected")), tabs.map((_, i) => String(i === selected)));
    assert.deepEqual(tabs.map(tab => tab.tabIndex), tabs.map((_, i) => i === selected ? 0 : -1));
    assert.deepEqual(tabs.map(tab => tab.getAttribute("href")), hrefs);
    assert.ok(tabs.every(tab => tab.getAttribute("role") === "tab"));
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tabs[selected].id);
    assert.ok(tabs.every(tab => tab.getAttribute("aria-controls") === panel.id));
    assert.equal(new Set(tabs.map(tab => tab.id)).size, tabs.length);
  });
}

test("embedded rerenders do not restore a second current-page navigation item", () => {
  const { nav, panel, tabs } = fixture();
  syncDashboardTabs(nav, panel, "#/sessions");
  tabs[0].setAttribute("aria-current", "page");
  tabs[2].setAttribute("aria-current", "page");

  syncDashboardTabs(nav, panel, "#/flow");
  syncDashboardTabs(nav, panel, "#/flow");

  assert.ok(tabs.every(tab => !tab.hasAttribute("aria-current")));
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(panel.getAttribute("aria-labelledby"), tabs[2].id);
  assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, -1, 0, -1]);
});

test("tab semantics also apply while the embedded view panel is not mounted", () => {
  const { nav, tabs } = fixture();
  syncDashboardTabs(nav, null, "#/heatmap");
  assert.equal(tabs[3].getAttribute("aria-selected"), "true");
  assert.ok(tabs.every(tab => !tab.hasAttribute("aria-current")));
});

async function palette(t, visible = true) {
    const document = installFakeDom();
    const prototype = Object.getPrototypeOf(document.body);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "textContent");
    if (!descriptor.set) Object.defineProperty(prototype, "textContent", {
      get: descriptor.get,
      set(value) {
        for (const child of [...this.childNodes]) this.removeChild(child);
        this.appendChild(this.ownerDocument.createTextNode(value));
      },
      configurable: true,
    });
    document.body.append = child => document.body.appendChild(child);
    const previousHTMLElement = globalThis.HTMLElement;
    globalThis.HTMLElement = document.body.constructor;
    const create = document.createElement.bind(document);
    document.createElement = name => {
      const node = create(name);
      node.append = child => node.appendChild(child);
      node.scrollIntoView = () => {};
      node.querySelector = selector => selector === "input" ? byTag(node, "input")[0] : null;
      node.matches = selector => selector === ":disabled" && node.disabled;
      if (name === "dialog") {
        node.oncancel = null;
        node.showModal = () => { node.open = true; };
        node.close = () => { node.open = false; };
      }
      return node;
    };
    document.createElementNS = (_namespace, name) => document.createElement(name);
    document.querySelector = selector => selector === "#app-command" ? document.getElementById("app-command") : null;
    document.body.classList = { contains: value => value === "app-shell" };
    const window = new EventTarget();
    const navigations = [];
    window.location = { assign: href => navigations.push(href) };
    globalThis.window = window;
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    let cleanup;
    await act(() => { cleanup = mountCommandPalette(opener); });
    opener.focus();
    if (visible) await act(() => opener.click());
    const dialog = byTag(document.body, "dialog")[0], field = dialog ? byTag(dialog, "input")[0] : undefined;
    const options = dialog ? byTag(dialog, "button").filter(node => node.getAttribute("role") === "option") : [];
    t.after(async () => { await act(() => cleanup()); delete globalThis.window; globalThis.HTMLElement = previousHTMLElement; });
    return { document, window, opener, dialog, field, options, navigations,
      remount: () => { cleanup = mountCommandPalette(opener); } };
}

test("remounting retains one renderer and one shortcut subscription", async t => {
  // Given
  const { document,window,remount }=await palette(t,false);
  // When
  await act(()=>remount());
  // Then
  assert.equal(getEventListeners(window,"keydown").length,1);
  assert.equal(document.body.childNodes.filter(node=>node.nodeType===1&&node.getAttribute("data-command-mount")).length,1);
});

for (const modifier of ["metaKey", "ctrlKey"]) {
  test(`command jump opens with ${modifier} and Escape restores the opener`, async t => {
    // Given
    const { document, window, opener } = await palette(t, false);
    // When
    const shortcut = new Event("keydown", { cancelable: true });
    Object.assign(shortcut, { key: "k", [modifier]: true });
    await act(() => window.dispatchEvent(shortcut));
    assert.equal(shortcut.defaultPrevented, true);
    const dialog = byTag(document.body, "dialog")[0];
    // Then
    assert.equal(dialog.open, true);
    assert.equal(document.activeElement, byTag(dialog, "input")[0]);
    assert.equal(byTag(dialog, "input")[0].getAttribute("aria-activedescendant"), "app-command-option-dashboard");
    await act(() => dialog.dispatchEvent(new FakeEvent("cancel")));
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, opener);
  });
}

test("two ArrowDown presses and Enter navigate to the third destination", async t => {
  const { field, navigations, dialog } = await palette(t);
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  assert.equal(field.getAttribute("aria-activedescendant"), "app-command-option-skills");
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  assert.deepEqual(navigations, ["/skills/"]);
  assert.equal(dialog.open, false);
});

test("arrows wrap and Home and End select the visible endpoints", async t => {
  const { field, options } = await palette(t);
  for (const [key, expected] of [
    ["ArrowUp", "account"], ["ArrowDown", "dashboard"], ["End", "account"],
    ["Home", "dashboard"], ["ArrowDown", "sessions"],
  ]) {
    await act(() => field.dispatchEvent(new FakeEvent("keydown", { key })));
    assert.equal(field.getAttribute("aria-activedescendant"), `app-command-option-${expected}`);
    assert.deepEqual(options.filter(option => option.getAttribute("aria-selected") === "true").map(option => option.id), [`app-command-option-${expected}`]);
  }
});

test("filtered Enter and option clicks use the destination URL", async t => {
  const { document, opener, field, navigations } = await palette(t);
  field.value = "스킬";
  await act(() => field.dispatchEvent(new FakeEvent("input")));
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  await act(() => opener.click());
  await act(() => document.getElementById("app-command-option-connections").click());
  assert.deepEqual(navigations, ["/skills/", "/connections/"]);
});

test("Enter with no match or an active IME composition does not navigate", async t => {
  const { field, navigations } = await palette(t);
  const composition = new FakeEvent("keydown", { key: "Enter" });
  composition.isComposing = true;
  await act(() => field.dispatchEvent(composition));
  field.value = "no-match";
  await act(() => field.dispatchEvent(new FakeEvent("input")));
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  assert.deepEqual(navigations, []);
  assert.equal(field.getAttribute("aria-activedescendant"), null);
});
