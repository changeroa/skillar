import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, packet, browser, skillId, otherId, uri, now } from "./helpers/private-skill-backend.mjs";
import {
  privateSkillCatalogSchema, privateSkillDetailSchema, privateSkillSearchResultSchema,
} from "../../shared/dist/private-skills.js";

const search = (f, input = {}, who = browser()) => f.send("/mcp/search", "POST", input, who);
const catalog = (f, who = browser()) => f.send("/mcp/catalog", "GET", undefined, who);
const markdown = (name, explicit = false) => `---
name: ${name}
description: Deploy quartz services
when_to_use: quartz releases
examples: [quartz]
aliases_ko: [배포]
disable-model-invocation: ${explicit}
license: MIT
metadata: {owner: synthetic}
---
# Routing
quartz body
`;

test("catalog returns original Unicode metadata and immutable resource descriptors without R2 reads", async t => {
  // Given published Unicode metadata and a real binary R2 resource.
  const f = await fixture(t), value = await packet("", [
    { path: "data.bin", mediaType: "application/octet-stream", bytes: Uint8Array.of(0, 255, 17) },
  ], markdown("배포-工具"));
  assert.equal((await f.publish(value)).status, 200);
  await f.hook({ point: "get", fail: true });
  // When metadata and search are requested through the gateway with read-only browser authority.
  const who = browser("account-a", { scopes: ["skills:read"] });
  const listed = await catalog(f, who), found = await search(f, { query: "quartz" }, who);
  // Then no R2 get consumed the failure hook; the next actual body read fails.
  assert.equal(listed.status, 200);
  assert.equal(found.status, 200);
  assert.equal(listed.body.revision, 1);
  const skill = listed.body.skills[0], version = skill.versions[0];
  assert.equal(skill.name, "배포-工具");
  assert.equal(version.entry.name, "배포-工具");
  assert.equal(found.body.candidates[0].name, "배포-工具");
  assert.equal(version.entry.uri, uri(value));
  assert.deepEqual(version.manifest, value.manifest);
  assert.deepEqual(version.resources, value.manifest.resources.map(r => ({ ...r, uri: uri(value, r.path) })));
  assert.deepEqual(Object.keys(version.entry).sort(),
    ["aliasesKo", "bodyHead", "description", "digest", "examples", "invocation", "name", "uri", "whenToUse"]);
  assert.equal(version.entry.digest, value.manifest.resources[0].digest);
  assert.equal(version.current, true);
  assert.equal(version.pinned, false);
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.equal((await f.send("/resources/read", "POST", { uri: uri(value) })).status, 503);
});

test("search pages native rankings beyond fifty with a true pre-pagination total", async t => {
  // Given 55 real publications, advancing the fixture clock only at admission boundaries.
  const f = await fixture(t), value = await packet();
  for (let i = 0; i < 55; i++) {
    if (i % 20 === 0) await f.config({ now: now + i * 60000 });
    assert.equal((await f.publish(value, null, browser(), randomUUID())).status, 200);
  }
  // When native ranking is paged, including a page wholly beyond its end.
  const first = await search(f, { query: "quartz", limit: 50 });
  const tail = await search(f, { query: "quartz", limit: 50, offset: 50 });
  const middle = await search(f, { query: "quartz", limit: 3, offset: 7 });
  const empty = await search(f, { query: "quartz", offset: Number.MAX_SAFE_INTEGER });
  const defaults = await search(f, { query: "quartz" });
  const legacy = await f.send("/search", "POST", { query: "quartz", mode: "discovery", limit: 50 });
  // Then page rank, score, digest, order and matched terms equal the existing native search.
  for (const result of [first, tail, middle, empty]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 55);
    assert.match(result.body.traceId, /^[0-9a-f-]{36}$/);
  }
  assert.deepEqual(first.body.candidates, legacy.body.candidates);
  assert.deepEqual(middle.body.candidates, first.body.candidates.slice(7, 10));
  assert.deepEqual(tail.body.candidates.map(c => c.rank), [51, 52, 53, 54, 55]);
  assert.equal(new Set([...first.body.candidates, ...tail.body.candidates].map(c => c.uri)).size, 55);
  assert.deepEqual(empty.body.candidates, []);
  assert.equal(empty.body.abstained, undefined);
  assert.equal(defaults.body.candidates.length, 5);
  assert.equal(defaults.body.total, 55);
  privateSkillSearchResultSchema.parse(legacy.body);
  privateSkillCatalogSchema.parse((await f.send("")).body);
  privateSkillDetailSchema.parse((await f.send(`/${first.body.candidates[0].uri.split("/")[3]}`)).body);
});

