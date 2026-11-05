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

function palette(t) {
    const document = installFakeDom();
    document.body.classList = { contains: value => value === "app-shell" };
    const window = new EventTarget();
    const navigations = [];
    window.location = { assign: href => navigations.push(href) };
    globalThis.window = window;
    const opener = document.createElement("button"), dialog = document.createElement("dialog");
    const field = document.createElement("input"), close = document.createElement("button");
    const options = ["dashboard", "sessions", "skills", "connections", "account"].map(id => {
      const option = document.createElement("a");
      option.id = id;
      option.href = `https://skillar.sh/${id}/`;
      // Model the browser's uncancelled anchor default action, not just the
      // callback. Both native activation and explicit navigation must work.
      option.click = () => {
        const event = new FakeEvent("click");
        option.dispatchEvent(event);
        if (!event.defaultPrevented) window.location.assign(option.href);
      };
      option.appendChild(document.createTextNode(id));
      dialog.appendChild(option);
      return option;
    });
    dialog.querySelector = () => null;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    document.body.appendChild(opener);
    document.body.appendChild(dialog);
    dialog.appendChild(field);
    dialog.appendChild(close);
    const cleanup = bindCommandPalette(opener, dialog, field, options, close);
    t.after(() => { cleanup(); delete globalThis.window; });
    return { document, window, opener, dialog, field, options, navigations };
}

for (const modifier of ["metaKey", "ctrlKey"]) {
  test(`command jump opens with ${modifier} and Escape restores the opener`, t => {
    // Given
    const { document, window, opener, dialog, field } = palette(t);
    // When
    const shortcut = new Event("keydown", { cancelable: true });
    Object.assign(shortcut, { key: "k", [modifier]: true });
    window.dispatchEvent(shortcut);
    // Then
    assert.equal(dialog.open, true);
    assert.equal(document.activeElement, field);
    assert.equal(field.getAttribute("aria-activedescendant"), "dashboard");
    dialog.dispatchEvent(new FakeEvent("cancel"));
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, opener);
  });
}

test("two ArrowDown presses and Enter navigate to the third destination", t => {
  const { opener, field, navigations, dialog } = palette(t);
  opener.click();
  field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" }));
  field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" }));
  assert.equal(field.getAttribute("aria-activedescendant"), "skills");
  field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" }));
  assert.deepEqual(navigations, ["https://skillar.sh/skills/"]);
  assert.equal(dialog.open, false);
});

test("arrows wrap and Home and End select the visible endpoints", t => {
  const { opener, field, options } = palette(t);
  opener.click();
  for (const [key, expected] of [
    ["ArrowUp", "account"], ["ArrowDown", "dashboard"], ["End", "account"],
    ["Home", "dashboard"], ["ArrowDown", "sessions"],
  ]) {
    field.dispatchEvent(new FakeEvent("keydown", { key }));
    assert.equal(field.getAttribute("aria-activedescendant"), expected);
    assert.deepEqual(options.filter(option => option.getAttribute("aria-selected") === "true").map(option => option.id), [expected]);
  }
});

test("filtered Enter and option clicks use the destination URL", t => {
  const { opener, field, options, navigations } = palette(t);
  opener.click();
  field.value = "skills";
  field.dispatchEvent(new FakeEvent("input"));
  field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" }));
  opener.click();
  options[3].click();
  assert.deepEqual(navigations, ["https://skillar.sh/skills/", "https://skillar.sh/connections/"]);
});

test("Enter with no match or an active IME composition does not navigate", t => {
  const { opener, field, navigations } = palette(t);
  opener.click();
  const composition = new FakeEvent("keydown", { key: "Enter" });
  composition.isComposing = true;
  field.dispatchEvent(composition);
  field.value = "no-match";
  field.dispatchEvent(new FakeEvent("input"));
  field.dispatchEvent(new FakeEvent("keydown", { key: "Enter" }));
  assert.deepEqual(navigations, []);
  assert.equal(field.getAttribute("aria-activedescendant"), null);
});
