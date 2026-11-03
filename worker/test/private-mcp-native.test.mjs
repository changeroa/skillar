// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { browser, origin } from "./helpers/private-mcp-auth.mjs";
import { createPrivateMcpNativeFixture as fixture, skillId } from "./helpers/private-mcp-native.mjs";
const markdown = "\uFEFF---\r\nname: 배포\r\ndescription: Deploy quartz services\r\nlicense: MIT\r\n" +
  "metadata:\r\n  소유자: synthetic\r\nallowed-tools: Read\r\ncustom: [원문, 3]\r\n---\r\nExact 원문 bytes.\r\n";
const packet = (body = markdown, files = []) => createPrivateSkillPackage([
  { path: "SKILL.md", mediaType: "text/markdown", bytes: new TextEncoder().encode(body) }, ...files,
]);
const wire = value => `skill://private/${skillId}/${value.manifestDigest}/SKILL.md`;
function completed(response) {
  assert.equal(response.status, 200);
  assert.equal(response.body.error, undefined);
  return response.body.result;
}

test("real resource Worker challenges bearers and rejects foreign origins and query selectors", async t => {
  const f = await fixture(t);
  const unauthenticated = await f.forward("resource", `${origin}/mcp`, { method: "GET" });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate"), /oauth-protected-resource\/mcp/);
  const metadata = await f.forward("resource", `${origin}/.well-known/oauth-protected-resource/mcp`, { method: "GET" });
  assert.equal(metadata.body.resource, `${origin}/mcp`);
  assert.deepEqual(metadata.body.authorization_servers, [origin]);
  const issued = await f.pat();
  assert.equal((await f.mcp(issued.token, "server/discover", {}, { headers: { origin: "https://evil.test" } })).status, 403);
  assert.equal((await f.forward("resource", `${origin}/mcp?access_token=not-accepted`, {
    headers: { authorization: `Bearer ${issued.token}` }, body: "{}",
  })).status, 400);
  assert.equal((await f.mcp("not-a-credential", "server/discover")).status, 401);
});

test("native MCP preserves complete Unicode frontmatter and exact BOM text and binary bytes", async t => {
  const f = await fixture(t), value = await packet(markdown, [
    { path: "data.bin", mediaType: "application/octet-stream", bytes: Uint8Array.of(0, 255, 128, 1) },
  ]);
  assert.equal((await f.publish(value)).status, 200);
  const issued = await f.pat();
  const discovery = completed(await f.mcp(issued.token, "server/discover"));
  assert.deepEqual(discovery.capabilities.extensions["io.modelcontextprotocol/skills"], {});
  const listed = completed(await f.mcp(issued.token, "skills/list"));
  assert.equal(listed.skills.length, 1);
  assert.equal(listed.skills[0].uri, wire(value));
  assert.deepEqual(listed.skills[0].frontmatter, {
    name: "배포", description: "Deploy quartz services", license: "MIT",
    metadata: { 소유자: "synthetic" }, "allowed-tools": "Read", custom: ["원문", 3],
  });
  assert.equal(listed.ttlMs, 60000);
  assert.deepEqual(completed(await f.mcp(issued.token, "skills/get", { uri: wire(value) })).skill, listed.skills[0]);
  const read = completed(await f.mcp(issued.token, "resources/read", { uri: wire(value) }));
  assert.equal(read.contents[0].text, markdown);
  assert.deepEqual(Buffer.from(read.contents[0].text), Buffer.from(markdown));
  const binaryUri = wire(value).replace("SKILL.md", "data.bin");
  assert.equal(completed(await f.mcp(issued.token, "resources/read", { uri: binaryUri })).contents[0].blob,
    Buffer.from([0, 255, 128, 1]).toString("base64"));
  const resources = completed(await f.mcp(issued.token, "resources/list")).resources;
  assert.deepEqual(new Set(resources.map(file => file.uri)), new Set([wire(value), binaryUri]));
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM device_streams").first()).n, 0);
});

