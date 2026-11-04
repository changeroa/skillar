import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const principal = (changes = {}) => ({
  kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
  shardId: "activity-00", issuer: "https://skillar.sh", sessionId: null,
  scopes: ["activity:read", "activity:ingest"], ...changes,
});
const kinds = ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"];
const input = (changes = {}) => ({
  profile: { deviceId: "device-a", sourceDomain: "source" }, commandId: randomUUID(), baseRevision: 7,
  operation: { kind: "workflow.put", spec: { name: "private-workflow", steps: [
    { id: "first", skills: ["PRIVATE_SKILL"], doneWhen: "PRIVATE_PATH /home/me" },
  ] } }, ...changes,
});
const source = `
import { commandsRequest } from "./src/activity/commands.ts";
import { sweepCommands } from "./src/activity/commands-cleanup.ts";
import { readContentKey } from "./src/activity/content-keys.ts";
import { decryptContent } from "./src/activity/crypto.ts";
import { canonicalCommandPayload, sourceOperationSchema } from "../shared/activity-commands.ts";
let fault=null, latePut=null, enabled="true", boot;
export default { async fetch(request, bindings) {
  const path=new URL(request.url).pathname;
  const env={...bindings,ACTIVITY_INGEST_ENABLED:enabled,
    CONTENT_KEYRING:JSON.stringify({current:1,keys:{1:"${Buffer.alloc(32, 7).toString("base64url")}"}})};
  if(path==="/test/boot"){boot??=crypto.randomUUID();return Response.json({boot});}
  if(path==="/test/arm"){fault=await request.json();return Response.json({armed:true});}
  if(path==="/test/off"){enabled="false";return Response.json({disabled:true});}
  if(path==="/test/release"){await bindings.ACTIVITY_RAW.put(...latePut);return Response.json({released:true});}
  if(path==="/test/sweep")return Response.json(await sweepCommands(env,await request.json()));
  if(path==="/test/canonical")return Response.json({canonical:canonicalCommandPayload(await request.json())});
  if(path==="/test/operation")return Response.json({valid:sourceOperationSchema.safeParse(await request.json()).success});
  if(path==="/test/decrypt"){
    const {row,objectKey}=await request.json();
    const key=await readContentKey(env.ACTIVITY,{accountId:row.account_id,generation:row.generation},env.CONTENT_KEYRING,row.key_version);
    const object=await bindings.ACTIVITY_RAW.get(objectKey);
    const plain=await decryptContent(key,{accountId:row.account_id,generation:row.generation,
      objectKey,revision:0,schemaVersion:1},await object.json());
    return Response.json({plaintext:new TextDecoder().decode(plain)});
  }
  if(fault) {
    const bucket=bindings.ACTIVITY_RAW;
    env.ACTIVITY_RAW=new Proxy(bucket,{get(target,key){
      if(key==="put")return async(...args)=>{
        const action=fault;fault=null;
        if(action.mode==="late"){latePut=args;throw new Error("fixture_interrupted_put");}
        if(action.mode==="stored"){
          await target.put(...args);throw new Error("fixture_interrupted_publication");
        }
        if(action.mode==="fence"){
          if(action.target==="generation")await env.ACTIVITY.prepare("UPDATE tenant_fences SET state='closed'").run();
          if(action.target==="device")await env.ACCOUNTS.prepare("UPDATE devices SET revoked_at=1").run();
          if(action.target==="consent")await env.ACCOUNTS.prepare("DELETE FROM device_consents").run();
          if(action.target==="expiry")await env.ACTIVITY.prepare("UPDATE connector_commands SET expires_at=0").run();
        }
        return target.put(...args);
      };
      const value=Reflect.get(target,key,target);
      return typeof value==="function"?value.bind(target):value;
    }});
  }
  return await commandsRequest(new Request("https://activity.internal"+path,request),env)
    ?? Response.json({error:"fixture_unknown_path"},{status:404});
} };
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    sourcefile: "activity-commands-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
async function migrate(db, file) {
  const sql = await readFile(file, "utf8"), statements = [];
  let current = "", trigger = false;
  for (const line of sql.replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim()));
      current = ""; trigger = false;
    }
  }
  assert.equal(current, "");
  await db.batch(statements);
}
async function fixture(t) {
  const script = (await bundle).outputFiles[0].text;
  const options = (suffix = "") => ({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-commands-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: script + suffix } } },
    env: {
      ACTIVITY: { type: "d1", name: "commands-activity" },
      ACCOUNTS: { type: "d1", name: "commands-accounts" },
      ACTIVITY_RAW: { type: "r2", name: "commands-raw" },
    }, exports: {},
  } }] });
  const runtime = new Miniflare(options());
  t.after(() => runtime.dispose());
  let db = await runtime.getD1Database("ACTIVITY"), accounts = await runtime.getD1Database("ACCOUNTS");
  let bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const file of ["0001_activity_ledger.sql", "0002_content.sql", "0010_connector_commands.sql"]) {
    await migrate(db, new URL(`../activity-migrations/${file}`, import.meta.url));
  }
  for (const file of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql"]) {
    await migrate(accounts, new URL(`../../site/migrations/${file}`, import.meta.url));
  }
  const seed = async (who = principal()) => {
    await accounts.prepare("INSERT INTO users VALUES (?,?,'','',0,0)")
      .bind(who.accountId, who.accountId + "@example.com").run();
    await accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)")
      .bind(who.accountId, who.accountId).run();
    await accounts.prepare("INSERT INTO devices VALUES (?,?,0,NULL)").bind(who.accountId, who.deviceId).run();
    await db.prepare("INSERT INTO tenant_fences VALUES (?,?,'active')").bind(who.accountId, who.generation).run();
    await accounts.prepare("INSERT INTO device_consents VALUES (?,?,?,1,?,0)")
      .bind(who.accountId, who.deviceId, who.generation, JSON.stringify({
        mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
        scope: { deviceId: who.deviceId, projectIds: ["device:" + who.deviceId], rootIds: [] }, contentKinds: kinds,
      })).run();
    await db.prepare("INSERT INTO device_streams VALUES (?,?,?,?,1,7)")
      .bind(who.accountId, who.generation, who.deviceId, "source").run();
  };
  await seed();
  const send = async (path, body = {}, who = principal(), headers = {}) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid${path}`, {
      method: "POST", headers: {
        "content-type": "application/json", "x-skillar-principal": JSON.stringify(who), ...headers,
      }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const api = (path, body, who, headers) => send("/v1/activity/commands/" + path, body, who, headers);
  const rows = async (sql = "SELECT * FROM connector_commands", ...args) => (await db.prepare(sql).bind(...args).all()).results;
  return { get db() { return db; }, get accounts() { return accounts; }, get bucket() { return bucket; },
    send, api, rows, seed,
    restart: async () => {
      await runtime.setOptions(options("\n// force new worker isolate " + randomUUID()));
      db = await runtime.getD1Database("ACTIVITY");
      accounts = await runtime.getD1Database("ACCOUNTS");
      bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
    } };
}
const statusInput = request => ({ profile: request.profile, commandId: request.commandId });
const ack = (command, changes = {}) => ({
  sourceDomain: command.sourceDomain, commandId: command.commandId, payloadHash: command.payloadHash,
  state: "applied", sourceRevision: 8, result: { privatePath: "/PRIVATE_RESULT" }, error: null, ...changes,
});
async function queued(f, request = input()) {
  const enqueued = await f.api("enqueue", request, principal({ scopes: ["activity:read"] }));
  assert.equal(enqueued.status, 202, JSON.stringify(enqueued));
  const polled = await f.api("poll", { sourceDomain: request.profile.sourceDomain });
  assert.equal(polled.status, 200, JSON.stringify(polled));
  assert.notEqual(polled.body.command, null);
  return { request, command: polled.body.command };
}

