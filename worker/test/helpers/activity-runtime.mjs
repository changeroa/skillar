import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
export { principal, kinds } from "./activity-content.mjs";

const source = `
import { commitRuntime,readRuntimeContext,latestRuntimeRevision } from "./src/activity/runtime-api.ts";
import { storeContentChunk } from "./src/activity/content-objects.ts";
import { sweepContent } from "./src/activity/content-db.ts";
import { activityContentRequest } from "./src/activity/content-api.ts";
import { ActivityContractError } from "../shared/activity-schema.ts";
let latePut,armed=false;
export default {async fetch(request,bindings) {
  const env={...bindings,CONTENT_KEYRING:JSON.stringify({current:1,keys:{
    1:"${Buffer.alloc(32, 7).toString("base64url")}"}}),ACTIVITY_INGEST_ENABLED:"true"};
  const path=new URL(request.url).pathname;
  if(path.startsWith("/v1/")) {
    return activityContentRequest(new Request("https://activity.internal"+path,request),env);
  }
  const {principal,input}=await request.json();
  try {
    let value;
    switch(path) {
      case "/arm": armed=true;value={armed:true};break;
      case "/release": await bindings.ACTIVITY_RAW.put(...latePut);value={released:true};break;
      case "/chunk": {
        if(armed) {
          const bucket=bindings.ACTIVITY_RAW;
          env.ACTIVITY_RAW={get:(...a)=>bucket.get(...a),delete:(...a)=>bucket.delete(...a),
            put:(...a)=>{armed=false;latePut=a;throw new Error("fixture_late_put");}};
        }
        value=await storeContentChunk(env,principal,input);break;
      }
      case "/commit":
        value=await commitRuntime(env,principal,input);break;
      case "/read": case "/readThenRevoke": {
        if(path==="/readThenRevoke") {
          const bucket=bindings.ACTIVITY_RAW;
          env.ACTIVITY_RAW={async get(...args) {
            const object=await bucket.get(...args);
            await bindings.ACCOUNTS.prepare("UPDATE devices SET revoked_at=1").run();
            return object;
          }};
        }
        value=await readRuntimeContext(env,principal,input);break;
      }
      case "/latest":
        env.ACTIVITY_RAW={get:()=>{throw new Error("latest_must_not_decrypt");}};
        value=await latestRuntimeRevision(env,principal,input.sourceDomain);break;
      case "/sweep": value=await sweepContent(env.ACTIVITY,env.ACTIVITY_RAW,input);break;
      case "/sweepLatePin": {
        const db=bindings.ACTIVITY;
        const intercepted={prepare(sql) {
          const statement=db.prepare(sql);
          if(!sql.startsWith("SELECT u.object_key")) return statement;
          return {bind(...args) { const bound=statement.bind(...args);return {async all() {
            const candidates=await bound.all();
            await commitRuntime(env,principal,input.commit);
            return candidates;
          }};}};
        }};
        value=await sweepContent(intercepted,env.ACTIVITY_RAW,{orphanBeforeMs:Number.MAX_SAFE_INTEGER});
        break;
      }
      default: throw new Error("unknown_fixture_operation");
    }
    return Response.json(value);
  } catch(error) {
    return Response.json({error:error.code??"invalid_request",message:error.message},
      {status:error.status??(error instanceof ActivityContractError?403:400)});
  }
}};
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-runtime-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
export async function migrate(db, path) {
  const sql = await readFile(path, "utf8"), statements = [];
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
export const grant = (changes = {}) => ({
  mode: "managed-content", version: 1, grantedAtMs: 0,
  scope: { deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [] },
  serverProcessingAcknowledged: true,
  contentKinds: ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"],
  ...changes,
});
export const context = (changes = {}) => ({
  schemaVersion: 1, capturedAtMs: 100, activeRequests: ["ACTIVE_SECRET"],
  ingest: { accepted: 2, rejected: 1, dropped: 0, lastError: { ts: 99, code: "ERROR_SECRET" } },
  tz: "Asia/Seoul", ...changes,
});
export async function packet(runtime = context(), changes = {}) {
  const bytes = Buffer.from(JSON.stringify(runtime));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const commit = {
    schemaVersion: 1, deviceId: "device-a", sourceDomain: "source", generation: 1,
    consentVersion: 1, projectId: "device:device-a", rootId: null,
    range: { fromMs: 0, toMs: 1000 }, backfill: null,
    batchId: randomUUID(), sequence: 1, sourceCut: 7, capturedAtMs: runtime.capturedAtMs,
    chunks: [{ index: 0, revision: changes.sourceCut ?? 7, plaintextHash: hash, bytes: bytes.length }],
    contentHash: hash, totalBytes: bytes.length, ...changes,
  };
  const { sequence, sourceCut, capturedAtMs, chunks, contentHash, totalBytes, ...common } = commit;
  return { commit, uploads: [{ ...common, schemaVersion: 2, ...chunks[0], body: bytes.toString("base64") }] };
}
export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-runtime-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACTIVITY: { type: "d1", name: "runtime-activity" },
      ACCOUNTS: { type: "d1", name: "runtime-accounts" },
      ACTIVITY_RAW: { type: "r2", name: "runtime-content" },
    }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACTIVITY");
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql", "0005_runtime.sql"]) {
    await migrate(db, new URL(`../../activity-migrations/${name}`, import.meta.url));
  }
  for (const name of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql"]) {
    await migrate(accounts, new URL(`../../../site/migrations/${name}`, import.meta.url));
  }
  await accounts.prepare("INSERT INTO users VALUES ('account-a','a@example.com','','',0,0)").run();
  await accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES ('account-a','account-a')").run();
  await accounts.prepare("INSERT INTO devices VALUES ('account-a','device-a',0,NULL)").run();
  await db.prepare("INSERT INTO tenant_fences VALUES ('account-a',1,'active')").run();
  const consent = async (value = grant()) => {
    await accounts.prepare(`INSERT INTO device_consents VALUES ('account-a','device-a',1,?,?,0)
      ON CONFLICT(account_id,device_id,version) DO UPDATE SET consent_json=excluded.consent_json`)
      .bind(value.version ?? 1, JSON.stringify(value)).run();
  };
  await consent();
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const send = async (name, input = {}, who = {
    kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
    shardId: "activity-00", scopes: ["activity:read", "activity:ingest"],
  }) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid/${name}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: who, input }),
    });
    return { status: response.status, body: await response.json() };
  };
  const api = async (path, input, who) => runtime.dispatchFetch(`https://fixture.invalid${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-skillar-principal": JSON.stringify(who) },
    body: JSON.stringify(input),
  });
  const head = async (cut = 7, sequence = 3, source = "source") => {
    await db.prepare(`INSERT INTO device_streams VALUES ('account-a',1,'device-a',?,?,?)
      ON CONFLICT(account_id,generation,device_id,source_domain)
      DO UPDATE SET sequence=excluded.sequence,journal_through=excluded.journal_through`)
      .bind(source, sequence, cut).run();
  };
  const stage = async p => {
    for (const upload of p.uploads) {
      const result = await send("chunk", upload);
      assert.equal(result.status, 200, JSON.stringify(result));
    }
  };
  return { db, accounts, bucket, rows, consent, send, api, head, stage };
}
