import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, browser, ids } from "./private-packs-fixture.test.mjs";

const selected = (...receipts) => ({ packs: receipts.map(({ uri, digest }) => ({ uri, digest })) });
test("combined loading deduplicates private versions without losing conditions or explicit invocation", async t => {
  // Given two packs with shared membership and distinct conditions.
  const f = await fixture(t);
  const first = (await f.send("create", f.create(f.definition("first-pack")))).body;
  const second = (await f.send("create", f.create(f.definition("second-pack")))).body;
  // When both immutable versions are selected.
  const loaded = await f.send("load", selected(first, second));
  // Then every original requirement survives, without loading bodies or granting permissions.
  assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
  assert.equal(loaded.body.composition.declared_members, 10);
  assert.equal(loaded.body.composition.unique_members, 5);
  const conditional = loaded.body.members.find(member => member.requirements[0].selection === "when_applicable");
  assert.deepEqual(conditional.requirements.map(member => member.when), ["first-pack conditions", "second-pack conditions"]);
  assert.equal(loaded.body.members.find(member => member.phase === "explain").invocation, "explicit");
  assert.deepEqual(loaded.body.members.map(member => member.phase), ["scope", "investigate", "investigate", "verify", "explain"]);
  assert.deepEqual(loaded.body.permissions, { grants_execution: false, grants_delegation: false, grants_publication: false });
  const reads = await f.send("/test/reads", {});
  assert.ok(reads.body.every(key => key.includes("/private-packs/")));
});

test("search ranks only the account corpus and respects offset limit and empty explicit browsing", async t => {
  // Given three published account-local packs.
  const f = await fixture(t);
  for (const name of ["alpha-pack", "beta-pack", "gamma-pack"]) await f.send("create", f.create(f.definition(name)));
  // When browsing the second page and searching a named pack.
  const page = await f.send("search", { mode: "explicit", offset: 1, limit: 1 });
  const query = await f.send("search", { query: "gamma-pack" });
  const foreign = await f.send("search", { mode: "explicit" },
    browser({ accountId: "account-b", sessionId: "b".repeat(40) }));
  // Then paging is over the complete authorized ranking, never another account.
  assert.equal(page.body.totalMatches, 3);
  assert.equal(page.body.packs[0].name, "beta-pack");
  assert.equal(page.body.nextOffset, 2);
  assert.equal(query.body.packs[0].name, "gamma-pack");
  assert.deepEqual(foreign.body.packs, []);
});

test("old pack and skill digests remain immutable after their heads advance", async t => {
  // Given one published pack and a second retained version of one member.
  const f = await fixture(t), input = f.create(), first = (await f.send("create", input)).body;
  const old = (await f.send("load", selected(first))).body;
  const nextUri = await f.seedSkill(ids[1], "new-version");
  await f.accounts.prepare("UPDATE private_skills SET digest=? WHERE skill_id=?")
    .bind(nextUri.split("/")[4], ids[1]).run();
  const definition = { ...input.definition, members: input.definition.members.map(member =>
    member.phase === "investigate" && member.selection === "required" ? { ...member, uri: nextUri } : member) };
  await f.send("update", { ...f.create(definition), uri: first.uri, expected_digest: first.digest });
  // When the original immutable pack selection is loaded again.
  const retained = await f.send("load", selected(first));
  // Then all original member versions remain pinned, not silently replaced with heads.
  assert.equal(retained.status, 200);
  assert.deepEqual(retained.body.members, old.members);
  assert.equal(retained.body.packs[0].publication_status, "verified_snapshot");
});

for (const [label, edit] of [
  ["missing required scope", definition => { definition.members[0].selection = "when_applicable"; }],
  ["duplicate skill membership", definition => { definition.members[3].uri = definition.members[1].uri; }],
  ["public member", definition => { definition.members[1].uri = "skill://skillar/iyen/public/SKILL.md"; }],
  ["support-file member", definition => { definition.members[1].uri = definition.members[1].uri.replace("SKILL.md", "notes.md"); }],
  ["extra schema field", definition => { definition.extra = true; }],
]) test(`invalid ${label} creates no job or ciphertext`, async t => {
  // Given a structurally invalid pack.
  const f = await fixture(t), definition = f.definition();
  edit(definition);
  // When create parses the untrusted boundary.
  const response = await f.send("create", f.create(definition));
  // Then no durable mutation is attempted.
  assert.equal(response.status, 400);
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_jobs"), []);
  assert.deepEqual((await f.bucket.list()).objects, []);
});

for (const [label, sql] of [
  ["unpinned", "UPDATE private_skill_versions SET pinned=0"],
  ["tombstoned", "UPDATE private_skills SET tombstoned=1"],
  ["deleting", "UPDATE private_skill_versions SET deleting_revision=2"],
]) test(`${label} private skill membership fails writes and hides retained packs`, async t => {
  // Given an existing pack whose referenced authority changes.
  const f = await fixture(t), input = f.create(), first = (await f.send("create", input)).body;
  await f.accounts.prepare(sql).run();
  // When the pack is discovered, loaded or used in a new write.
  const search = await f.send("search", { mode: "explicit" });
  const load = await f.send("load", selected(first));
  const create = await f.send("create", f.create(f.definition("another-pack")));
  // Then old membership cannot bypass current deletion or retention authority.
  assert.deepEqual(search.body.packs, []);
  assert.equal(load.status, 409);
  assert.equal(create.status, 409);
});

