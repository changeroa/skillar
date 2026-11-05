import assert from "node:assert/strict";
import test from "node:test";
import { installFakeDom, FakeEvent } from "./helpers/fake-dom.mjs";

// The module also initializes page chrome. These absent mounts model a page without that chrome.
globalThis.document = { querySelector: () => null };
globalThis.window = { matchMedia: () => ({ matches: true }) };
const { syncDashboardTabs, bindCommandPalette } = await import("../src/shell.ts");
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

for (const modifier of ["metaKey", "ctrlKey"]) {
  test(`command jump opens with ${modifier}, arrows select, Enter activates, and Escape restores focus`, t => {
    // Given
    const document = installFakeDom();
    document.body.classList = { contains: value => value === "app-shell" };
    const window = new EventTarget();
    globalThis.window = window;
    const opener = document.createElement("button"), dialog = document.createElement("dialog");
    const field = document.createElement("input"), close = document.createElement("button");
    const options = ["dashboard", "sessions", "skills", "connections", "account"].map(id => {
      const option = document.createElement("a");
      option.id = id;
      option.appendChild(document.createTextNode(id));
      dialog.appendChild(option);
      return option;
    });
    let activated = null;
    for (const option of options) option.addEventListener("click", () => { activated = option.id; });
    dialog.querySelector = () => null;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    document.body.appendChild(opener);
    document.body.appendChild(dialog);
    dialog.appendChild(field);
    dialog.appendChild(close);
    const cleanup = bindCommandPalette(opener, dialog, field, options, close);
    t.after(() => { cleanup(); delete globalThis.window; });
    // When
    const shortcut = new Event("keydown", { cancelable: true });
    Object.assign(shortcut, { key: "k", [modifier]: true });
    window.dispatchEvent(shortcut);
    // Then
    assert.equal(dialog.open, true);
    assert.equal(document.activeElement, field);
    assert.equal(field.getAttribute("aria-activedescendant"), "dashboard");
    field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" }));
    assert.equal(field.getAttribute("aria-activedescendant"), "sessions");
    field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowUp" }));
    assert.equal(field.getAttribute("aria-activedescendant"), "dashboard");
    field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" }));
    assert.equal(activated, "dashboard");
    assert.equal(document.activeElement, opener);
    opener.click();
    dialog.dispatchEvent(new FakeEvent("cancel"));
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, opener);
    assert.equal(options.length, 5);
  });
}
