import assert from "node:assert/strict";
import test from "node:test";
import { act, all, buttonNamed, loadViews, mount, waitFor } from "./helpers/t10-dom.mjs";

const { HomeWidgets, lastChanges, recentDays } = await loadViews(`
  export * from "./site/src/dashboard/home-widgets.tsx";
  export * from "./site/src/dashboard/home-data.ts";
`);
const clock = Date.UTC(2026, 10, 5, 3);
const signal = new AbortController().signal;
const ready = data => ({ status: "ready", data, message: "", technical: "" });
const device = { deviceId: "test-device", createdAt: 1, revokedAt: null, version: 0, consent: { mode: "local-only" } };
const skill = { skillId: "81000000-0000-4000-8000-000000000001", name: "예시", description: "예시 스킬",
  head: { revision: 3, digest: "a".repeat(64) }, updatedAt: clock };
const mcp = (n, kind, revokedAt, expiresAt) => ({
  connectionId: `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`, kind, name: `연결 ${n}`,
  scopes: ["skills:read"], recordActivity: false, createdAt: 1, revokedAt, expiresAt,
});
const tiles = container => all(container, node => node.localName === "strong").map(node => node.textContent);
const props = { signal, devices: ready([device]), onRetryDevices() {}, onUnauthorized() {} };

test("daily changes include zero days and use KST calendar boundaries without summing versions", () => {
  // Given
  const dates = recentDays(clock, 5);
  const skills = [skill, { ...skill, skillId: "other", updatedAt: Date.UTC(2026, 10, 3, 15) },
    { ...skill, skillId: "outside", updatedAt: Date.UTC(2026, 9, 31, 14, 59) }];
  // When
  const changes = lastChanges(skills, dates);
  // Then
  assert.deepEqual(dates, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.deepEqual(changes.counts, [0, 0, 0, 1, 1]);
  assert.deepEqual(changes.recent.map(row => row.skillId), [skill.skillId, "other"]);
});

test("recent changes sort the selected range and cap the list at five", () => {
  // Given
  const skills = Array.from({ length: 9 }, (_, i) => ({ ...skill, skillId: String(i), updatedAt: clock - i * 1000 }));
  // When
  const changes = lastChanges(skills, recentDays(clock, 3));
  // Then
  assert.equal(changes.total, 9);
  assert.deepEqual(changes.recent.map(row => row.skillId), ["0", "1", "2", "3", "4"]);
});

test("home counts registrations without deduplication and excludes expired revoked and OAuth tokens", async t => {
  // Given
  const reads = [];
  t.mock.method(globalThis, "fetch", async url => {
    reads.push(String(url));
    return url === "/api/skills" ? Response.json({ revision: 1, skills: [skill] }) :
      Response.json({ resource: "https://skillar.sh/mcp", connections: [
        mcp(1, "pat", null, 9999999999), mcp(2, "oauth", null, 9999999999),
        mcp(3, "pat", null, 1), mcp(4, "pat", 2, 9999999999),
      ] });
  });
  const { dom, container } = await mount(t, HomeWidgets, props);
  // When
  await waitFor(dom, () => tiles(container)[2] === "3", "registration count");
  // Then
  assert.deepEqual(tiles(container), ["1", "미측정", "3", "1"]);
  assert.deepEqual(reads.sort(), ["/api/mcp/connections", "/api/skills"]);
  assert.equal(all(container, node => node.localName === "rect" && node.getAttribute("data-value") === "0").length > 0, true);
  assert.equal(all(container, node => node.localName === "rect").every(node =>
    Number(node.getAttribute("y")) + Number(node.getAttribute("height")) === Number(node.getAttribute("data-baseline"))), true);
});

test("failed catalog is unknown rather than zero and retry replaces it with a confirmed empty catalog", async t => {
  // Given
  let failed = true;
  t.mock.method(globalThis, "fetch", async url => url === "/api/skills" ?
    failed ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ revision: 1, skills: [] }) :
    Response.json({ resource: "https://skillar.sh/mcp", connections: [] }));
  const { dom, container } = await mount(t, HomeWidgets, props);
  await waitFor(dom, () => buttonNamed(container, "자산·연결 다시 읽기")[0], "catalog error");
  assert.deepEqual(tiles(container).slice(0, 2), ["미측정", "미측정"]);
  failed = false;
  // When
  await act(() => buttonNamed(container, "자산·연결 다시 읽기")[0].click());
  await waitFor(dom, () => tiles(container)[0] === "0" && tiles(container)[2] === "1", "empty catalog");
  // Then
  assert.deepEqual(tiles(container), ["0", "0", "1", "0"]);
});

test("a widget authentication failure expires the dashboard instead of retaining private values", { timeout: 5000 }, async t => {
  // Given
  let expired = 0;
  const rejected = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "unauthorized" }, { status: 401 }));
  await mount(t, HomeWidgets, { ...props, onUnauthorized() { if (++expired === 2) rejected.resolve(); } });
  // When
  await rejected.promise;
  // Then
  assert.equal(expired, 2);
});