test("foreign-account skill metadata cannot satisfy membership by matching UUID and digest", async t => {
  // Given a version present only in account B.
  const f = await fixture(t), definition = f.definition();
  definition.members[1].uri = await f.seedSkill(ids[1], "foreign", "account-b");
  // When account A names that exact private URI.
  const response = await f.send("create", f.create(definition));
  // Then metadata lookup remains account-scoped.
  assert.equal(response.body.error, "member_unavailable");
  assert.deepEqual(await f.rows("SELECT * FROM private_pack_jobs"), []);
});

test("combined packs reject incompatible versions and conflicting phases", async t => {
  // Given individually valid packs with incompatible shared membership.
  const f = await fixture(t), first = (await f.send("create", f.create())).body;
  const version = f.definition("different-version");
  version.members[1].uri = await f.seedSkill(ids[1], "second");
  const second = (await f.send("create", f.create(version))).body;
  const phase = f.definition("different-phase");
  phase.members[3].phase = "handoff";
  const third = (await f.send("create", f.create(phase))).body;
  // When either incompatible pair is composed.
  const results = await Promise.all([second, third].map(receipt => f.send("load", selected(first, receipt))));
  // Then neither phase nor immutable version conflict is silently deduplicated.
  assert.deepEqual(results.map(result => result.body.error), ["member_conflict", "member_conflict"]);
});

test("load selection and search bounds are strict", async t => {
  // Given one valid pack selection.
  const f = await fixture(t), first = (await f.send("create", f.create())).body;
  // When caller requests duplicates, more than eight, unpinned versions or invalid pages.
  const results = [
    await f.send("load", selected(first, first)),
    await f.send("load", { packs: Array.from({ length: 9 }, (_, i) => ({ uri: `pack://private/pack-${i}`, digest: first.digest })) }),
    await f.send("load", { packs: [{ uri: first.uri }] }),
    await f.send("search", { mode: "automatic", query: "quartz" }),
    await f.send("search", { mode: "explicit", limit: 51 }),
    await f.send("search", { mode: "explicit", offset: -1 }),
    await f.send("search", { query: "" }),
  ];
  // Then the server rejects every invalid boundary without widening the contracts.
  assert.deepEqual(results.map(result => result.status), Array(results.length).fill(400));
});

test("pack tombstones fence reads writes replays and status", async t => {
  // Given a retained pack with a permanent tombstone.
  const f = await fixture(t), input = f.create(), first = (await f.send("create", input)).body;
  await f.db.prepare("UPDATE private_pack_heads SET tombstoned=1").run();
  // When old selections and write identities are replayed.
  const results = await Promise.all([
    f.send("load", selected(first)), f.send("create", input),
    f.send("status", { request_id: input.request_id }),
    f.send("update", { ...input, request_id: randomUUID(), uri: first.uri, expected_digest: first.digest }),
  ]);
  // Then no tombstone can be bypassed, including by historical versions.
  assert.deepEqual(results.map(result => result.status), [404, 410, 410, 410]);
  assert.deepEqual((await f.send("search", { mode: "explicit" })).body.packs, []);
  await assert.rejects(f.db.prepare("UPDATE private_pack_heads SET tombstoned=0").run(), /pack_tombstoned/);
});

test("corrupt ciphertext cannot load or advertise a published write status", async t => {
  // Given a published directory whose object bytes are corrupted.
  const f = await fixture(t), input = f.create(), first = (await f.send("create", input)).body;
  const [job] = await f.rows("SELECT * FROM private_pack_jobs");
  const envelope = await (await f.bucket.get(job.object_key)).json();
  envelope.ciphertext = "AAAA";
  await f.bucket.put(job.object_key, JSON.stringify(envelope));
  // When load or status resolves the claimed publication.
  const results = await Promise.all([
    f.send("load", selected(first)), f.send("status", { request_id: input.request_id }),
  ]);
  // Then metadata never substitutes for authenticated ciphertext.
  assert.deepEqual(results.map(result => result.body.error), ["pack_integrity", "pack_integrity"]);
});

test("existing MCP read scope loads packs but never authorizes writes", async t => {
  // Given a live read-only PAT connection and a browser-published pack.
  const f = await fixture(t), input = f.create(), first = (await f.send("create", input)).body;
  const connectionId = randomUUID();
  const who = browser({ kind: "mcp", sessionId: null, deviceId: "device-a",
    tokenHash: "a".repeat(64), connectionId, scopes: ["skills:read"] });
  await f.accounts.prepare(`INSERT INTO mcp_connections
    (connection_id,account_id,auth_generation,device_id,kind,name,token_hash,scopes_json,created_at,expires_at)
    VALUES(?,'account-a',1,'device-a','pat','fixture',?,'["skills:read"]',0,1793730000)`)
    .bind(connectionId, who.tokenHash).run();
  // When the existing principal reads and attempts to write.
  const search = await f.send("search", { query: "quartz" }, who);
  const load = await f.send("load", selected(first), who);
  const write = await f.send("create", f.create(f.definition("mcp-write")), who);
  // Then only the previously granted read surface works.
  assert.equal(search.status, 200);
  assert.equal(load.status, 200);
  assert.equal(write.status, 403);
  await f.accounts.prepare("UPDATE mcp_connections SET revoked_at=1").run();
  assert.equal((await f.send("load", selected(first), who)).status, 401);
});
