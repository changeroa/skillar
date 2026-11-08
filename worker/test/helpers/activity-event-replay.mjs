// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
export { batch, principal } from "./activity-ledger.mjs";

const bundle = build({
  stdin: {
    contents: `
import { readAccountChanges,sweepAccountChanges } from "./src/activity/event-replay.ts";
import { dispatchAccountEvents } from "./src/activity/event-dispatch.ts";
import { commitActivityBatch } from "./src/activity/ledger.ts";
export class TestHub {
  constructor(state,env) {this.state=state;this.env=env;}
  async fetch(request) {
    const value=await request.json(),db=this.env.ACTIVITY;
    const mode=await db.prepare("SELECT mode FROM test_control WHERE account_id=?")
      .bind(value.accountId).first();
    await db.prepare("INSERT INTO test_notifications VALUES(?,?,?,?,?)")
      .bind(this.state.id.toString(),request.url,request.method,
        request.headers.get("content-type"),JSON.stringify(value)).run();
    if(mode?.mode==="advance") {
      await db.batch([
        db.prepare("UPDATE account_heads SET head_seq=head_seq+1 WHERE account_id=? AND generation=?")
          .bind(value.accountId,value.generation),
        db.prepare("INSERT INTO account_changes(account_id,generation,seq,invalidation_kind) SELECT account_id,generation,head_seq,'runtime' FROM account_heads WHERE account_id=? AND generation=?")
          .bind(value.accountId,value.generation),
        db.prepare("DELETE FROM test_control WHERE account_id=?").bind(value.accountId),
      ]);
    }
    if(mode?.mode==="lost") throw new Error("fixture_lost_response");
    return new Response(null,{status:mode?.mode==="fail"?503:204});
  }
}
export default {async fetch(request,env) {
  const {op,input,principal}=await request.json();
  try {
    let value;
    switch(op) {
      case "read": value=await readAccountChanges(env.ACTIVITY,principal,input.since);break;
      case "sweep": await sweepAccountChanges(env.ACTIVITY);value={};break;
      case "dispatch": await dispatchAccountEvents(env);value={};break;
      case "commit": value=await commitActivityBatch(env.ACTIVITY,{principal,batch:input,receivedAtMs:100});break;
      default: throw new Error("unknown_fixture_operation");
    }
    return Response.json(value);
  } catch(error) {return Response.json({error:error.message},{status:500});}
}};
`,
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-event-replay-fixture.mjs",
  },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});

export const scope = account => createHash("sha256")
  .update(JSON.stringify(["account-wide-v1", account])).digest("hex");
export const cursor = (seq, account = "account-a", generation = 1) => `${scope(account)}.${generation}.${seq}`;
export const retention = 7 * 24 * 60 * 60 * 1000;

export async function migrate(db, name = "0007_account_events.sql") {
  const sql = await readFile(new URL(`../../activity-migrations/${name}`, import.meta.url), "utf8");
  const statements = [];
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

export async function fixture(t, { eventsMigration = true } = {}) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-events-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACTIVITY: { type: "d1", name: "account-events" },
      ACCOUNT_HUB: { type: "durable-object", worker: "activity-events-fixture", exportName: "TestHub" },
    },
    exports: { TestHub: { type: "durable-object", storage: "sqlite" } },
  } }] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACTIVITY");
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql",
    "0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql",
    ...(eventsMigration ? ["0007_account_events.sql"] : [])]) await migrate(db, name);
  await db.batch([
    db.prepare("INSERT INTO tenant_fences VALUES ('account-a',1,'active')"),
    db.prepare("CREATE TABLE test_control(account_id TEXT PRIMARY KEY,mode TEXT)"),
    db.prepare("CREATE TABLE test_notifications(id TEXT,url TEXT,method TEXT,content_type TEXT,body TEXT)"),
  ]);
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const send = async (op, input = {}, principal = { accountId: "account-a", generation: 1 }) => {
    const response = await runtime.dispatchFetch("https://fixture.invalid/", {
      method: "POST", body: JSON.stringify({ op, input, principal }),
    });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  const append = async (count = 1, account = "account-a", generation = 1) => {
    const statements = [db.prepare(`INSERT INTO account_heads(account_id,generation,head_seq)
      VALUES(?,?,0) ON CONFLICT(account_id,generation) DO NOTHING`).bind(account, generation)];
    for (let n = 0; n < count; n++) statements.push(
      db.prepare("UPDATE account_heads SET head_seq=head_seq+1 WHERE account_id=? AND generation=?").bind(account, generation),
      db.prepare(`INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
        SELECT account_id,generation,head_seq,'activity' FROM account_heads WHERE account_id=? AND generation=?`)
        .bind(account, generation),
    );
    await db.batch(statements);
  };
  const mode = value => db.prepare(`INSERT INTO test_control VALUES('account-a',?)
    ON CONFLICT(account_id) DO UPDATE SET mode=excluded.mode`).bind(value).run();
  const namespace = await runtime.getDurableObjectNamespace("ACCOUNT_HUB");
  return { db, rows, send, append, mode, hubId: account => namespace.idFromName(account).toString(),
    read: (since = null, principal) => send("read", { since }, principal) };
}
