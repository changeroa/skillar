import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
export { packet, principal, kinds } from "./activity-content.mjs";

const source = `
import * as migrations from "./src/activity/migrations.ts";
import { storeContentChunk } from "./src/activity/content-objects.ts";
import { acceptContentBatch,readBatchContent } from "./src/activity/content-service.ts";
import { sweepContent } from "./src/activity/content-db.ts";
import { summarizeSnapshot } from "../shared/activity-sync.ts";
import { ActivityContractError } from "../shared/activity-schema.ts";
import { activityContentRequest } from "./src/activity/content-api.ts";
const ring=JSON.stringify({current:1,keys:{1:"${Buffer.alloc(32, 7).toString("base64url")}"}});
let armed=false,latePut;
const fixtureActions={};
export default { async fetch(request,bindings) {
  const env={...bindings,CONTENT_KEYRING:ring};
  fixtureActions.environment?.(env);
  const path=new URL(request.url).pathname;
  if(path.startsWith("/v1/")) return activityContentRequest(
    new Request("https://activity.internal"+path,request),{...env,ACTIVITY_INGEST_ENABLED:"true"});
  const {principal,input}=await request.json();
  const name=new URL(request.url).pathname.slice(1);
  try {
    if(name==="armLatePut") {armed=true;return Response.json({armed:true});}
    if(name==="releaseLatePut") {
      await bindings.ACTIVITY_RAW.put(...latePut);
      return Response.json({released:true});
    }
    if(armed && name==="chunk") {
      const bucket=bindings.ACTIVITY_RAW;
      env.ACTIVITY_RAW={
        get:(...args)=>bucket.get(...args),delete:(...args)=>bucket.delete(...args),
        put:(...args)=>{
          armed=false;latePut=args;
          throw new Error("fixture_timeout_before_late_put");
        },
      };
    }
    let value;
    switch(name) {
      case "chunk": value=await storeContentChunk(env,principal,input);break;
      case "cdc": value=await acceptContentBatch(env,principal,input);break;
      case "readCdc": value=await readBatchContent(env,principal,input);break;
      case "sweep": value=await sweepContent(env.ACTIVITY,env.ACTIVITY_RAW,input);break;
      case "summary": value=await summarizeSnapshot(input);break;
      case "begin": value=await migrations.beginMigration(env,principal,input);break;
      case "status": value=await migrations.migrationStatus(env,principal,input);break;
      case "page": value=await migrations.stageMigrationPage(env,principal,input);break;
      case "complete": value=await migrations.completeMigration(env,principal,input);break;
      case "export": value=await migrations.exportMigration(env,principal,input);break;
      case "rollback": value=await migrations.rollbackMigration(env,principal,input);break;
      default:
        if(!fixtureActions[name]) throw new Error("unknown_fixture_operation");
        value=await fixtureActions[name](env,principal,input);
    }
    return Response.json(value);
  } catch(error) {
    return Response.json({error:error.code??"invalid_request",message:error.message},
      {status:error.status??(error instanceof ActivityContractError?403:400)});
  }
} };
`;
const createBundle = suffix => build({
  stdin: { contents: source + suffix, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-migrations-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  external: ["cloudflare:workers", "cloudflare:workflows"],
});
const bundle = createBundle("");

async function migrate(db, path) {
  const sql = await readFile(path, "utf8");
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

export async function fixture(t, options = {}) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-migrations-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await (options.sourceSuffix ? createBundle(options.sourceSuffix) : bundle)).outputFiles[0].text },
    } },
    env: {
      ACTIVITY: { type: "d1", name: "migration-activity" },
      ACCOUNTS: { type: "d1", name: "migration-accounts" },
      ACTIVITY_RAW: { type: "r2", name: "migration-content" },
      ...options.env,
    }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACTIVITY");
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql", ...(options.migrations ?? [])]) {
    await migrate(db, new URL(`../../activity-migrations/${name}`, import.meta.url));
  }
  for (const name of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql"]) {
    await migrate(accounts, new URL(`../../../site/migrations/${name}`, import.meta.url));
  }
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  await accounts.prepare("INSERT INTO users VALUES ('account-a','a@example.com','','',0,0)").run();
  await accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES ('account-a','account-a')").run();
  await accounts.prepare("INSERT INTO devices VALUES ('account-a','device-a',0,NULL)").run();
  await db.prepare("INSERT INTO tenant_fences VALUES ('account-a',1,'active')").run();
  const consent = async (begin, changes = {}) => {
    const grant = {
      mode: "managed-content", version: 1, grantedAtMs: 1000,
      scope: { deviceId: "device-a", projectIds: ["project"], rootIds: [] },
      serverProcessingAcknowledged: true,
      contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"],
      backfill: { ...begin.backfill, range: begin.range },
      ...changes,
    };
    await accounts.prepare(`INSERT INTO device_consents VALUES ('account-a','device-a',1,1,?,0)
      ON CONFLICT(account_id,device_id,version) DO UPDATE SET consent_json=excluded.consent_json`)
      .bind(JSON.stringify(grant)).run();
  };
  const send = async (name, input, who = {
    kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", scopes: ["activity:ingest", "activity:read"],
  }) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid/${name}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: who, input }),
    });
    return { status: response.status, body: await response.json() };
  };
  const api = (path, input, who = {
    kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", scopes: ["activity:ingest", "activity:read"],
    issuer: "https://skillar.sh", sessionId: null,
  }) => runtime.dispatchFetch(`https://fixture.invalid${path}`, {
    method: "POST", headers: {
      "content-type": "application/json", "x-skillar-principal": JSON.stringify(who),
    }, body: JSON.stringify(input),
  });
  return { db, accounts, bucket, rows, consent, send, api };
}

export const ref = begin => ({
  deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
  generation: begin.generation, snapshotId: begin.snapshotId,
});
export async function snapshot(f, documents, { cut = 0, snapshotId = "snapshot-1", ...options } = {}) {
  const { packet } = await import("./activity-content.mjs");
  const summary = (await f.send("summary", documents.flatMap(document => document.rows))).body;
  const begin = {
    ...ref({ deviceId: "device-a", sourceDomain: "source", generation: 1, snapshotId }),
    schemaVersion: 1, purpose: "initial", consentVersion: 1, projectId: "project", rootId: null,
    range: { fromMs: 0, toMs: 1000 }, backfill: { version: 1, snapshotId, journalCut: cut },
    cut, pageCount: documents.length, counts: summary.counts, snapshotHash: summary.snapshotHash,
    ...options,
  };
  await f.consent(begin);
  const packets = [];
  for (const [index, document] of documents.entries()) {
    const p = await packet(document, { through: cut, batchId: `${snapshotId}-page-${index}` });
    p.uploads = p.uploads.map(upload => ({
      ...upload, deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
      generation: begin.generation, consentVersion: begin.consentVersion,
      projectId: begin.projectId, rootId: begin.rootId, range: begin.range, backfill: begin.backfill,
    }));
    packets.push({
      uploads: p.uploads,
      page: {
        ...ref(begin), index, batchId: p.batch.batchId, chunks: p.batch.chunks,
        contentHash: p.batch.contentHash, totalBytes: p.batch.totalBytes,
        counts: (await f.send("summary", document.rows)).body.counts,
      },
    });
  }
  const stage = async index => {
    const p = packets[index];
    for (const upload of p.uploads) {
      const response = await f.send("chunk", upload);
      assert.equal(response.status, 200, JSON.stringify(response));
    }
    return f.send("page", p.page);
  };
  return { begin, packets, stage };
}