test("MCP search and reads refresh publication versions and deletion without a daemon or redeploy", async t => {
  const f = await fixture(t), first = await packet(), second = await packet(markdown + "New version.\r\n");
  const issued = await f.pat();
  let head = (await f.publish(first)).body.skill.head;
  const found = completed(await f.mcp(issued.token, "tools/call", {
    name: "search_skills", arguments: { query: "quartz" },
  }));
  assert.equal(found.structuredContent.total, 1);
  assert.equal(found.structuredContent.candidates[0].uri, wire(first));
  assert.match(found.structuredContent.trace_id, /^[a-f0-9-]{36}$/);
  head = (await f.publish(second, head)).body.skill.head;
  assert.equal(completed(await f.mcp(issued.token, "skills/list")).skills[0].uri, wire(second));
  assert.equal(completed(await f.mcp(issued.token, "resources/read", { uri: wire(second) })).contents[0].text,
    markdown + "New version.\r\n");
  assert.equal((await f.api(`/${skillId}`, "DELETE", { base: head })).status, 200);
  assert.deepEqual(completed(await f.mcp(issued.token, "skills/list")).skills, []);
  assert.ok((await f.mcp(issued.token, "resources/read", { uri: wire(second) })).body.error);
});

test("private MCP cannot read another account's registered skill or reuse a revoked token", async t => {
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  const foreign = await f.manage("POST", { name: "B only", expiresInDays: 1, recordActivity: false }, browser("b"));
  assert.equal(foreign.status, 201);
  assert.deepEqual(completed(await f.mcp(foreign.body.token, "skills/list")).skills, []);
  assert.ok((await f.mcp(foreign.body.token, "resources/read", { uri: wire(value) })).body.error);
  const issued = await f.pat();
  completed(await f.mcp(issued.token, "skills/list"));
  await f.manage("DELETE", undefined, browser(), `/api/mcp/connections/${issued.connection.connectionId}`);
  assert.equal((await f.mcp(issued.token, "skills/list")).status, 401);
});

test("native standard resource listing pages above fifty without dropping cursors", async t => {
  const f = await fixture(t);
  const files = Array.from({ length: 55 }, (_, i) => ({
    path: `references/file-${String(i).padStart(2, "0")}.txt`, mediaType: "text/plain",
    bytes: new TextEncoder().encode(`synthetic ${i}`),
  }));
  const value = await packet(markdown, files);
  assert.equal((await f.publish(value)).status, 200);
  const issued = await f.pat();
  const first = completed(await f.mcp(issued.token, "resources/list"));
  assert.equal(first.resources.length, 50);
  assert.equal(typeof first.nextCursor, "string");
  const next = completed(await f.mcp(issued.token, "resources/list", { cursor: first.nextCursor }));
  assert.equal(next.resources.length, 6);
  assert.equal(next.nextCursor, undefined);
  assert.equal(new Set([...first.resources, ...next.resources].map(file => file.uri)).size, 56);
  assert.ok((await f.mcp(issued.token, "skills/list", { cursor: first.nextCursor })).body.error);
});

test("the actual OAuth resource wrapper supports the SDK legacy transport", async t => {
  const f = await fixture(t), issued = await f.pat(), value = await packet();
  await f.publish(value);
  const initialized = completed(await f.mcp(issued.token, "initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy", version: "1" },
  }, { legacy: true }));
  assert.equal(initialized.protocolVersion, "2025-11-25");
  const result = completed(await f.mcp(issued.token, "skills/list", {}, { legacy: true }));
  assert.equal(result.skills[0].uri, wire(value));
});

test("only explicit recording writes remote MCP observations through the account actor", async t => {
  const f = await fixture(t), value = await packet();
  await f.publish(value);
  const issued = await f.pat(true);
  const found = completed(await f.mcp(issued.token, "tools/call", {
    name: "search_skills", arguments: { query: "quartz" },
  }));
  const trace = found.structuredContent.trace_id;
  completed(await f.mcp(issued.token, "resources/read", {
    uri: wire(value), _meta: { "app.skillar/traceId": trace },
  }));
  const streams = await f.db.prepare("SELECT * FROM device_streams").all();
  assert.equal(streams.results.length, 1);
  assert.equal(streams.results[0].account_id, "account-a");
  assert.equal(streams.results[0].source_domain, "mcp");
  assert.equal(streams.results[0].sequence, 2);
  assert.equal((await f.rows("SELECT record_activity FROM mcp_connections"))[0].record_activity, 1);
});

