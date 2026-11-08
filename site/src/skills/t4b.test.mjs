import assert from "node:assert/strict";
import test from "node:test";
import { readSkillsView, skillsViewUrl } from "./view-state.ts";
import { LibraryPanel, visibleSkills, updatedHistogram } from "./library.ts";
import { chartLayout, DataTable } from "../ui/index.ts";
import { FormattedDocument } from "./document.ts";
import { act, byTag, FakeEvent, mount } from "../../test/helpers/t10-dom.mjs";

const id = "11223344-1122-4122-8122-112233445566";
const view = readSkillsView("https://skillar.sh/skills/");
const day = Date.parse("2026-11-05T12:00:00Z");
const skills = [
  { skillId: id, name: "가", description: "문서", updatedAt: day, head: { revision: 3, digest: "a".repeat(64) } },
  { skillId: "11223344-1122-4122-8122-112233445567", name: "나", description: "검증", updatedAt: day - 86400000, head: { revision: 1, digest: "b".repeat(64) } },
];

test("view URL round-trips facets, presentation, version, tab and selection without changing opaque ids", () => {
  // Given
  const state = { ...view, q: "문서 검증", sort: "name", descending: false, revisions: ["1", "3"],
    days: ["2026-11-05"], hidden: ["updated"], density: "normal", selected: id, full: true,
    digest: "a".repeat(64), tab: "files" };
  // When
  const restored = readSkillsView(new URL(skillsViewUrl(state), "https://skillar.sh").href);
  // Then
  assert.deepEqual(restored, state);
});

test("legacy hashes open full detail while invalid selection and presentation values cannot escape allowed state", () => {
  // Given / When
  const legacy = readSkillsView(`https://skillar.sh/skills/#skill/${id}`);
  const invalid = readSkillsView("https://skillar.sh/skills/?skill=invalid&sort=other&density=other&tab=other&hide=other");
  // Then
  assert.equal(legacy.selected, id);
  assert.equal(legacy.full, true);
  assert.equal(invalid.selected, null);
  assert.equal(invalid.sort, "updated");
  assert.equal(invalid.density, "compact");
  assert.equal(invalid.tab, "document");
  assert.deepEqual(invalid.hidden, []);
});

test("a peek document selection has explicit reproducible URL tab state", () => {
  // Given
  const state = { ...view, selected: id, full: false, tab: "document" };
  // When
  const url = new URL(skillsViewUrl(state), "https://skillar.sh");
  // Then
  assert.equal(url.searchParams.get("tab"), "document");
  assert.deepEqual(readSkillsView(url.href), state);
});

test("search revision and KST date facets intersect without changing the catalog", () => {
  // Given / When
  const rows = visibleSkills(skills, { ...view, q: "검증", revisions: ["1"], days: ["2026-11-04"] });
  // Then
  assert.deepEqual(rows.map(skill => skill.name), ["나"]);
  assert.equal(visibleSkills(skills, { ...view, revisions: ["3"], days: ["2026-11-04"] }).length, 0);
  assert.deepEqual(skills.map(skill => skill.name), ["가", "나"]);
});

test("updated histogram retains empty KST dates and compact bars share one baseline and scale", () => {
  // Given
  const data = updatedHistogram(skills);
  // When
  const chart = chartLayout(data, 112);
  // Then
  assert.equal(data.labels.length, 7);
  assert.deepEqual(data.series[0].values, [0, 0, 0, 0, 0, 1, 1]);
  assert.ok(chart.bars.every(bar => bar.y + bar.height === chart.baseline));
  assert.ok(chart.bars.filter(bar => bar.value === 0).every(bar => bar.height === 1));
  assert.equal(new Set(chart.bars.map(bar => bar.width)).size, 1);
});

test("an empty filter retains the received catalog date domain as seven measured zeros", () => {
  // Given
  const rows = visibleSkills(skills, { ...view, q: "no matching skill" });
  // When
  const data = updatedHistogram(rows, skills);
  const chart = chartLayout(data, 112);
  // Then
  assert.deepEqual(data.labels, ["10/30\nKST", "10/31\nKST", "11/1\nKST", "11/2\nKST", "11/3\nKST", "11/4\nKST", "11/5\nKST"]);
  assert.deepEqual(data.series[0].values, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(chart.bars.length, 7);
  assert.ok(chart.bars.every(bar => bar.height === 1 && bar.y + bar.height === chart.baseline));
});

test("facets and histogram split skills exactly at the KST midnight boundary", () => {
  // Given
  const catalog = [
    { ...skills[0], updatedAt: Date.parse("2026-11-04T14:59:59.999Z") },
    { ...skills[1], updatedAt: Date.parse("2026-11-04T15:00:00.000Z") },
  ];
  // When
  const selected = visibleSkills(catalog, { ...view, days: ["2026-11-05"] });
  const data = updatedHistogram(catalog);
  // Then
  assert.deepEqual(selected.map(skill => skill.skillId), [skills[1].skillId]);
  assert.deepEqual(data.series[0].values, [0, 0, 0, 0, 0, 1, 1]);
});

test("shared table keyboard activation supplies the real row for focus restoration", async t => {
  // Given
  let opened;
  const { container } = await mount(t, DataTable, {
    rows: skills, columns: [{ id: "name", label: "이름", value: skill => skill.name }],
    caption: "스킬", rowId: skill => `row-${skill.skillId}`, onRowOpen: (skill, row) => { opened = { skill, row }; },
  });
  const row = byTag(container, "tbody")[0].children[0];
  // When
  await act(() => row.dispatchEvent(new FakeEvent("keydown", { key: "Enter" })));
  // Then
  assert.equal(opened.skill.skillId, id);
  assert.equal(opened.row, row);
});

test("hiding the digest column also hides its compact phone metadata", async t => {
  // Given
  const props = { skills, status: "ready", message: "", notice: "", selectedId: null,
    signal: new AbortController().signal, onReload() {}, onOpen() {}, onUnauthorized() {},
    view: { ...view, hidden: ["digest"] } };
  const api = await mount(t, LibraryPanel, props);
  // When / Then
  assert.equal(api.container.textContent.includes("a".repeat(8)), false);
  await api.show({ ...props, view: { ...view, hidden: [] } });
  assert.equal(api.container.textContent.includes("a".repeat(8)), true);
});

test("formatted document never converts stored HTML into executable markup", async t => {
  // Given / When
  const { container } = await mount(t, FormattedDocument, { text: "# 문서\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>" });
  // Then
  assert.equal(byTag(container, "script").length, 0);
  assert.equal(byTag(container, "img").length, 0);
  assert.ok(container.textContent.includes("<script>"));
});
