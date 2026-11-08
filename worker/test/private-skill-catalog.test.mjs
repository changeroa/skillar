// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, packet, browser, device, skillId, otherId, uri, key } from "./helpers/private-skill-backend.mjs";

test("publication derives routing fields and round trips immutable byte-verified resources", async t => {
  // Given a validated package with a binary supporting resource.
  const f = await fixture(t), value = await packet("firstmarker", [
    { path: "data.bin", mediaType: "application/octet-stream", bytes: Uint8Array.of(0, 255, 17) },
  ]);
  // When a browser publishes it and a scoped device reads the directory and bytes.
  const published = await f.publish(value);
  assert.equal(published.status, 200);
  const catalog = await f.send("", "GET", undefined, device());
  const exported = await f.send(`/${skillId}/versions/${value.manifestDigest}`);
  const resource = await f.send("/resources/read", "POST", { uri: uri(value, "data.bin") }, device());
  // Then caller-independent metadata, canonical packages and exact bytes are returned.
  assert.equal(catalog.body.revision, 1);
  assert.equal(catalog.body.skills[0].name, "deploy");
  assert.equal(catalog.body.skills[0].description, "Deploy quartz services");
  assert.deepEqual(exported.body.package, value);
  assert.deepEqual(resource.body, { uri: uri(value, "data.bin"), digest: value.manifest.resources[1].digest,
    bytes: 3, mediaType: "application/octet-stream", body: "AP8R" });
  assert.equal(await f.bucket.get(key(value)) === null, false);
  const changes = await f.rows(f.activity, "SELECT invalidation_kind FROM account_changes");
  assert.deepEqual(changes, [{ invalidation_kind: "skills" }]);
});

test("two independent accounts cannot read write export or search each other's skill", async t => {
  // Given genuinely independent user, session, token and account rows.
  const f = await fixture(t), value = await packet("only-account-a");
  await f.seed("account-b");
  const head = (await f.publish(value)).body.skill.head;
  // When B tries A's known ID, URI, base and digest.
  const observations = [
    await f.send(`/${skillId}`, "GET", undefined, browser("account-b")),
    await f.send(`/${skillId}/versions/${value.manifestDigest}`, "GET", undefined, device("account-b")),
    await f.send("/resources/read", "POST", { uri: uri(value) }, browser("account-b")),
    await f.publish(await packet("forged"), head, device("account-b")),
  ];
  const search = await f.send("/search", "POST", { query: "quartz", mode: "discovery", limit: 50 }, browser("account-b"));
  // Then nothing from A leaks or changes; B may independently allocate the same UUID.
  assert.deepEqual(observations.map(result => result.status), [404, 404, 404, 409]);
  assert.deepEqual(search.body.candidates, []);
  assert.equal((await f.publish(await packet("separate"), null, browser("account-b"))).status, 200);
  assert.equal((await f.send(`/${skillId}`)).body.skill.head.digest, head.digest);
  assert.notEqual(await f.bucket.get(key(value, "SKILL.md", "account-b")), await f.bucket.get(key(value)));
});

test("two writers have one CAS winner and revision prevents head ABA", async t => {
  // Given a published base shared by two writers.
  const f = await fixture(t), first = await packet("first"), second = await packet("second"), third = await packet("third");
  const base = (await f.publish(first)).body.skill.head;
  // When independent requests race, then the winner reverts to the original digest.
  const writers = await Promise.all([f.publish(second, base), f.publish(third, base)]);
  const winner = writers.find(result => result.status === 200);
  const reverted = await f.send(`/${skillId}/head`, "POST", { base: winner.body.skill.head, targetDigest: first.manifestDigest });
  const stale = await f.publish(third, base);
  // Then stale digest equality cannot bypass revision CAS or duplicate notifications.
  assert.deepEqual(writers.map(result => result.status).sort(), [200, 409]);
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.skill.head.digest, first.manifestDigest);
  assert.equal(reverted.body.skill.head.revision, 3);
  assert.equal(stale.status, 409);
  assert.equal((await f.send("")).body.revision, 3);
  assert.equal((await f.rows(f.activity, "SELECT * FROM account_changes")).length, 3);
});

test("pins advance CAS and keep old digest resources searchable through new heads and eviction", async t => {
  // Given an old digest pinned before a new head is published.
  const f = await fixture(t), first = await packet("oldmarker"), next = await packet("newmarker");
  const base = (await f.publish(first)).body.skill.head;
  const pinned = await f.send(`/${skillId}/pins`, "POST", { base, targetDigest: first.manifestDigest, pinned: true });
  const published = await f.publish(next, pinned.body.skill.head);
  const again = await f.send(`/${skillId}/pins`, "POST", {
    base: published.body.skill.head, targetDigest: first.manifestDigest, pinned: true,
  });
  await f.evict();
  // When the rebuilt account projection and old pinned resources are read.
  const found = await f.send("/search", "POST", { query: "quartz", mode: "discovery", limit: 50 });
  const old = await f.send("/resources/read", "POST", { uri: uri(first) });
  const current = await f.send("/resources/read", "POST", { uri: uri(next) });
  const protectedVersion = await f.send(`/${skillId}/versions/${first.manifestDigest}`, "DELETE",
    { base: again.body.skill.head });
  // Then both exact version URIs survive, and pin-only/no-op mutations advance revision.
  assert.equal(again.body.skill.head.revision, 4);
  assert.deepEqual(new Set(found.body.candidates.map(candidate => candidate.uri)), new Set([uri(first), uri(next)]));
  for (const value of [first, next]) {
    assert.equal(found.body.candidates.find(candidate => candidate.uri === uri(value)).digest,
      value.manifest.resources.find(resource => resource.path === "SKILL.md").digest);
  }
  assert.match(Buffer.from(old.body.body, "base64").toString(), /oldmarker/);
  assert.match(Buffer.from(current.body.body, "base64").toString(), /newmarker/);
  assert.equal(protectedVersion.body.error, "version_protected");
});

test("authoritative catalog revision replaces search projection after mutations", async t => {
  // Given an existing projected catalog.
  const f = await fixture(t), first = await packet("first");
  await f.publish(first);
  const search = () => f.send("/search", "POST", { query: "quartz", mode: "discovery", limit: 50 });
  assert.equal((await search()).body.candidates.length, 1);
  // When another skill is published and the first is deleted.
  const second = await f.publish(await packet("other"), null, browser(), otherId);
  const detail = await f.send(`/${skillId}`);
  await f.send(`/${skillId}`, "DELETE", { base: detail.body.skill.head });
  // Then the live search corpus contains only the remaining authority entry.
  assert.equal(second.status, 200);
  const found = await search();
  assert.equal(found.body.candidates.length, 1);
  assert.match(found.body.candidates[0].uri, new RegExp(otherId));
});