test("concurrent different command IDs reserve one source atomically", async t => {
  // Given two writers at the same authoritative source cut.
  const f = await fixture(t), a = input(), b = input();
  // When both enqueue without a client-side serialization gate.
  const replies = await Promise.all([f.api("enqueue", a), f.api("enqueue", b)]);
  // Then exactly one reservation wins and the other gets the stable conflict.
  assert.deepEqual(replies.map(r => r.status).sort(), [202, 409]);
  assert.equal(replies.find(r => r.status === 409).body.error, "command_conflict");
  assert.equal((await f.rows()).length, 1);
  assert.equal((await f.bucket.list()).objects.length, 1);
});

test("canonical duplicate publication survives worker restart and remains pending offline", async t => {
  // Given a successfully published command and a canonical-equivalent duplicate.
  const f = await fixture(t), request = input();
  const variant = structuredClone(request);
  Object.assign(variant.operation.spec.steps[0], { together: false, expectTools: [] });
  const first = await f.api("enqueue", request);
  const before = await f.api("poll", { sourceDomain: "source" });
  const oldBoot = await f.send("/test/boot");
  // When the isolate restarts and duplicate enqueue/poll requests retry.
  await f.restart();
  const replay = await f.api("enqueue", variant);
  const after = await f.api("poll", { sourceDomain: "source" });
  // Then identity and bytes survive without inferring successful application.
  assert.notEqual((await f.send("/test/boot")).body.boot, oldBoot.body.boot);
  assert.deepEqual(replay, first);
  assert.deepEqual(after, before);
  assert.deepEqual((await f.api("status", statusInput(request))).body, {
    commandId: request.commandId, state: "pending", baseRevision: 7, sourceRevision: null, result: null, error: null,
  });
  assert.equal((await f.rows()).length, 1);
});

