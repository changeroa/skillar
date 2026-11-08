// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { activityDb } from "../../site/test/helpers/activity-db.mjs";
import { fixture as activityFixture } from "./helpers/activity-event-replay.mjs";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/activity/event-controls.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
});
const { dispatchAccountControls } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

async function fixture(t) {
  const primary = await activityDb(t);
  const shard = await activityFixture(t);
  primary.db.exec(`INSERT INTO users VALUES ('owner','fixture@example.com','','',1,1);
    INSERT INTO accounts(account_id,user_sub) VALUES ('account-a','owner');
    INSERT INTO devices VALUES ('account-a','fixture-device',1,NULL);`);
  const consent = (version = 1) => primary.db.prepare(`INSERT INTO device_consents VALUES
    ('account-a','fixture-device',1,?,'{"mode":"local-only"}',1)`).run(version);
  const pending = () => primary.db.prepare("SELECT count(*) AS n FROM account_control_outbox").get().n;
  const head = async () => await shard.db.prepare(
    "SELECT head_seq FROM account_heads WHERE account_id='account-a' AND generation=1",
  ).first("head_seq");
  return { primary, shard, consent, pending, head,
    env: { ACCOUNTS: primary.accounts, ACTIVITY: shard.db } };
}

test("consent and device revocation enqueue opaque notifications in their own transaction", async t => {
  const f = await fixture(t);
  f.primary.db.exec("BEGIN");
  f.consent();
  assert.equal(f.pending(), 1);
  f.primary.db.exec("ROLLBACK");
  assert.equal(f.pending(), 0);
  f.consent();
  f.primary.db.exec("UPDATE devices SET revoked_at=2 WHERE device_id='fixture-device'");
  assert.equal(f.pending(), 2);
  f.primary.db.exec("UPDATE devices SET revoked_at=3 WHERE device_id='fixture-device'");
  assert.equal(f.pending(), 2, "already-revoked updates do not create duplicate events");
  const columns = f.primary.db.prepare("PRAGMA table_info(account_control_outbox)").all().map(row => row.name);
  assert.deepEqual(columns, ["control_id", "account_id", "generation", "created_at_ms"]);
  await dispatchAccountControls(f.env);
  assert.equal(f.pending(), 0);
  assert.equal(await f.head(), 2);
  const rows = (await f.shard.db.prepare("SELECT invalidation_kind FROM account_changes ORDER BY seq").all()).results;
  assert.deepEqual(rows, [{ invalidation_kind: "consent" }, { invalidation_kind: "consent" }]);
});

test("lost primary ACK retries the committed shard receipt without advancing its head twice", async t => {
  const f = await fixture(t);
  f.consent();
  const lostAck = { ...f.env, ACCOUNTS: { ...f.primary.accounts, prepare(sql) {
    const statement = f.primary.accounts.prepare(sql);
    if (!sql.includes("WHERE control_id=?")) return statement;
    return { bind() { return { async run() { throw new Error("fixture_lost_ack"); } }; } };
  } } };
  await assert.rejects(dispatchAccountControls(lostAck), /fixture_lost_ack/);
  assert.equal(await f.head(), 1);
  assert.equal(f.pending(), 1);
  await dispatchAccountControls(f.env);
  assert.equal(await f.head(), 1);
  assert.equal(f.pending(), 0);
  assert.equal(await f.shard.db.prepare("SELECT count(*) AS n FROM account_control_receipts").first("n"), 1);
});

test("inactive generations and expired primary notification rows never create new shard changes", async t => {
  const f = await fixture(t);
  f.consent();
  f.primary.db.exec("UPDATE accounts SET auth_generation=2");
  await dispatchAccountControls(f.env);
  assert.equal(f.pending(), 0);
  assert.equal(await f.head(), null);
  f.primary.db.exec("UPDATE accounts SET auth_generation=1");
  f.consent(2);
  f.primary.db.exec("UPDATE account_control_outbox SET created_at_ms=0");
  await dispatchAccountControls(f.env);
  assert.equal(f.pending(), 0);
  assert.equal(await f.head(), null);
});

test("closed shard fences cannot be reopened by a delayed consent notification", async t => {
  const f = await fixture(t);
  f.consent();
  await f.shard.db.prepare("UPDATE tenant_fences SET state='closed' WHERE account_id='account-a'").run();
  await dispatchAccountControls(f.env);
  assert.equal(f.pending(), 0);
  assert.equal(await f.head(), null);
});