test("real Pages bridge derives Google-session authority and completes native OAuth through the resource Worker", async t => {
  const f = await fixture(t);
  const session = await f.forward("session", origin, { method: "GET" });
  const cookie = session.body.cookie;
  const pages = async (path, { method = "GET", body, headers = {}, signedIn = true } = {}) => {
    const response = await f.rawForward("pages", `${origin}${path}`, {
      method, body, headers: { ...(signedIn ? { cookie } : {}), ...headers },
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text,
      body: response.headers.get("content-type")?.includes("application/json") && text ? JSON.parse(text) : null };
  };
  assert.equal((await pages("/api/mcp/connections", { signedIn: false,
    headers: { "x-skillar-principal": JSON.stringify(browser()) } })).status, 401);
  const registered = await pages("/oauth/register", { method: "POST",
    headers: { "content-type": "application/json" }, body: {
      client_name: "Pages native integration", redirect_uris: ["http://127.0.0.1:1455/callback"],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    } });
  assert.equal(registered.status, 201);
  const verifier = "pages-native-pkce-verifier-".repeat(3);
  const { createHash } = await import("node:crypto");
  const target = "/oauth/authorize?" + new URLSearchParams({
    response_type: "code", client_id: registered.body.client_id,
    redirect_uri: "http://127.0.0.1:1455/callback", state: "pages-native-state",
    scope: "skills:read offline_access", resource: `${origin}/mcp`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  });
  const redirect = await pages(target, { signedIn: false });
  assert.equal(redirect.status, 303);
  assert.equal(new URL(redirect.headers.get("location"), origin).searchParams.get("returnTo"), target);
  const consent = await pages(target);
  assert.equal(consent.status, 200);
  const handle = /name="handle" value="([^"]+)"/.exec(consent.text)?.[1];
  assert.ok(handle);
  const nativeCookies = consent.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const approved = await pages("/oauth/authorize", { method: "POST",
    headers: { origin, cookie: `${cookie}; ${nativeCookies}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, decision: "approve" }).toString() });
  assert.equal(approved.status, 302);
  const code = new URL(approved.headers.get("location")).searchParams.get("code");
  assert.ok(code);
  const tokens = await pages("/oauth/token", { method: "POST", signedIn: false,
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id: registered.body.client_id,
      redirect_uri: "http://127.0.0.1:1455/callback", code_verifier: verifier, resource: `${origin}/mcp`,
    }).toString() });
  assert.equal(tokens.status, 200);
  const value = await packet();
  await f.publish(value);
  const listed = completed(await f.mcp(tokens.body.access_token, "skills/list"));
  assert.equal(listed.skills[0].uri, wire(value));
  const connections = await pages("/api/mcp/connections");
  assert.equal(connections.status, 200);
  assert.equal(connections.body.connections[0].kind, "oauth");
  assert.equal(connections.body.connections[0].recordActivity, false);
  const revoked = await pages(`/api/mcp/connections/${connections.body.connections[0].connectionId}`, {
    method: "DELETE", headers: { origin },
  });
  assert.equal(revoked.status, 200);
  assert.equal((await f.mcp(tokens.body.access_token, "skills/list")).status, 401);
});

test("concurrent consented MCP calls serialize native recording cuts without dropping observations", async t => {
  const f = await fixture(t), issued = await f.pat(true);
  await f.publish(await packet());
  const calls = await Promise.all(Array.from({ length: 3 }, () => f.mcp(issued.token, "tools/call", {
    name: "search_skills", arguments: { query: "quartz" },
  })));
  for (const response of calls) assert.equal(completed(response).isError, undefined);
  const stream = await f.db.prepare("SELECT sequence,journal_through FROM device_streams").first();
  assert.equal(stream.sequence, 3);
  assert.equal(stream.journal_through, 3);
});

test("HTTP cancellation reaches the in-flight native SDK resource handler and its backend signal", async t => {
  const f = await fixture(t), issued = await f.pat();
  const value = await packet();
  await f.publish(value);
  const response = await f.forward("cancel", origin, { body: { token: issued.token, uri: wire(value) } });
  assert.equal(response.status, 200);
  assert.equal(response.body.backendAborted, true);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM device_streams").first()).n, 0);
});

test("malformed local trace metadata returns invalid params before recording a read", async t => {
  const f = await fixture(t), issued = await f.pat(true), value = await packet();
  await f.publish(value);
  for (const _meta of [
    { "app.skillar/traceId": 123 }, { "app.skillar/traceId": null },
    { "app.gisool/traceId": "x".repeat(129) },
  ]) {
    const response = await f.mcp(issued.token, "resources/read", { uri: wire(value), _meta });
    assert.equal(response.body.error.code, -32602);
  }
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM device_streams").first()).n, 0);
});