test("concurrent exact command retries share the immutable encrypted object", async t => {
  // Given one canonical request submitted concurrently.
  const f = await fixture(t), request = input();
  // When both requests reserve and publish.
  const replies = await Promise.all([f.api("enqueue", request), f.api("enqueue", request)]);
  // Then both receive the same pending status with one encrypted object.
  assert.equal(replies[0].status, 202);
  assert.deepEqual(replies[0], replies[1]);
  assert.equal((await f.rows()).length, 1);
  assert.equal((await f.bucket.list()).objects.length, 1);
});

test("same command ID rejects a changed canonical operation", async t => {
  // Given an existing command.
  const f = await fixture(t), { request } = await queued(f);
  // When its ID is reused for another operation.
  const response = await f.api("enqueue", { ...request, operation: { kind: "flow.end", flowId: "flow-a" } });
  // Then immutable identity rejects the changed bytes.
  assert.deepEqual(response, { status: 409, body: { error: "command_conflict" } });
});

test("encrypted request and ACK retain raw values only inside managed ciphertext", async t => {
  // Given raw workflow fields and a source result containing private path bytes.
  const f = await fixture(t), { request, command } = await queued(f);
  const result = ack(command);
  // When the source acknowledges actual application.
  const response = await f.api("ack", result);
  // Then D1 contains metadata only, R2 ciphertext decrypts exactly, and the hash is recomputable.
  assert.equal(response.status, 200, JSON.stringify(response));
  const [row] = await f.rows(), metadata = JSON.stringify(row);
  for (const marker of ["PRIVATE_SKILL", "PRIVATE_PATH", "private-workflow", "PRIVATE_RESULT"]) {
    assert.equal(metadata.includes(marker), false);
  }
  for (const key of [row.object_key, row.result_object_key]) {
    const ciphertext = await (await f.bucket.get(key)).text();
    assert.equal(ciphertext.includes("PRIVATE"), false);
    assert.equal(JSON.parse(ciphertext).algorithm, "A256GCM");
  }
  const canonical = (await f.send("/test/canonical", request)).body.canonical;
  assert.equal(command.payloadHash, createHash("sha256").update(canonical).digest("hex"));
  const original = (await f.send("/test/decrypt", { row, objectKey: row.object_key })).body.plaintext;
  assert.equal(original, canonical);
  const stored = JSON.parse((await f.send("/test/decrypt", { row, objectKey: row.result_object_key })).body.plaintext);
  const { sourceDomain, ...expected } = result;
  assert.deepEqual(stored, expected);
});

test("lost ACK response retries exactly after isolate restart", async t => {
  // Given a source ACK whose successful response is lost by the connector.
  const f = await fixture(t), { request, command } = await queued(f), result = ack(command);
  const first = await f.api("ack", result);
  // When the connector resends the durable receipt after a worker restart.
  await f.restart();
  const replay = await f.api("ack", result);
  // Then the result is identical and polling no longer delivers the command.
  assert.deepEqual(replay, first);
  assert.equal(replay.body.state, "applied");
  assert.deepEqual((await f.api("status", statusInput(request))).body, first.body);
  assert.equal((await f.api("poll", { sourceDomain: "source" })).body.command, null);
  assert.equal((await f.bucket.list()).objects.length, 2);
});

test("concurrent different ACK outcomes cannot both commit", async t => {
  // Given one delivered command with two conflicting source outcomes.
  const f = await fixture(t), { command } = await queued(f);
  // When both source ACKs arrive concurrently.
  const replies = await Promise.all([
    f.api("ack", ack(command)), f.api("ack", ack(command, { state: "rejected", error: "PRIVATE_ERROR" })),
  ]);
  // Then exactly one outcome wins; even retries cannot replace it.
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  assert.equal(replies.find(r => r.status === 409).body.error, "command_conflict");
  assert.equal((await f.bucket.list()).objects.length, 2);
  assert.equal(JSON.stringify(await f.rows()).includes("PRIVATE_ERROR"), false);
});

