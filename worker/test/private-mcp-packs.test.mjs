import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { browser, origin } from "./helpers/private-mcp-auth.mjs";
import { createPrivateMcpNativeFixture } from "./helpers/private-mcp-native.mjs";

async function fixture(t) {
  const f = await createPrivateMcpNativeFixture(t), members = [];
  for (const phase of ["scope", "investigate", "verify"]) {
    const id = randomUUID(), packet = await createPrivateSkillPackage([{
      path: "SKILL.md", mediaType: "text/markdown",
      bytes: new TextEncoder().encode(`---\nname: ${phase}\ndescription: Synthetic pack ${phase}\n---\nSynthetic body.\n`),
    }]);
    const published = await f.publish(packet, null, browser(), id);
    assert.equal(published.status, 200);
    const pinned = await f.api(`/${id}/pins`, "POST", {
      base: published.body.skill.head, targetDigest: packet.manifestDigest, pinned: true,
    });
    assert.equal(pinned.status, 200);
    members.push({
      uri: `skillar://private/${id}/${packet.manifestDigest}/SKILL.md`,
      phase, selection: "required", when: `Synthetic ${phase} condition`,
    });
  }
  const definition = {
    schema_version: 1, kind: "skill-pack", name: "native-pack", display_name: "Native pack",
    description: "Synthetic parity pack", scope: "Synthetic review", members,
  };
  const cookie = (await f.forward("session", origin)).body.cookie;
  const create = () => f.forward("web", `${origin}/api/packs/create`, {
    headers: { cookie, origin, "content-type": "application/json" },
    body: { request_id: randomUUID(), acknowledge_private_upload: true, definition },
  });
  return { ...f, definition, create };
}

test("a private-only Google account can publish its first pack without activity upload consent", async t => {
  // Given explicitly published and pinned private skills, but no activity upload consent.
  const f = await fixture(t);
  assert.equal((await f.primaryD1.prepare("SELECT count(*) n FROM device_consents WHERE account_id='account-a'").first()).n, 0);
  // When the real Google-session Pages boundary creates the first private pack.
  const response = await f.create();
  // Then it publishes without requiring unrelated raw activity consent.
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, "published");
  assert.equal(response.body.content_durable, true);
  assert.equal(response.body.searchable, true);
});

test("existing read-only MCP connections search and compose pinned private packs", async t => {
  // Given a published private pack and an ordinary read-only MCP connection.
  const f = await fixture(t), created = await f.create();
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const issued = await f.pat();
  // When the actual resource Worker searches and composes its pinned pack.
  const search = await f.mcp(issued.token, "tools/call", {
    name: "search_packs", arguments: { mode: "explicit", query: "", limit: 5 },
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.error, undefined, JSON.stringify(search.body));
  const found = search.body.result.structuredContent.packs[0];
  const loaded = await f.mcp(issued.token, "tools/call", {
    name: "load_pack", arguments: { packs: [{ uri: found.uri, digest: found.digest }] },
  });
  // Then host-readable member URIs retain every condition and no execution authority.
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.error, undefined, JSON.stringify(loaded.body));
  const result = loaded.body.result.structuredContent;
  assert.equal(result.members.length, 3);
  assert.ok(result.members.every(member => member.uri.startsWith("skill://private/")));
  assert.deepEqual(result.members.map(member => member.requirements[0].when).sort(),
    f.definition.members.map(member => member.when).sort());
  assert.deepEqual(result.permissions, { grants_execution: false, grants_delegation: false, grants_publication: false });
});

test("a private pack does not become readable through another account's MCP connection", async t => {
  // Given a pack owned by account A and a distinct authenticated account B.
  const f = await fixture(t), created = await f.create();
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const foreign = await f.manage("POST", { name: "Synthetic B", expiresInDays: 1, recordActivity: false }, browser("b"));
  assert.equal(foreign.status, 201);
  const direct = await f.forward("activity", "https://activity.internal/v1/private-packs/search", {
    headers: { "content-type": "application/json", "x-skillar-principal": JSON.stringify(browser("b")) },
    body: { mode: "explicit", query: "" },
  });
  assert.equal(direct.status, 200, JSON.stringify(direct.body));
  // When B searches the private pack catalog.
  const search = await f.mcp(foreign.body.token, "tools/call", {
    name: "search_packs", arguments: { mode: "explicit", query: "" },
  });
  // Then its catalog contains none of A's packs.
  assert.equal(search.status, 200);
  assert.equal(search.body.error, undefined, JSON.stringify(search.body));
  assert.deepEqual(search.body.result.structuredContent.packs, []);
});