test("search uses exact Local defaults bounds and abstention policy", async t => {
  // Given a real explicit-only publication.
  const f = await fixture(t);
  await f.publish(await packet("", [], markdown("배포", true)));
  // When Local-compatible requests and invalid bounds cross the new endpoint.
  const absent = await search(f), automatic = await search(f, { query: "quartz", mode: "automatic" });
  const explicit = await search(f, { query: "quartz", mode: "explicit" });
  const unknown = await search(f, { query: "zzqxv991" });
  const boundary = await search(f, { query: "x".repeat(2048), limit: 1, offset: 0 });
  // Then defaults, abstentions and strict boundary errors are preserved.
  assert.equal(absent.body.query, "");
  assert.equal(absent.body.mode, "discovery");
  assert.equal(absent.body.abstained.reason, "empty_query");
  assert.equal(automatic.body.abstained.reason, "explicit_only");
  assert.equal(unknown.body.abstained.reason, "no_overlap");
  assert.equal(explicit.body.total, 1);
  assert.equal(explicit.body.candidates[0].invocation, "explicit");
  assert.equal(boundary.status, 200);
  for (const input of [{ query: "x".repeat(2049) }, { mode: "other" }, { limit: 0 }, { limit: 51 },
    { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    { query: null }, { extra: true }]) {
    assert.equal((await search(f, input)).status, 400, JSON.stringify(input));
  }
});

test("catalog and projection refresh new heads pins unpins deletion and eviction without redeploy", async t => {
  // Given an already projected old version and two subsequent versions.
  const f = await fixture(t), old = await packet("old"), middle = await packet("middle"), next = await packet("next");
  let head = (await f.publish(old)).body.skill.head;
  assert.equal((await search(f, { query: "quartz" })).body.total, 1);
  head = (await f.send(`/${skillId}/pins`, "POST", { base: head, targetDigest: old.manifestDigest, pinned: true })).body.skill.head;
  head = (await f.publish(middle, head)).body.skill.head;
  head = (await f.publish(next, head)).body.skill.head;
  // When live metadata and a reconstructed projection are requested.
  await f.evict();
  const listed = await catalog(f), found = await search(f, { query: "quartz" });
  // Then only current plus explicitly pinned retained versions are advertised.
  assert.equal(listed.body.revision, 4);
  assert.deepEqual(new Set(listed.body.skills[0].versions.map(v => v.digest)), new Set([old.manifestDigest, next.manifestDigest]));
  assert.deepEqual(new Set(found.body.candidates.map(c => c.uri)), new Set([uri(old), uri(next)]));
  assert.equal((await f.send("/resources/read", "POST", { uri: uri(old) })).status, 200);
  assert.equal(listed.body.skills[0].versions.find(v => v.digest === old.manifestDigest).pinned, true);
  head = (await f.send(`/${skillId}/pins`, "POST", { base: head, targetDigest: old.manifestDigest, pinned: false })).body.skill.head;
  assert.equal((await catalog(f)).body.skills[0].versions.length, 1);
  assert.equal((await search(f, { query: "quartz" })).body.total, 1);
  assert.equal((await f.publish(await packet(), null, browser(), otherId)).status, 200);
  assert.equal((await search(f, { query: "quartz" })).body.total, 2);
  assert.equal((await f.send(`/${skillId}`, "DELETE", { base: head })).status, 200);
  assert.deepEqual((await catalog(f)).body.skills.map(s => s.skillId), [otherId]);
  const remaining = await search(f, { query: "quartz" });
  assert.equal(remaining.body.total, 1);
  assert.ok(remaining.body.candidates[0].uri.includes(otherId));
  assert.equal((await f.send("/resources/read", "POST", { uri: uri(old) })).status, 404);
});

test("account metadata and FTS statistics stay isolated even with identical skill IDs", async t => {
  // Given A's warm corpus and B's independent user/session/account.
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  await f.seed("account-b");
  const before = await search(f, { query: "quartz" });
  assert.deepEqual((await catalog(f, browser("account-b"))).body, { revision: 0, skills: [] });
  assert.equal((await search(f, { query: "quartz" }, browser("account-b"))).body.total, 0);
  // When B publishes independent Unicode metadata under A's same UUID.
  const foreign = await packet("", [], markdown("工具"));
  assert.equal((await f.publish(foreign, null, browser("account-b"))).status, 200);
  const other = await catalog(f, browser("account-b")), after = await search(f, { query: "quartz" });
  // Then neither metadata nor native rank/score leaks across accounts.
  assert.equal(other.body.skills[0].name, "工具");
  assert.equal((await catalog(f)).body.skills[0].name, "deploy");
  assert.deepEqual(after.body.candidates, before.body.candidates);
  assert.equal((await f.send("/resources/read", "POST", { uri: uri(value) }, browser("account-b"))).status, 404);
});

for (const route of ["catalog", "search"]) {
  test(`${route} final live fence rejects a browser revoked during D1 snapshot`, async t => {
    // Given a primary session and a revocation exactly at the snapshot batch boundary.
    const f = await fixture(t);
    await f.publish(await packet());
    await f.hook({ point: "batch", sql: "DELETE FROM sessions WHERE id=?", args: [browser().sessionId] });
    // When the native DO completes its metadata/projection work.
    const result = route === "catalog" ? await catalog(f) : await search(f, { query: "quartz" });
    // Then the final authority fence releases neither metadata nor candidates.
    assert.equal(result.status, 401);
    assert.equal(result.body.skills, undefined);
    assert.equal(result.body.candidates, undefined);
  });
}

test("new search uses existing search admission and read-only DO classification", async t => {
  // Given a real read-only browser and one account's fixed-minute search budget.
  const f = await fixture(t), who = browser("account-a", { scopes: ["skills:read"] });
  // Consume the actual catalog actor's search budget, not a substitute rate probe.
  for (let i = 0; i < 120; i++) {
    const result = await search(f, {}, who);
    assert.equal(result.status, 200);
  }
  // When another request reaches the same account DO, admission denies it.
  assert.equal((await search(f, {}, who)).status, 429);
  assert.equal((await catalog(f, who)).status, 200);
});