test("successful source ACK watermark blocks a stale browser with lagging projection", async t => {
  // Given Local applied at cut 12 while projected device_streams still says 7.
  const f = await fixture(t), { command } = await queued(f);
  assert.equal((await f.api("ack", ack(command, { sourceRevision: 12 }))).status, 200);
  // When a browser tries to enqueue from the stale projection.
  const response = await f.api("enqueue", input());
  // Then the atomic source watermark rejects it while cut 12 is allowed.
  assert.equal(response.status, 409);
  assert.equal((await f.api("enqueue", input({ baseRevision: 12 }))).status, 202);
});

for (const state of ["applied", "conflict", "rejected"]) {
  test(`${state} source ACK releases reservation, including a successful no-op at the same cut`, async t => {
    // Given a delivered command and a terminal source receipt at unchanged cut 7.
    const f = await fixture(t), { command } = await queued(f);
    assert.equal((await f.api("ack", ack(command, { state, sourceRevision: 7, result: null }))).status, 200);
    // When another command arrives at the same authoritative cut.
    const response = await f.api("enqueue", input());
    // Then the previous terminal outcome does not permanently occupy the source.
    assert.equal(response.status, 202, JSON.stringify(response));
    assert.equal((await f.rows()).length, 2);
  });
}

for (const baseRevision of [0, 6, 8]) test(`source journal cut rejects nonmatching base ${baseRevision}`, async t => {
  // Given an authoritative projected source head at 7.
  const f = await fixture(t);
  // When a request claims a different CDC cut.
  const response = await f.api("enqueue", input({ baseRevision }));
  // Then no reservation or raw object is created.
  assert.equal(response.status, 409);
  assert.equal((await f.rows()).length, 0);
  assert.equal((await f.bucket.list()).objects.length, 0);
});

test("ACK with a different payload hash or decreasing applied source cut is denied", async t => {
  // Given a delivered command at base 7.
  const f = await fixture(t), { command } = await queued(f);
  // When source ACK identity or applied revision contradicts the delivery.
  const replies = await Promise.all([
    f.api("ack", ack(command, { payloadHash: "0".repeat(64) })),
    f.api("ack", ack(command, { sourceRevision: 6 })),
  ]);
  // Then neither ACK reserves or publishes an outcome.
  assert.deepEqual(replies.map(r => r.status), [409, 409]);
  assert.equal((await f.rows())[0].state, "pending");
});

for (const [name, who, sql] of [
  ["foreign tenant", { accountId: "account-b" }],
  ["foreign device", { deviceId: "device-b" }],
  ["old generation", { generation: 2 }],
  ["read scope missing", { scopes: ["activity:ingest"] }],
  ["wrong issuer", { issuer: "https://attacker.example" }],
  ["revoked device", {}, "UPDATE devices SET revoked_at=1"],
  ["revoked account", {}, "UPDATE accounts SET state='revoked'"],
  ["changed generation", {}, "UPDATE accounts SET auth_generation=2"],
  ["missing consent", {}, "DELETE FROM device_consents"],
  ["local-only", {}, "UPDATE device_consents SET consent_json='{\"mode\":\"local-only\"}'"],
  ["metadata-only", {}, "UPDATE device_consents SET consent_json=json_remove(json_set(consent_json,'$.mode','metadata'),'$.contentKinds','$.serverProcessingAcknowledged')"],
  ["missing content kind", {}, "UPDATE device_consents SET consent_json=json_set(consent_json,'$.contentKinds',json('[\"query\",\"path\"]'))"],
  ["project-only consent", {}, "UPDATE device_consents SET consent_json=json_set(consent_json,'$.scope.projectIds',json('[\"project\"]'))"],
  ["root-limited consent", {}, "UPDATE device_consents SET consent_json=json_set(consent_json,'$.scope.rootIds',json('[\"root\"]'))"],
]) test(`all queue access denies ${name} against a real pending command`, async t => {
  // Given retained private bytes and an authority change.
  const f = await fixture(t), { request, command } = await queued(f);
  if (sql) await f.accounts.prepare(sql).run();
  // When enqueue, status, poll and ACK attempt access with that authority.
  const actor = principal(who);
  const replies = await Promise.all([
    f.api("enqueue", request, actor), f.api("status", statusInput(request), actor),
    f.api("poll", { sourceDomain: "source" }, actor), f.api("ack", ack(command), actor),
  ]);
  // Then no private result or operation escapes and no result is persisted.
  assert.deepEqual(replies.map(r => r.status), [403, 403, 403, 403], JSON.stringify(replies));
  assert.equal(JSON.stringify(replies).includes("PRIVATE"), false);
  assert.equal((await f.rows())[0].state, "pending");
  assert.equal((await f.bucket.list()).objects.length, 1);
});

