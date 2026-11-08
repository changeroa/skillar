import assert from "node:assert/strict";
import test from "node:test";
import { fixture, browser } from "./helpers/activity-dashboard.mjs";
import { publish, runtime } from "./helpers/activity-reports.mjs";
import { principal } from "./helpers/activity-content.mjs";

const profiles = "/v1/activity/dashboard/profiles";
test("completed initial migrations remain discoverable before runtime or CDC exists", async t => {
  // Given a completed initial snapshot with its seq0 anchor and no runtime or CDC receipts.
  const f = await fixture(t);
  await publish(f, [{ schemaVersion: 2, rows: [] }], { cut: 17 });
  assert.equal((await f.rows("SELECT count(*) AS n FROM ingest_receipts"))[0].n, 0);
  assert.equal((await f.rows("SELECT sequence FROM device_streams"))[0].sequence, 0);
  // When the private production discovery handler is called.
  const response = await f.api(profiles, {}, browser());
  // Then discovery includes the published snapshot before its first CDC receipt.
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.body.profiles, [{
    deviceId: "device-a", sourceDomain: "source", sourceSequence: 0, journalThrough: 17,
    runtimeSequence: null, capturedAtMs: null, receivedAtMs: null, availability: "awaiting-runtime",
  }]);
});

test("profiles unions published snapshot, CDC and runtime heads without another tenant", async t => {
  // Given completed initial migration bytes, runtime sources and a separate tenant stream.
  const f = await fixture(t);
  const uploader = { ...f, api: (path, input) => f.api(path, input, principal()) };
  const begin = await publish(f, [{ schemaVersion: 2, rows: [] }], { cut: 7 });
  await runtime(uploader, begin, { capturedAtMs: 1234 });
  await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',1,'device-a','runtime-only',2,11)").run();
  await runtime(uploader, { ...begin, sourceDomain: "runtime-only", cut: 11 }, { capturedAtMs: 5678 });
  await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',1,'device-a','cdc',3,9)").run();
  await f.db.prepare("INSERT INTO device_streams VALUES ('account-b',1,'device-a','secret',1,1)").run();
  await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',2,'device-a','old-generation',1,1)").run();
  // When the production handler receives an account-authenticated browser principal.
  const response = await f.api(profiles, {}, browser());
  // Then source heads and current metadata are complete and tenant fenced.
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.devices[0].consentVersion, 1);
  assert.equal(response.body.devices[0].consent.mode, "managed-content");
  assert.deepEqual(response.body.profiles.map(p => [p.sourceDomain, p.sourceSequence, p.journalThrough, p.runtimeSequence]),
    [["cdc", 3, 9, null], ["runtime-only", 2, 11, 1], ["source", 0, 7, 1]]);
  assert.equal(response.body.profiles[0].availability, "awaiting-runtime");
  assert.equal(response.body.profiles[2].availability, "ready");
  assert.equal(response.body.profiles[2].capturedAtMs, 1234);
});

for (const [name, who, sql] of [
  ["cross-tenant session", { accountId: "account-b" }],
  ["expired session", {}, "UPDATE sessions SET expires_at=0"],
  ["revoked account", {}, "UPDATE accounts SET state='revoked'"],
  ["old generation", { generation: 2 }],
  ["missing read scope", { scopes: ["device:manage"] }],
  ["foreign issuer", { issuer: "https://attacker.invalid" }],
]) test(`profile discovery denies ${name} at the production entrypoint`, async t => {
  // Given a principal whose live account/session authority does not match.
  const f = await fixture(t);
  if (sql) await f.accounts.prepare(sql).run();
  // When discovery is called.
  const response = await f.api(profiles, {}, browser(who));
  // Then no metadata is disclosed.
  assert.ok(response.status === 403 || response.status === 400, JSON.stringify(response));
  assert.equal(response.body.profiles, undefined);
});

test("profile availability exposes revoked and current partial consent rather than empty data", async t => {
  // Given known sources on revoked, metadata-only, local-only and full-content devices.
  const f = await fixture(t);
  for (const [id, mode] of [["device-a", "managed-content"], ["device-b", "metadata"],
    ["device-c", "local-only"], ["device-d", "managed-content"]]) {
    if (id !== "device-a") await f.accounts.prepare("INSERT INTO devices VALUES ('account-a',?,1,NULL)").bind(id).run();
    const consent = mode === "local-only" ? { mode } : {
      mode, version: 2, grantedAtMs: 0, scope: { deviceId: id, projectIds: [`device:${id}`], rootIds: [] },
      ...(mode === "managed-content" ? { serverProcessingAcknowledged: true,
        contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"] } : {}),
    };
    await f.accounts.prepare("INSERT INTO device_consents VALUES ('account-a',?,1,2,?,0)")
      .bind(id, JSON.stringify(consent)).run();
    await f.db.prepare("INSERT INTO device_streams VALUES ('account-a',1,?,'source',0,0)").bind(id).run();
  }
  await f.accounts.prepare("UPDATE devices SET revoked_at=5 WHERE device_id='device-a'").run();
  // When discovery is called.
  const response = await f.api(profiles, {}, browser());
  // Then metadata reflects revocation and the latest grant for every source.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.profiles.map(p => p.availability),
    ["revoked", "metadata-only", "local-only", "awaiting-runtime"]);
  assert.equal(response.body.devices[0].revokedAt, 5);
});
