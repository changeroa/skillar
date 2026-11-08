import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { result } from "./helpers/activity-reports.mjs";

const connectionId = "11111111-1111-4111-8111-111111111111";
const context = {
  principal: { kind: "mcp", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", issuer: "https://skillar.sh", scopes: ["skills:read"],
    sessionId: null, tokenHash: "a".repeat(64), connectionId },
  recordActivity: true, clientName: "Synthetic MCP client",
};
const uri = "skill://local/synthetic/example/SKILL.md";
const search = { query: "synthetic telemetry query", traceId: "synthetic-trace", mode: "automatic",
  elapsedMs: 1, total: 1, candidates: [{ uri, name: "example", description: "synthetic",
    score: 1, rank: 1, invocation: "automatic", digest: "synthetic", matched: [] }] };
const read = { uri, skillUri: uri, path: "SKILL.md", bytes: 123,
  manifestDigest: "synthetic-manifest", traceId: search.traceId };
const bundle = build({ entryPoints: [new URL("./fixtures/private-mcp-telemetry.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  external: ["cloudflare:workers", "cloudflare:workflows"] });
async function migrate(db, file) {
  const sql = await readFile(file, "utf8"), statements = [];
  let current = "", trigger = false;
  for (const line of sql.replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim())); current = ""; trigger = false;
    }
  }
  assert.equal(current, "");
  await db.batch(statements);
}
async function fixture(t, recordActivity = true, connectionKind = "pat") {
  const events = new EventEmitter();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks));
    events.emit(value.jobId, value); response.end("ok");
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1"); await listening;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "private-mcp-telemetry", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } }, exports: {}, env: {
      ACCOUNTS: { type: "d1", name: "telemetry-accounts" },
      ACTIVITY: { type: "d1", name: "telemetry-activity" },
      ACTIVITY_RAW: { type: "r2", name: "telemetry-content" },
      CONTENT_KEYRING: { type: "text", value: JSON.stringify({
        current: 1, keys: { 1: Buffer.alloc(32, 7).toString("base64url") },
      }) },
      TEST_REPORT_URL: { type: "text", value: `http://127.0.0.1:${server.address().port}` },
      REPORT_FLOW: { type: "workflow", name: "telemetry-reports", worker: "private-mcp-telemetry",
        exportName: "TestReportFlow" },
    },
  } }] });
  t.after(() => runtime.dispose());
  const accounts = await runtime.getD1Database("ACCOUNTS"), db = await runtime.getD1Database("ACTIVITY");
  for (const name of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql",
    "0006_mcp_connections.sql"]) await migrate(accounts, new URL(`../../site/migrations/${name}`, import.meta.url));
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql",
    "0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql"])
    await migrate(db, new URL(`../activity-migrations/${name}`, import.meta.url));
  await accounts.prepare("INSERT INTO users VALUES ('account-a','synthetic@example.invalid','','',0,0)").run();
  await accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES ('account-a','account-a')").run();
  const send = async (path, input = {}, principal) => {
    const response = await runtime.dispatchFetch(`https://activity.internal${path}`, {
      method: "POST", headers: { "content-type": "application/json",
        ...(principal ? { "x-skillar-principal": JSON.stringify(principal) } : {}) },
      body: JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await send("/setup", { recordActivity, connectionKind })).status, 200);
  const principal = { kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", scopes: ["activity:read"], issuer: "https://skillar.sh", sessionId: null };
  return { accounts, db, bucket: await runtime.getR2Bucket("ACTIVITY_RAW"), send,
    api: (path, input) => send(path, input, principal),
    rows: async sql => (await db.prepare(sql).all()).results,
    finished: id => once(events, id, { signal: AbortSignal.timeout(30000) }).then(([value]) => value),
  };
}
async function report(f, query) {
  const saved = await f.accounts.prepare("SELECT consent_json FROM device_consents").first();
  const grant = JSON.parse(saved.consent_json);
  const request = { schemaVersion: 1, requestId: randomUUID(), deviceId: "device-a",
    sourceDomain: "mcp", generation: 1, consentVersion: 1, projectId: "device:device-a",
    rootId: null, range: { fromMs: grant.grantedAtMs, toMs: 8_640_000_000_000_000 },
    backfill: null, tz: "UTC", query };
  const finished = f.finished(request.requestId);
  const accepted = await f.api("/v1/activity/query", request);
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  assert.equal((await finished).state, "complete");
  return (await result(f, request)).value.payload;
}

test("native dashboard reports see remote session, search, load, supporting read and correlated trace without daemon",
  { timeout: 30000 }, async t => {
    // Given a fresh connection with explicit managed recording consent.
    const f = await fixture(t);
    // When the real recorder emits successful remote observations.
    assert.deepEqual(await f.send("/search", { observation: search }), { status: 200, body: { saved: true } });
    assert.equal((await f.send("/read", { observation: read })).status, 200);
    assert.equal((await f.send("/read", { observation: { ...read,
      path: "references/example.md", uri: uri.replace("SKILL.md", "references/example.md") } })).status, 200);
    // Then production report flow decrypts/reconstructs facts and executes native queries.
    const sessions = await report(f, { kind: "sessions", filter: { automated: "include" } });
    assert.equal(sessions.length, 1); assert.equal(sessions[0].id, connectionId);
    assert.equal(sessions[0].requests.search.total, 1);
    assert.equal(sessions[0].requests.load.total, 1);
    const trace = await report(f, { kind: "trace", sessionId: connectionId });
    assert.deepEqual(trace.map(event => event.kind), ["search", "load", "read_file"]);
    assert.equal(trace[0].detail.query, search.query);
    assert.equal(trace[0].detail.traceId, search.traceId);
    assert.deepEqual(trace[0].detail.chosen, [uri]);
    assert.equal(trace[1].detail.manifestDigest, read.manifestDigest);
    assert.equal(trace[2].detail.bytes, 123);
    for (const unit of ["search_requests", "load_requests"]) {
      const flow = await report(f, { kind: "flow", unit, filter: { automated: "include" }, top: 10 });
      assert.equal(flow.requestCount, 1);
    }
    assert.deepEqual(await f.rows("SELECT sequence,journal_through FROM device_streams"),
      [{ sequence: 3, journal_through: 3 }]);
    const browser = { ...context.principal, kind: "browser", deviceId: null,
      sessionId: "s".repeat(32), scopes: ["activity:read", "device:manage"] };
    delete browser.connectionId; delete browser.tokenHash;
    await f.accounts.prepare("INSERT INTO sessions VALUES (?,'account-a',?)")
      .bind(browser.sessionId, Math.floor(Date.now() / 1000) + 3600).run();
    const profiles = await f.send("/v1/activity/dashboard/profiles", {}, browser);
    assert.equal(profiles.status, 200, JSON.stringify(profiles));
    assert.equal(profiles.body.profiles[0].availability, "ready");
    assert.equal(profiles.body.profiles[0].sourceDomain, "mcp");
    assert.equal(profiles.body.profiles[0].runtimeSequence, 3);
    for (const object of (await f.bucket.list()).objects) {
      assert.equal((await (await f.bucket.get(object.key)).text()).includes(search.query), false);
    }
  });

test("unchecked recording constructs no source or content", async t => {
  // Given primary local-only consent and an unchecked actual MCP context.
  const f = await fixture(t, false);
  // When search and resource observations are attempted.
  for (const [path, observation] of [["/search", search], ["/read", read]]) {
    assert.deepEqual(await f.send(path, { context: { ...context, recordActivity: false }, observation }),
      { status: 200, body: { saved: false } });
  }
  // Then even lazy shard initialization and encrypted object writes are absent.
  assert.deepEqual(await f.rows("SELECT * FROM tenant_fences"), []);
  assert.deepEqual((await f.bucket.list()).objects, []);
  const consent = await f.accounts.prepare("SELECT consent_json FROM device_consents").first();
  assert.deepEqual(JSON.parse(consent.consent_json), { mode: "local-only" });
});

for (const [name, change] of Object.entries({ account: { accountId: "foreign-account" },
  device: { deviceId: "foreign-device" }, connection: { connectionId: randomUUID() },
  generation: { generation: 2 }, credential: { tokenHash: "b".repeat(64) } })) {
  test(`foreign ${name} cannot write telemetry`, async t => {
    const f = await fixture(t);
    const response = await f.send("/search", { context: { ...context,
      principal: { ...context.principal, ...change } }, observation: search });
    assert.equal(response.status, 403);
    assert.deepEqual(await f.rows("SELECT * FROM ingest_receipts"), []);
    assert.deepEqual((await f.bucket.list()).objects, []);
  });
}

for (const target of ["connection", "device", "account", "generation", "consent", "scope", "record"]) {
  for (const boundary of ["put", "get"]) {
    test(`${target} revocation during R2 ${boundary} prevents event publication`, async t => {
      // Given an established native source.
      const f = await fixture(t);
      assert.equal((await f.send("/search", { observation: search })).status, 200);
      // When authority is revoked at the exact next awaited real R2 boundary.
      assert.equal((await f.send("/read", { observation: read, fence: target, boundary,
        at: boundary === "get" ? 2 : 1 })).status, 403);
      // Then no new receipt, source head or runtime revision is published.
      assert.deepEqual(await f.rows("SELECT sequence,journal_through FROM device_streams"),
        [{ sequence: 1, journal_through: 1 }]);
      assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 1);
      assert.equal((await f.rows("SELECT count(*) n FROM runtime_contexts"))[0].n, 1);
    });
  }
}