test("valid foreign tenant cannot observe or acknowledge another tenant's command", async t => {
  // Given two fully authorized accounts and a pending command belonging to A.
  const f = await fixture(t), { request, command } = await queued(f);
  const foreign = principal({ accountId: "account-b" });
  await f.seed(foreign);
  // When B polls, asks status, or ACKs A's command ID.
  const replies = await Promise.all([
    f.api("poll", { sourceDomain: "source" }, foreign),
    f.api("status", statusInput(request), foreign), f.api("ack", ack(command), foreign),
  ]);
  // Then B sees an empty queue and cannot find the foreign ID.
  assert.deepEqual(replies.map(r => r.status), [200, 404, 404]);
  assert.equal(replies[0].body.command, null);
  assert.equal((await f.rows())[0].state, "pending");
});

test("foreign source domain cannot read or ACK another domain's command", async t => {
  // Given one pending source command.
  const f = await fixture(t), { request, command } = await queued(f);
  // When the same device uses a different source domain.
  const replies = await Promise.all([
    f.api("poll", { sourceDomain: "other" }),
    f.api("status", { ...statusInput(request), profile: { ...request.profile, sourceDomain: "other" } }),
    f.api("ack", ack(command, { sourceDomain: "other" })),
    f.api("enqueue", input({ profile: { ...request.profile, sourceDomain: "other" } })),
  ]);
  // Then no cross-domain command is read, mutated, or queued without a source head.
  assert.deepEqual(replies.map(r => r.status), [200, 404, 404, 409]);
  assert.equal(replies[0].body.command, null);
});

test("another authorized device cannot observe or ACK the command", async t => {
  // Given two consented devices on the same account.
  const f = await fixture(t), { request, command } = await queued(f);
  await f.accounts.prepare("INSERT INTO devices VALUES ('account-a','device-b',0,NULL)").run();
  await f.accounts.prepare(`INSERT INTO device_consents SELECT account_id,'device-b',generation,version,
    json_set(consent_json,'$.scope.deviceId','device-b','$.scope.projectIds',json('["device:device-b"]')),granted_at_ms
    FROM device_consents WHERE device_id='device-a'`).run();
  const who = principal({ deviceId: "device-b" });
  // When the second device requests the same UUID under its own authority.
  const replies = await Promise.all([
    f.api("poll", { sourceDomain: "source" }, who),
    f.api("status", { ...statusInput(request), profile: { ...request.profile, deviceId: "device-b" } }, who),
    f.api("ack", ack(command), who),
  ]);
  // Then there is no cross-device visibility or receipt mutation.
  assert.deepEqual(replies.map(r => r.status), [200, 404, 404]);
  assert.equal(replies[0].body.command, null);
  assert.equal((await f.rows())[0].state, "pending");
});

test("new consent version cannot read an old command but can replace its reservation", async t => {
  // Given a pending command whose original grant was replaced.
  const f = await fixture(t), { request } = await queued(f);
  await f.accounts.prepare(`INSERT INTO device_consents
    SELECT account_id,device_id,generation,2,json_set(consent_json,'$.version',2),granted_at_ms
    FROM device_consents WHERE version=1`).run();
  // When the old status is requested and a freshly authorized command is enqueued.
  const old = await f.api("status", statusInput(request));
  const fresh = await f.api("enqueue", input());
  // Then only the new consent-bound command is deliverable and the old descriptor remains.
  assert.equal(old.status, 403);
  assert.equal(fresh.status, 202, JSON.stringify(fresh));
  assert.equal((await f.api("poll", { sourceDomain: "source" })).body.command.consentVersion, 2);
  assert.equal((await f.rows("SELECT * FROM connector_commands WHERE command_id=?", request.commandId))[0].state, "purging");
});

