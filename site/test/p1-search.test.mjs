import assert from "node:assert/strict";
import test from "node:test";
import { act, byTag, FakeEvent, input, loadViews, mount, submit, waitFor } from "./helpers/t10-dom.mjs";
const { SearchBox } = await loadViews('export {SearchBox} from "./site/src/skills/search.ts";');
const skillId = "11223344-1122-4122-8122-112233445566", digest = "a".repeat(64);
const candidate = { uri: `skillar://private/${skillId}/${digest}/SKILL.md`, name: "Alpha", description: "Fixture",
  digest, rank: 2, score: 1, matched: [], invocation: "automatic" };
const reply = { query: "fixture", traceId: "fixture", mode: "discovery", elapsedMs: 1,
  candidates: [{ ...candidate, uri: "skillar://public/foreign/SKILL.md", rank: 1 }, candidate] };
const props = { skills: [], signal: new AbortController().signal, onOpen() {}, onUnauthorized() {} };

test("remote search skips an unopenable candidate and points at the visually selected option", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async () => Response.json(reply));
  const { dom, container } = await mount(t, SearchBox, props);
  const field = byTag(container, "input")[0];
  await input(field, "fixture");
  const loaded = waitFor(dom, () => byTag(container, "li").length === 2, "search candidates");
  await submit(byTag(container, "form")[0]);
  await loaded;
  // When
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  // Then
  const selected = dom.getElementById(field.getAttribute("aria-activedescendant"));
  assert.equal(selected.getAttribute("id"), "search-result-1");
  assert.equal(selected.getAttribute("role"), "option");
  assert.equal(selected.getAttribute("data-active"), "true");
  assert.equal(selected.getAttribute("aria-selected"), "true");
  assert.equal(byTag(container, "li")[0].getAttribute("aria-disabled"), "true");
});

test("remote search Escape closes the listbox and clears the active descendant", async t => {
  // Given
  t.mock.method(globalThis, "fetch", async () => Response.json(reply));
  const { dom, container } = await mount(t, SearchBox, props);
  const field = byTag(container, "input")[0];
  await input(field, "fixture");
  const loaded = waitFor(dom, () => byTag(container, "li").length === 2, "search candidates");
  await submit(byTag(container, "form")[0]); await loaded;
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  // When
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Escape" })));
  // Then
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(field.getAttribute("aria-activedescendant"), null);
  assert.equal(byTag(container, "ul")[0].hidden, true);
});

test("IME confirmation does not open a remote search result", async t => {
  // Given
  let opened = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(reply));
  const { dom, container } = await mount(t, SearchBox, { ...props, onOpen() { opened++; } });
  const field = byTag(container, "input")[0];
  await input(field, "fixture");
  const loaded = waitFor(dom, () => byTag(container, "li").length === 2, "search candidates");
  await submit(byTag(container, "form")[0]); await loaded;
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "ArrowDown" })));
  // When
  await act(() => field.dispatchEvent(new FakeEvent("keydown", { key: "Enter", isComposing: true })));
  // Then
  assert.equal(opened, 0);
});