for (const [name, sql] of Object.entries({
  expired: "UPDATE mcp_connections SET expires_at=1",
  revoked: "UPDATE mcp_connections SET revoked_at=1",
  unchecked: "UPDATE mcp_connections SET record_activity=0",
  readScope: `UPDATE mcp_connections SET scopes_json='["activity:record"]'`,
  recordScope: `UPDATE mcp_connections SET scopes_json='["skills:read"]'`,
  localOnly: `UPDATE device_consents SET consent_json='{"mode":"local-only"}'`,
  partialContent: `UPDATE device_consents SET consent_json=json_set(consent_json,'$.contentKinds',json('["query"]'))`,
})) {
  test(`${name} primary authority rejects recording before storing content`, async t => {
    const f = await fixture(t);
    await f.accounts.prepare(sql).run();
    assert.equal((await f.send("/search", { observation: search })).status, 403);
    assert.deepEqual(await f.rows("SELECT * FROM tenant_fences"), []);
    assert.deepEqual((await f.bucket.list()).objects, []);
  });
}

test("source statements roll back with failed primary connection creation", async t => {
  // Given an existing primary connection.
  const f = await fixture(t);
  // When a duplicate connection insert follows preparation for a new device in the same D1 batch.
  const response = await f.send("/setup", { context: { ...context,
    principal: { ...context.principal, deviceId: "rolled-back-device" } } });
  // Then neither prepared device nor consent survives the failed connection transaction.
  assert.equal(response.status, 403);
  assert.equal((await f.accounts.prepare("SELECT count(*) n FROM devices").first()).n, 1);
  assert.equal((await f.accounts.prepare("SELECT count(*) n FROM device_consents").first()).n, 1);
});