test("browser read-only principal may enqueue/status but never connector poll/ACK", async t => {
  // Given a browser-forwarded device-shaped principal, not a device bearer.
  const f = await fixture(t), browser = principal({ scopes: ["activity:read"] });
  const { request, command } = await queued(f);
  // When it accesses status and connector-only endpoints.
  const replies = await Promise.all([
    f.api("status", statusInput(request), browser),
    f.api("poll", { sourceDomain: "source" }, browser), f.api("ack", ack(command), browser),
  ]);
  // Then only status succeeds.
  assert.deepEqual(replies.map(r => r.status), [200, 403, 403]);
});

test("disabled ingest hides writes and polling while status still rechecks consent", async t => {
  // Given a pending command and a subsequently disabled deployment.
  const f = await fixture(t), { request, command } = await queued(f);
  await f.send("/test/off");
  // When each route is requested.
  const replies = await Promise.all([
    f.api("enqueue", request), f.api("poll", { sourceDomain: "source" }),
    f.api("ack", ack(command)), f.api("status", statusInput(request)),
  ]);
  // Then status alone remains readable, and revocation still denies that read.
  assert.deepEqual(replies.map(r => r.status), [404, 404, 404, 200]);
  await f.accounts.prepare("DELETE FROM device_consents").run();
  assert.equal((await f.api("status", statusInput(request))).status, 403);
});

for (const phase of ["enqueue", "ack"]) {
  for (const mode of ["late", "stored"]) {
    test(`${phase} ${mode} publication interruption recovers from durable descriptors`, async t => {
      // Given an exact request/receipt and a failure at the R2 publication boundary.
      const f = await fixture(t), request = input();
      const delivered = phase === "ack" ? await queued(f, request) : null;
      const value = delivered ? ack(delivered.command) : request;
      await f.send("/test/arm", { mode });
      assert.equal((await f.api(phase, value)).status, 503);
      // When the worker restarts and the exact request is retried.
      await f.restart();
      const retry = await f.api(phase, value);
      // Then the reserved object identity recovers without duplicate application claims.
      assert.equal(retry.status, phase === "enqueue" ? 202 : 200, JSON.stringify(retry));
      assert.equal(retry.body.state, phase === "enqueue" ? "pending" : "applied");
      assert.equal((await f.rows()).length, 1);
    });
  }
}

test("poll completes interrupted request publication without an enqueue retry", async t => {
  // Given ciphertext stored before an interrupted D1 publication.
  const f = await fixture(t), request = input();
  await f.send("/test/arm", { mode: "stored" });
  assert.equal((await f.api("enqueue", request)).status, 503);
  // When a connector polls after restart.
  await f.restart();
  const response = await f.api("poll", { sourceDomain: "source" });
  // Then the original command is delivered and publication is repaired.
  assert.equal(response.status, 200);
  assert.equal(response.body.command.commandId, request.commandId);
  assert.equal((await f.rows())[0].state, "pending");
});

test("unfinished request without R2 bytes remains undisclosed pending work", async t => {
  // Given an upload intent whose PUT has not arrived.
  const f = await fixture(t), request = input();
  await f.send("/test/arm", { mode: "late" });
  assert.equal((await f.api("enqueue", request)).status, 503);
  // When the offline connector polls.
  const response = await f.api("poll", { sourceDomain: "source" });
  // Then missing bytes are not a phantom delivered command or a successful result.
  assert.deepEqual(response, { status: 200, body: { command: null } });
  assert.equal((await f.api("status", statusInput(request))).body.state, "pending");
});

for (const phase of ["enqueue", "ack"]) {
  for (const target of ["generation", "device", "consent", "expiry"]) {
    test(`${phase} publication is fenced when ${target} changes during PUT`, async t => {
      // Given a valid request whose authority changes at the awaited R2 boundary.
      const f = await fixture(t), request = input();
      const delivered = phase === "ack" ? await queued(f, request) : null;
      await f.send("/test/arm", { mode: "fence", target });
      // When publication resumes after the fence.
      const response = await f.api(phase, delivered ? ack(delivered.command) : request);
      // Then no success escapes, cleanup finds all descriptors, and replay cannot resurrect them.
      assert.equal(response.status, target === "expiry" ? 410 : 403, JSON.stringify(response));
      const sweep = await f.send("/test/sweep");
      assert.equal(sweep.body.deleted, 1);
      assert.equal((await f.bucket.list()).objects.length, 0);
      assert.equal((await f.rows())[0].state, "purged");
      assert.notEqual((await f.api("enqueue", request)).status, 202);
    });
  }
}

