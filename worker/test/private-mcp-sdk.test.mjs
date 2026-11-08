// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const version = "2026-07-28";
const versionKey = "io.modelcontextprotocol/protocolVersion";
const capsKey = "io.modelcontextprotocol/clientCapabilities";
const extension = "io.modelcontextprotocol/skills";
const alpha = "skill://sdk-gates/alpha/SKILL.md";
const markdown = "---\nname: alpha\ndescription: SDK gate alpha\n---\nAlpha body.\n";
const bundle = build({
  entryPoints: [fileURLToPath(new URL("./fixtures/private-mcp-sdk.ts", import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:*", "node:*"],
});

async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "private-mcp-sdk", compatibilityDate: "2026-09-03",
    compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
  } }] });
  t.after(() => runtime.dispose());
  return async (body, options = {}) => {
    const { headers = {}, method = "POST", url = "https://sdk.test/mcp" } = options;
    const response = await runtime.dispatchFetch(url, {
      method,
      headers: { host: new URL(url).host,
        accept: "application/json, text/event-stream", "content-type": "application/json",
        ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const messages = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n/).filter(line => line.startsWith("data:"))
        .map(line => JSON.parse(line.slice(5)))
      : text && response.headers.get("content-type")?.includes("application/json") ? [JSON.parse(text)] : [];
    return { status: response.status, headers: response.headers, messages, body: messages.at(-1) };
  };
}

function modern(method, params = {}) {
  return { jsonrpc: "2.0", id: 17, method, params: {
    ...params, _meta: { [versionKey]: version, [capsKey]: { extensions: { [extension]: {} } } },
  } };
}

function headers(body) {
  const name = body.method === "tools/call" ? body.params.name
    : body.method === "resources/read" ? body.params.uri : undefined;
  return { "MCP-Protocol-Version": version, "Mcp-Method": body.method,
    ...(name === undefined ? {} : { "Mcp-Name": name }) };
}

async function complete(send, method, params) {
  const request = modern(method, params);
  const response = await send(request, { headers: headers(request) });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.id, 17);
  assert.equal(response.body.error, undefined, JSON.stringify(response.body));
  assert.equal(response.body.result.resultType, "complete");
  assert.deepEqual(response.body.result._meta["io.modelcontextprotocol/serverInfo"],
    { name: "sdk-gates", version: "1.0.0" });
  return response.body.result;
}

test("G1: installed versions are the explicitly gated SDK pair", async () => {
  // Given installed packages; when reading their actual manifests; then pin the gate's subject.
  for (const [name, expected] of [["agents", "0.33.0"], ["@modelcontextprotocol/server", "2.4.0"]]) {
    const pkg = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url)));
    assert.equal(pkg.version, expected);
  }
});

test("G1: modern discovery advertises native SkillsExtension and standard SDK capabilities", async t => {
  // Given real workerd; when discovering without a handshake; then inspect advertised capabilities.
  const result = await complete(await fixture(t), "server/discover");
  assert.deepEqual(result.supportedVersions, [version]);
  assert.deepEqual(result.capabilities.extensions[extension], { directoryRead: true });
  assert.ok(result.capabilities.tools);
  assert.ok(result.capabilities.resources);
  assert.equal(typeof result.instructions, "string");
});

test("G1: standard SDK tools list and call remain intact with skills attached", async t => {
  // Given the extension-equipped server; when using standard tools; then get typed callback output.
  const send = await fixture(t);
  const list = await complete(send, "tools/list");
  assert.deepEqual(list.tools.map(tool => tool.name), ["search_skills"]);
  assert.equal(list.tools[0].inputSchema.properties.query.type, "string");
  const call = await complete(send, "tools/call", { name: "search_skills", arguments: { query: "needle" } });
  assert.deepEqual(JSON.parse(call.content[0].text), { query: "needle", fixture: true });
});

test("G1: typed skills list pagination and get expose byte-accurate manifests", async t => {
  // Given a two-skill native catalog; when listing/getting; then preserve cursors, cache and digests.
  const send = await fixture(t);
  const first = await complete(send, "skills/list");
  assert.deepEqual(first.skills.map(skill => skill.uri), [alpha]);
  assert.equal(typeof first.nextCursor, "string");
  const second = await complete(send, "skills/list", { cursor: first.nextCursor });
  assert.deepEqual(second.skills.map(skill => skill.uri), ["skill://sdk-gates/beta/SKILL.md"]);
  assert.equal(second.nextCursor, undefined);
  const got = await complete(send, "skills/get", { uri: alpha });
  assert.deepEqual(got.skill, first.skills[0]);
  assert.equal(got.skill.frontmatter.name, "alpha");
  assert.equal(got.ttlMs, 30_000);
  assert.equal(got.cacheScope, "private");
  assert.deepEqual(got.skill.resources.find(resource => resource.uri === alpha), {
    uri: alpha, digest: `sha256:${createHash("sha256").update(markdown).digest("hex")}`,
    size: Buffer.byteLength(markdown),
  });
  assert.equal(got.skill.resources.length, 3);
});