for (const [name, sql] of Object.entries({
  revoked: "UPDATE mcp_credentials SET revoked_at=1",
  expired: "UPDATE mcp_credentials SET expires_at=1",
  refresh: "UPDATE mcp_credentials SET kind='refresh'",
  missing: "DELETE FROM mcp_credentials",
  readScope: `UPDATE mcp_credentials SET scopes_json='["activity:record"]'`,
  recordScope: `UPDATE mcp_credentials SET scopes_json='["skills:read"]'`,
})) {
  test(`OAuth ${name} credential cannot record despite a live connection`, async t => {
    const f = await fixture(t, true, "oauth");
    await f.accounts.prepare(sql).run();
    assert.equal((await f.send("/search", { observation: search })).status, 403);
    assert.deepEqual(await f.rows("SELECT * FROM ingest_receipts"), []);
    assert.deepEqual((await f.bucket.list()).objects, []);
  });
}
for (const boundary of ["put", "get"]) {
  test(`OAuth access credential revocation during final R2 ${boundary} fences telemetry`, async t => {
    const f = await fixture(t, true, "oauth");
    assert.equal((await f.send("/search", { observation: search })).status, 200);
    assert.equal((await f.send("/read", { observation: read, fence: "credential", boundary,
      at: boundary === "get" ? 2 : 1 })).status, 403);
    assert.equal((await f.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 1);
    assert.deepEqual(await f.rows("SELECT sequence,journal_through FROM device_streams"),
      [{ sequence: 1, journal_through: 1 }]);
  });
}
