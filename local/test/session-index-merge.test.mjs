import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../dashboard/session-index-merge.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
const { createMergedSessionIndex, compareMerged } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

// 워커와 같은 의미의 가짜 출처: (lastEventMs DESC, sessionId ASC) 정렬, keyset cursor는 "그 항목 다음부터".
function fake(rows, { rowsRead = 3, fail = false } = {}) {
  const sorted = [...rows].sort((a, b) => b.lastEventMs - a.lastEventMs || (a.sessionId < b.sessionId ? -1 : 1));
  return {
    calls: 0,
    async list(filter, { limit = 50, cursor } = {}) {
      this.calls++;
      if (fail) throw new Error("boom");
      const pool = sorted.filter(r => (filter.runtimes?.length ? filter.runtimes.includes(r.runtime) : true)
        && (!cursor || r.lastEventMs < cursor.lastEventMs || (r.lastEventMs === cursor.lastEventMs && r.sessionId > cursor.sessionId)));
      const page = pool.slice(0, limit);
      const last = page.at(-1);
      return { sessions: page, nextCursor: pool.length > limit && last ? { lastEventMs: last.lastEventMs, sessionId: last.sessionId } : null, rowsRead };
    },
    async count(filter) { if (fail) throw new Error("boom"); return { total: sorted.filter(r => !filter.runtimes?.length || filter.runtimes.includes(r.runtime)).length, rowsRead }; },
    async filterOptions() {
      if (fail) throw new Error("boom");
      const m = new Map(); for (const r of rows) m.set(r.runtime, (m.get(r.runtime) ?? 0) + 1);
      return { runtimes: [...m].map(([runtime, sessions]) => ({ runtime, sessions })), rowsRead };
    },
    async events(id) { return { events: [{ entityKey: id, kind: "load", timestampMs: 1 }], nextCursor: null, rowsRead }; },
  };
}
const row = (sessionId, lastEventMs, runtime = "codex") => ({ sessionId, lastEventMs, firstEventMs: lastEventMs, startedMs: null, runtime, events: 1, reads: 0, searches: 0, skills: [] });
function dataset(seed, n) {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(row(`s${String(Math.floor(rnd() * 40)).padStart(2, "0")}-${i}`, 1000 + Math.floor(rnd() * 8), rnd() < 0.5 ? "codex" : "claude-code"));
  return rows;
}
async function drain(merged, filter, limit) {
  const out = []; let cursor = null; let pages = 0;
  do {
    const page = await merged.list(filter, { limit, cursor });
    out.push(...page.sessions); cursor = page.nextCursor; pages++;
    assert.ok(pages < 500, "paging must terminate");
  } while (cursor !== null);
  return out;
}

test("모든 쪽 크기에서 병합 결과가 전체 정렬과 같고 빠지거나 겹치지 않는다(동률 포함)", async () => {
  for (const seed of [1, 7, 42]) {
    const a = dataset(seed, 37), b = dataset(seed + 1, 23).map(r => ({ ...r, sessionId: `b-${r.sessionId}` })), c = dataset(seed + 2, 5);
    const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake(a) }, { key: "B", label: "b", index: fake(b) }, { key: "C", label: "c", index: fake(c) }]);
    const expected = [...a.map(r => ({ ...r, source: "A" })), ...b.map(r => ({ ...r, source: "B" })), ...c.map(r => ({ ...r, source: "C" }))].sort(compareMerged);
    for (const limit of [1, 2, 3, 7, 10, 64, 200]) {
      const got = await drain(merged, {}, limit);
      assert.deepEqual(got.map(r => [r.source, r.sessionId]), expected.map(r => [r.source, r.sessionId]), `seed ${seed} limit ${limit}`);
      assert.equal(new Set(got.map(r => `${r.source}/${r.sessionId}`)).size, expected.length);
    }
  }
});

test("같은 세션 ID가 서로 다른 출처에 있어도 둘 다 나온다", async () => {
  const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake([row("same", 5)]) }, { key: "B", label: "b", index: fake([row("same", 5)]) }]);
  const got = await drain(merged, {}, 1);
  assert.deepEqual(got.map(r => r.source), ["A", "B"]);
});