test("late PUT after expiry is swept again without resurrecting a command", async t => {
  // Given an unfinished encrypted request, now expired and swept once.
  const f = await fixture(t), request = input();
  await f.send("/test/arm", { mode: "late" });
  assert.equal((await f.api("enqueue", request)).status, 503);
  const [row] = await f.rows();
  await f.db.prepare("UPDATE connector_commands SET expires_at=0").run();
  assert.equal((await f.send("/test/sweep")).body.deleted, 1);
  // When the original timed-out PUT arrives after deletion and cleanup runs again.
  await f.send("/test/release");
  assert.notEqual(await f.bucket.get(row.object_key), null);
  const sweep = await f.send("/test/sweep");
  // Then the late object disappears while its purge descriptor prevents resurrection.
  assert.equal(sweep.body.deleted, 1);
  assert.equal(await f.bucket.get(row.object_key), null);
  assert.equal((await f.rows())[0].state, "purged");
  assert.equal((await f.api("enqueue", request)).status, 410);
  assert.equal((await f.api("enqueue", input())).status, 202);
});

test("late ACK result after purge remains discoverable and never reports success", async t => {
  // Given an interrupted result publication with its descriptor persisted.
  const f = await fixture(t), { request, command } = await queued(f), result = ack(command);
  await f.send("/test/arm", { mode: "late" });
  assert.equal((await f.api("ack", result)).status, 503);
  const [row] = await f.rows();
  assert.equal(row.state, "acking");
  assert.notEqual(row.result_object_key, null);
  await f.db.prepare("UPDATE connector_commands SET expires_at=0").run();
  await f.send("/test/sweep");
  // When the timed-out result PUT arrives after purge and cleanup revisits it.
  await f.send("/test/release");
  assert.notEqual(await f.bucket.get(row.result_object_key), null);
  const swept = await f.send("/test/sweep");
  // Then both raw objects are absent and neither ACK nor status can resurrect success.
  assert.equal(swept.body.deleted, 1);
  assert.equal((await f.bucket.list()).objects.length, 0);
  assert.equal((await f.api("ack", result)).status, 410);
  assert.equal((await f.api("status", statusInput(request))).status, 410);
});

test("an upload advancing the projected journal cannot complete a pending command", async t => {
  // Given a pending command with no actual source command receipt.
  const f = await fixture(t), { request, command } = await queued(f);
  // When ordinary CDC advances the projected source head.
  await f.db.prepare("UPDATE device_streams SET journal_through=50,sequence=2").run();
  // Then status remains pending and the identical original command awaits actual source CAS.
  assert.equal((await f.api("status", statusInput(request))).body.state, "pending");
  assert.deepEqual((await f.api("poll", { sourceDomain: "source" })).body.command, command);
});

test("exact rejected outcome replays while changing its private error conflicts", async t => {
  // Given a terminal source rejection with opaque error content.
  const f = await fixture(t), { command } = await queued(f);
  const receipt = ack(command, { state: "rejected", result: null, error: "PRIVATE_ERROR /path" });
  const first = await f.api("ack", receipt);
  // When the exact rejection and a changed error are retried.
  const replies = await Promise.all([
    f.api("ack", receipt), f.api("ack", { ...receipt, error: "different" }),
  ]);
  // Then only the exact receipt is idempotent, and D1 never stores raw error text.
  assert.deepEqual(replies[0], first);
  assert.equal(replies[1].status, 409);
  assert.equal(first.body.error, receipt.error);
  assert.equal(JSON.stringify(await f.rows()).includes("PRIVATE_ERROR"), false);
});

test("purging successful results retains their authoritative source ACK watermark", async t => {
  // Given an acknowledged cut ahead of projection whose encrypted content expires.
  const f = await fixture(t), { command } = await queued(f);
  assert.equal((await f.api("ack", ack(command, { sourceRevision: 12 }))).status, 200);
  await f.db.prepare("UPDATE connector_commands SET expires_at=0").run();
  await f.send("/test/sweep");
  // When a browser submits the stale projected cut after cleanup.
  const response = await f.api("enqueue", input());
  // Then content deletion cannot roll back the source watermark.
  assert.equal(response.status, 409);
  assert.equal((await f.api("enqueue", input({ baseRevision: 12 }))).status, 202);
});