test("G1: SDK resources list and read serve standard, skill text and binary bytes", async t => {
  // Given registered resources and the native catalog; when reading; then return exact text/blob bytes.
  const send = await fixture(t);
  const list = await complete(send, "resources/list");
  assert.ok(list.resources.some(resource => resource.uri === "fixture://info"));
  assert.ok(list.resources.some(resource => resource.uri === alpha));
  for (const [uri, field, expected] of [
    ["fixture://info", "text", "SDK fixture.\n"],
    [alpha, "text", markdown],
    ["skill://sdk-gates/alpha/references/guide.txt", "text", "Supporting text.\n"],
    ["skill://sdk-gates/alpha/data.bin", "blob", Buffer.from([0, 255, 128, 1]).toString("base64")],
  ]) {
    const result = await complete(send, "resources/read", { uri });
    assert.equal(result.contents[0].uri, uri);
    assert.equal(result.contents[0][field], expected);
  }
});

test("G2: modern protocol and method/name headers are validated before dispatch", async t => {
  // Given valid envelopes; when corrupting one wire contract; then reject with the protocol error.
  const send = await fixture(t);
  const cases = [
    ["missing protocol", "tools/list", {}, { "MCP-Protocol-Version": undefined }, -32020],
    ["missing method", "tools/list", {}, { "Mcp-Method": undefined }, -32020],
    ["wrong method", "tools/list", {}, { "Mcp-Method": "resources/list" }, -32020],
    ["protocol disagreement", "tools/list", {}, { "MCP-Protocol-Version": "2025-11-25" }, -32020],
    ["missing tool name", "tools/call", { name: "search_skills", arguments: { query: "x" } },
      { "Mcp-Name": undefined }, -32020],
    ["wrong tool name", "tools/call", { name: "search_skills", arguments: { query: "x" } },
      { "Mcp-Name": "other" }, -32020],
    ["missing resource name", "resources/read", { uri: alpha }, { "Mcp-Name": undefined }, -32020],
    ["wrong resource name", "resources/read", { uri: alpha }, { "Mcp-Name": "skill://other" }, -32020],
    ["bad name encoding", "resources/read", { uri: alpha }, { "Mcp-Name": "=?base64?%%%?=" }, -32020],
  ];
  for (const [label, method, params, changes, code] of cases) await t.test(label, async () => {
    const request = modern(method, params);
    const wireHeaders = { ...headers(request), ...changes };
    for (const key of Object.keys(wireHeaders)) if (wireHeaders[key] === undefined) delete wireHeaders[key];
    const response = await send(request, { headers: wireHeaders });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.error.code, code);
    assert.equal(response.body.result, undefined);
  });
  await t.test("unsupported revision", async () => {
    const request = modern("tools/list");
    request.params._meta[versionKey] = "2027-01-01";
    const response = await send(request, { headers: { ...headers(request), "MCP-Protocol-Version": "2027-01-01" } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32022);
  });
  await t.test("missing modern metadata never falls back to legacy", async () => {
    const request = modern("tools/list");
    delete request.params._meta;
    const response = await send(request, { headers: headers(request) });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32602);
  });
  await t.test("base64 name sentinel decodes before matching", async () => {
    const request = modern("resources/read", { uri: alpha });
    const response = await send(request, { headers: { ...headers(request),
      "Mcp-Name": `=?base64?${Buffer.from(alpha).toString("base64")}?=` } });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.contents[0].text, markdown);
  });
});

test("G2: Agents stateless legacy lane initializes, acknowledges notifications and pings", async t => {
  // Given no modern envelope; when using legacy Streamable HTTP; then no durable session is promised.
  const send = await fixture(t);
  const init = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "gate", version: "1" },
  } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-11-25");
  assert.equal(init.headers.get("mcp-session-id"), null);
  for (const method of ["notifications/initialized", "notifications/cancelled"]) {
    const response = await send({ jsonrpc: "2.0", method,
      ...(method === "notifications/cancelled" ? { params: { requestId: 999 } } : {}) });
    assert.equal(response.status, 202);
    assert.deepEqual(response.messages, []);
  }
  const ping = await send({ jsonrpc: "2.0", id: 2, method: "ping" });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.body, { jsonrpc: "2.0", id: 2, result: {} });
  const tools = await send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(tools.body.result.tools.map(tool => tool.name), ["search_skills"]);
  for (const method of ["GET", "DELETE"]) {
    const response = await send(undefined, { method, headers: { "MCP-Protocol-Version": "2025-11-25" } });
    assert.equal(response.status, 405);
    assert.equal(response.body.error.code, -32000);
  }
});

test("G2: Agents Origin option rejects an untrusted origin", async t => {
  // Given an allowed runtime Host; when Origin is outside the allowlist; then reject before MCP serving.
  const send = await fixture(t);
  const request = modern("server/discover");
  const response = await send(request, {
    headers: { ...headers(request), origin: "https://untrusted.test" },
  });
  assert.equal(response.status, 403);
});