test("필터는 모든 출처에 같이 적용되고 count와 filterOptions는 출처별 합이다", async () => {
  const a = dataset(3, 20), b = dataset(4, 11);
  const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake(a) }, { key: "B", label: "b", index: fake(b) }]);
  const filter = { runtimes: ["codex"] };
  const got = await drain(merged, filter, 4);
  const count = await merged.count(filter);
  assert.equal(got.length, count.total);
  assert.ok(got.every(r => r.runtime === "codex"));
  assert.equal(count.bySource.A + count.bySource.B, count.total);
  const options = await merged.filterOptions();
  assert.equal(options.runtimes.reduce((s, r) => s + r.sessions, 0), 31);
  assert.equal(count.rowsRead, 6);
});

test("한 출처가 실패하면 failed에 남고 나머지 출처 항목은 그대로 합쳐진다", async () => {
  const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake([row("a1", 9), row("a2", 8)]) }, { key: "B", label: "b", index: fake([], { fail: true }) }]);
  const page = await merged.list({}, { limit: 10 });
  assert.deepEqual(page.sessions.map(r => r.sessionId), ["a1", "a2"]);
  assert.deepEqual(page.failed.map(f => f.source), ["B"]);
  assert.equal(page.nextCursor, null, "paging ends with the reachable sources; completeness is reported only through failed");
  assert.ok(page.failed.length > 0);
  assert.deepEqual((await merged.count({})).failed.map(f => f.source), ["B"]);
  assert.deepEqual((await merged.filterOptions()).failed.map(f => f.source), ["B"]);
});

test("끝까지 소비한 출처는 다시 부르지 않는다", async () => {
  const small = fake([row("x", 99999)]); const big = fake(dataset(9, 30));
  const merged = createMergedSessionIndex([{ key: "S", label: "s", index: small }, { key: "L", label: "l", index: big }]);
  await drain(merged, {}, 5);
  assert.equal(small.calls, 1);
});

test("rowsRead는 한 출처라도 null이면 null이다", async () => {
  const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake([row("a", 1)]) }, { key: "B", label: "b", index: fake([row("b", 1)], { rowsRead: null }) }]);
  assert.equal((await merged.list({}, { limit: 5 })).rowsRead, null);
});

test("실패 출처가 복구된 뒤 처음부터 다시 읽으면 전체 정렬과 같고 중복/누락이 없다", async () => {
  const a = dataset(11, 40), b = dataset(12, 25).map(r => ({ ...r, sessionId: `b-${r.sessionId}` }));
  const flaky = fake(b); const real = flaky.list.bind(flaky); let down = true;
  flaky.list = async (...args) => { if (down) { flaky.calls++; throw new Error("boom"); } return real(...args); };
  const merged = createMergedSessionIndex([{ key: "A", label: "a", index: fake(a) }, { key: "B", label: "b", index: flaky }]);
  // 실패하는 동안: 쪽마다 failed가 켜지고, A 항목만 빠짐/겹침 없이 순서대로 나온다.
  const partial = []; let cursor = null; let failedEveryPage = true;
  do { const page = await merged.list({}, { limit: 7, cursor }); failedEveryPage &&= page.failed.length === 1; partial.push(...page.sessions); cursor = page.nextCursor; } while (cursor !== null && partial.length < 400);
  assert.ok(failedEveryPage);
  assert.deepEqual(partial.map(r => r.sessionId), [...a.map(r => ({ ...r, source: "A" }))].sort(compareMerged).map(r => r.sessionId));
  // 복구 뒤 처음부터: 두 출처 전체가 정확히 한 번씩, 정렬 그대로.
  down = false;
  const all = await drain(merged, {}, 7);
  const expected = [...a.map(r => ({ ...r, source: "A" })), ...b.map(r => ({ ...r, source: "B" }))].sort(compareMerged);
  assert.deepEqual(all.map(r => [r.source, r.sessionId]), expected.map(r => [r.source, r.sessionId]));
});
