import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCodexBridge } from "../dist/codex.js";
import { searchSkills } from "../dist/skill-search.js";

const make = (source, name, keywords = [], manual = false) => {
  const uri = `skill://skillar/${source}/${name}/SKILL.md`;
  return { uri, frontmatter: { name, description: "Inspect a proposed evaluation", keywords,
    ...(manual ? { "disable-model-invocation": true } : {}) },
    resources: [{ uri, size: 0, digest: `sha256:${createHash("sha256").update("").digest("hex")}` }] };
};

test("ranked discovery preserves exact identities, uses bilingual keywords and respects invocation policy", async t => {
  const entries = [make("a", "inspector"), make("z", "inspect", ["평가 설계"]),
    make("b", "inspect", ["평가 설계"]), make("c", "inspect-manual", ["평가 설계"], true)];
  let requests = 0;
  const server = createCodexBridge({
    request: async ({ method }) => { requests++; assert.equal(method, "skills/list"); return { skills: entries }; },
    readResource: async () => assert.fail("metadata discovery must not read bodies"),
  }, "fixture", undefined, true);
  const client = new Client({ name: "discovery-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  const search = async args => {
    const response = await client.callTool({ name: "search_skills", arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  const legacy = await search({ query: "inspect" });
  assert.deepEqual(legacy.skills.map(item => item.uri), entries.map(item => item.uri).sort());
  assert.deepEqual(Object.keys(legacy.skills[0]).sort(), ["description", "name", "uri"]);
  const ranked = await search({ query: "inspect", mode: "explicit" });
  assert.deepEqual(ranked.skills.slice(0, 2).map(item => item.uri), [entries[2].uri, entries[1].uri], "exact same-named sources stay distinct and rank before substrings");
  const manual = ranked.skills.find(item => item.uri === entries[3].uri);
  assert.equal(manual.invocation, "explicit");
  const discovery = await search({ query: "평가 설계", mode: "discovery" });
  assert.equal(discovery.totalMatches, 3);
  assert.equal(discovery.skills.find(item => item.uri === entries[3].uri).invocation, "explicit");
  const automatic = await search({ query: "평가  설계".normalize("NFD"), mode: "automatic", limit: 1 });
  assert.equal(automatic.totalMatches, 2);
  assert.equal(automatic.skills[0].invocation, "automatic");
  assert.equal(automatic.skills[0].digest, entries[2].resources[0].digest);
  const next = await search({ query: "평가  설계".normalize("NFD"), mode: "automatic", limit: 1, offset: automatic.nextOffset });
  assert.equal(next.skills[0].uri, entries[1].uri);
  assert.equal(next.nextOffset, undefined);
  assert.equal((await search({ query: "unknown subject", mode: "automatic" })).totalMatches, 0);
  assert.equal((await search({ query: "spec", mode: "automatic" })).totalMatches, 0, "short Latin terms cannot match inside another word such as inspector");
  assert.equal((await search({ query: "spec" })).totalMatches, 4, "legacy clients retain substring behavior");
  const before = requests;
  for (const args of [{ mode: "automatic" }, { mode: "automatic", query: "  " }, { mode: "discovery" }, { mode: "discovery", query: "  " }, { mode: "typo" }]) {
    assert.equal((await client.callTool({ name: "search_skills", arguments: args })).isError, true);
  }
  assert.equal(requests, before, "invalid discovery does not enumerate the upstream catalog");
});

test("a server ignoring an explicitly selected commit cannot silently supply current content", async t => {
  const entry = make("team", "inspect");
  const server = createCodexBridge({
    request: async ({ method }) => ({ ...(method === "skills/list" ? { skills: [entry] } : { skill: entry }), _meta: { commit: "b".repeat(40), release: "2" } }),
    readResource: async () => assert.fail("mismatched content must fail before any body read"),
  }, "fixture", undefined, true);
  const client = new Client({ name: "commit-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  for (const [name, args] of [["search_skills", { query: "inspect" }], ["load_skill", { uri: entry.uri }]]) {
    const response = await client.callTool({ name, arguments: { ...args, commit: "a".repeat(40) } });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /commit is unavailable/);
  }
  const unknown = await client.callTool({ name: "read_skill_file", arguments: { skill_uri: entry.uri, uri: entry.uri, load_id: "0".repeat(64) } });
  assert.equal(unknown.isError, true);
});

test("compact excerpts retain Unicode and full descriptions remain searchable", async t => {
  const entries = Array.from({ length: 7 }, (_, i) => {
    const entry = make("team", `flow-${i}`);
    entry.frontmatter.description = "앞부분 😀 ".repeat(60) + "needle " + "뒷부분 🧪 ".repeat(60);
    return entry;
  });
  const server = createCodexBridge({ request: async () => ({ skills: entries }) }, "fixture", undefined, true);
  const client = new Client({ name: "compact-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  for (const mode of ["legacy", "automatic", "explicit", "discovery"]) {
    const response = await client.callTool({ name: "search_skills", arguments: { query: "needle", mode } });
    assert.ok(!response.isError);
    const data = JSON.parse(response.content[0].text);
    assert.equal(data.totalMatches, 7);
    assert.equal(data.skills.length, 5);
    assert.equal(data.nextOffset, 5);
    for (const item of data.skills) {
      assert.ok(Array.from(item.description).length <= 240);
      assert.equal(item.descriptionTruncated, true);
      assert.match(item.description, /needle/);
      assert.ok(item.description.isWellFormed());
    }
    const next = JSON.parse((await client.callTool({ name: "search_skills", arguments: { query: "needle", mode, offset: data.nextOffset } })).content[0].text);
    assert.equal(next.skills.length, 2);
    assert.equal(next.nextOffset, undefined);
    assert.equal(new Set([...data.skills, ...next.skills].map(item => item.uri)).size, 7);
  }
});

test("natural requests rank subject evidence, preserve identity and abstain on incidental words", () => {
  const docs = [
    { uri: 'skill://test/state/SKILL.md', name: 'state', description: '온보딩과 인증 대기 상태를 검토한다.', keywords: ['이메일 인증', '링크 만료'], automatic: true, digest: '1' },
    { uri: 'skill://test/report/SKILL.md', name: 'report', description: '개발 진행 상황 공유문을 작성한다.', keywords: ['진행 상황', '일정 의존성'], automatic: true, digest: '2' },
    { uri: 'skill://test/manual/SKILL.md', name: 'manual', description: '실패 원인 분석 방법', keywords: ['실패 원인'], automatic: false, digest: '3' },
  ];
  assert.equal(searchSkills(docs, '이메일 인증 링크가 만료되면 다음에 무엇을 보여줄지 검토해줘', 'discovery')[0].name, 'state');
  assert.equal(searchSkills(docs, '개발 진행 상황을 팀에 공유할 때 일정 의존성도 설명해줘', 'automatic')[0].name, 'report');
  assert.equal(searchSkills(docs, '토마토 조리 방법', 'discovery').length, 0);
  assert.equal(searchSkills(docs, '치통 원인 치료 방법', 'discovery').length, 0);
  assert.equal(searchSkills(docs, 'manual', 'discovery')[0].automatic, false);
  assert.equal(searchSkills(docs, 'manual', 'automatic').length, 0);
  assert.equal(searchSkills(docs, 'man', 'discovery').length, 0);
  const old = searchSkills(docs, '일정 의존성', 'discovery').map(d => d.uri);
  assert.deepEqual(searchSkills(structuredClone(docs), '일정 의존성', 'discovery').map(d => d.uri), old);
  docs[1].keywords = ['독립 주제']; docs[1].description = '완전히 다른 내용';
  assert.equal(searchSkills(docs, '일정 의존성', 'discovery').length, 0, 'metadata updates must not reuse an old index');
  assert.equal(searchSkills(docs, '독립 주제', 'discovery')[0].name, 'report');
});

test("ranked MCP search reports matching metadata only when evidence is requested", async t => {
  const entries = [make("team", "database-query", ["DB 병목"]), make("team", "api-contract", ["API 계약"])];
  entries[0].frontmatter.description = "Inspect database query bottlenecks and DB performance";
  const server = createCodexBridge({ request: async () => ({ skills: entries }) }, "fixture", undefined, true);
  const client = new Client({ name: "evidence-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async args => {
    const response = await client.callTool({ name: "search_skills", arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  const defaultResult = await call({ query: "DB 병목", mode: "discovery" });
  assert.equal("evidence" in defaultResult.skills[0], false, "opt-in must not alter existing ranked consumers");
  const result = await call({ query: "DB 병목", mode: "discovery", include_evidence: true });
  assert.equal(result.skills[0].uri, entries[0].uri);
  assert.equal(result.skills[0].evidence.exactName, false);
  assert.ok(result.skills[0].evidence.matches.some(m => m.field === "keywords" && m.matchedText === "DB 병목"));
  assert.ok(result.skills[0].evidence.matches.some(m => m.field === "description" && /DB/.test(m.matchedText)));
  assert.equal("score" in result.skills[0].evidence, false, "ranking points are not probabilities");
  const legacy = await call({ query: "DB" });
  assert.deepEqual(Object.keys(legacy.skills[0]).sort(), ["description", "name", "uri"]);
});

test("explicit exact exclusion removes unwanted subject without changing legacy search", async t => {
  const entries = [make("team", "api-contract", ["API 계약"]), make("team", "database-query", ["DB 병목"])];
  const server = createCodexBridge({ request: async () => ({ skills: entries }) }, "fixture", undefined, true);
  const client = new Client({ name: "exclusion-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  // The loader extracts searchable subject terms from the user's request;
  // only an explicit exclusion can remove the unwanted API-contract match.
  const query = "API 계약 DB 병목";
  const response = await client.callTool({ name: "search_skills", arguments: { query, mode: "discovery", exclude: ["API 계약"] } });
  assert.ok(!response.isError, JSON.stringify(response));
  const result = JSON.parse(response.content[0].text);
  assert.deepEqual(result.skills.map(skill => skill.uri), [entries[1].uri]);
  assert.deepEqual(result.filters, { exclude: ["API 계약"], excludedMatches: 1 });
  const unfiltered = JSON.parse((await client.callTool({ name: "search_skills", arguments: { query, mode: "discovery" } })).content[0].text);
  assert.ok(unfiltered.skills.some(skill => skill.uri === entries[0].uri), "quoted or ambiguous text must not be silently excluded");
  const legacy = await client.callTool({ name: "search_skills", arguments: { query: "API", exclude: ["API 계약"] } });
  assert.equal(legacy.isError, true, "legacy clients must opt into ranked semantics before requesting exclusions");
});

test("ranked evidence and excerpt share Unicode-normalized description matches", async t => {
  const entry = make("team", "query-review");
  entry.frontmatter.description = "앞부분 😀 ".repeat(60) + "느린 쿼리를 조사합니다" + "뒷부분 🧪 ".repeat(60);
  const server = createCodexBridge({ request: async () => ({ skills: [entry] }) }, "fixture", undefined, true);
  const client = new Client({ name: "unicode-evidence-test", version: "1" });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await server.connect(back); await client.connect(front);
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "search_skills", arguments: { query: "느린 쿼리".normalize("NFD"), mode: "discovery", include_evidence: true } });
  assert.ok(!response.isError, JSON.stringify(response));
  const { skills } = JSON.parse(response.content[0].text);
  assert.equal(skills.length, 1);
  assert.ok(skills[0].evidence.matches.some(match => match.field === "description" && match.matchedText === "쿼리를"));
  assert.match(skills[0].description, /느린 쿼리를/);
  assert.ok(skills[0].description.isWellFormed());
  assert.ok(Array.from(skills[0].description).length <= 240);
});