test("bounded cleanup rotates retained rows so expired descriptors cannot starve", async t => {
  // Given three sources, with retained rows preceding an expired row.
  const f = await fixture(t);
  for (const sourceDomain of ["one", "two", "three"]) {
    await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',1,'device-a',?,1,7)").bind(sourceDomain).run();
    await f.api("enqueue", input({ profile: { deviceId: "device-a", sourceDomain } }));
  }
  await f.db.prepare("UPDATE connector_commands SET expires_at=0 WHERE source_domain='three'").run();
  // When bounded cleanup processes exactly one descriptor per invocation.
  const sweeps = [];
  for (let i = 0; i < 3; i++) sweeps.push(await f.send("/test/sweep", { limit: 1 }));
  // Then each visit is bounded and the expired row is necessarily reached.
  assert.deepEqual(sweeps.map(r => r.body.inspected), [1, 1, 1]);
  assert.equal(sweeps.reduce((n, r) => n + r.body.deleted, 0), 1);
  assert.equal((await f.rows("SELECT * FROM connector_commands WHERE source_domain='three'"))[0].state, "purged");
});

test("expiry is capped at thirty days and never exceeds a shorter retention grant", async t => {
  // Given content retention longer than the explicit command maximum.
  const f = await fixture(t);
  await f.accounts.prepare(`UPDATE device_consents SET consent_json=json_set(consent_json,
    '$.retention',json('{"contentDays":365,"projectionDays":365,"backupDays":30}'))`).run();
  // When a command is queued.
  await queued(f);
  // Then its lifetime is exactly bounded at thirty days.
  const [row] = await f.rows();
  assert.equal(row.expires_at - row.created_at, 30 * 86_400_000);
});

test("shorter consent retention bounds command expiry", async t => {
  // Given content and projection retention below the command maximum.
  const f = await fixture(t);
  await f.accounts.prepare(`UPDATE device_consents SET consent_json=json_set(consent_json,
    '$.retention',json('{"contentDays":5,"projectionDays":2,"backupDays":1}'))`).run();
  // When a command is enqueued under that grant.
  await queued(f);
  // Then the shortest relevant retention controls its lifetime.
  const [row] = await f.rows();
  assert.equal(row.expires_at - row.created_at, 2 * 86_400_000);
});

test("shared operation parser preserves Local workflow defaults, uniqueness, and flow bounds", async t => {
  // Given values at Local's wire limits and one beyond each bound.
  const f = await fixture(t), operation = {
    kind: "flow.create", workspaceId: "w".repeat(128), tabId: "t".repeat(128),
    spec: { name: "flow", version: 1_000_000 }, label: "l".repeat(200),
  };
  const variants = [
    operation, { ...operation, workspaceId: "w".repeat(129) }, { ...operation, tabId: "t".repeat(129) },
    { ...operation, spec: { name: "flow", version: 1_000_001 } }, { ...operation, label: "l".repeat(201) },
    { kind: "flow.map-step", flowId: "flow", paneId: "p".repeat(128), stepId: "step" },
    { kind: "flow.map-step", flowId: "flow", paneId: "p".repeat(129), stepId: "step" },
    { kind: "workflow.put", spec: { name: "flow", steps: [{ id: "a", skills: [] }, { id: "a", skills: [] }] } },
  ];
  // When the shared boundary parses the operations.
  const parsed = await Promise.all(variants.map(value => f.send("/test/operation", value)));
  const canonical = JSON.parse((await f.send("/test/canonical", input())).body.canonical);
  // Then limits and duplicate IDs match Local, with defaults preserved.
  assert.deepEqual(parsed.map(r => r.body.valid), [true, false, false, false, false, true, false, false]);
  assert.equal(canonical.operation.spec.steps[0].together, false);
  assert.deepEqual(canonical.operation.spec.steps[0].expectTools, []);
});

test("strict HTTP boundary rejects browser principals, unknown fields and oversized bodies", async t => {
  // Given malformed authority and request bodies.
  const f = await fixture(t);
  // When they cross the command HTTP boundary.
  const replies = await Promise.all([
    f.api("enqueue", input(), principal({ kind: "browser", sessionId: "session", deviceId: null })),
    f.api("enqueue", { ...input(), accountId: "spoof" }),
    f.api("enqueue", input({ operation: { kind: "eval.add", query: "x".repeat(300_000) } })),
  ]);
  // Then parsing fails before any durable reservation.
  assert.deepEqual(replies.map(r => r.status), [400, 400, 413]);
  assert.equal((await f.rows()).length, 0);
});
