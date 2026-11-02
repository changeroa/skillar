import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

export const principal = (changes = {}) => ({
  kind: "device", accountId: "account-a", deviceId: "device-a", generation: 1,
  shardId: "activity-00", scopes: ["activity:ingest", "activity:read"],
  issuer: "https://skillar.sh", sessionId: null, ...changes,
});
export const kinds = ["prompt", "query", "args", "error", "path", "span-attributes", "private-skills"];
const keyring = { current: 1, keys: {
  1: Buffer.alloc(32, 7).toString("base64url"), 2: Buffer.alloc(32, 9).toString("base64url"),
} };
const source = `
import { activityContentRequest } from "./src/activity/content-api.ts";
import { sweepContent } from "./src/activity/content-db.ts";
import { readBatchContent } from "./src/activity/content-service.ts";
let ring=${JSON.stringify(keyring)}, enabled="true", armed=false, lateArgs;
export default { async fetch(request, bindings, context) {
  const path=new URL(request.url).pathname;
  if(path==="/test/arm") {armed=true;return Response.json({armed:true});}
  if(path==="/test/release") {
    await bindings.ACTIVITY_RAW.put(...lateArgs);
    return Response.json({released:true});
  }
  if(path==="/test/keyring") {ring=await request.json();return Response.json({changed:true});}
  if(path==="/test/off") {enabled="false";return Response.json({disabled:true});}
  const env={...bindings,CONTENT_KEYRING:JSON.stringify(ring),ACTIVITY_INGEST_ENABLED:enabled};
  if(path==="/test/sweep") return Response.json(await sweepContent(env.ACTIVITY,env.ACTIVITY_RAW,await request.json()));
  if(path==="/test/read") {
    const {principal,input}=await request.json();
    try{return Response.json(await readBatchContent(env,principal,input));}
    catch(e){return Response.json({error:e.code??"fixture_error"},{status:e.status??500});}
  }
  if(armed) {
    const bucket=bindings.ACTIVITY_RAW;
    env.ACTIVITY_RAW={
      get:(...a)=>bucket.get(...a),delete:(...a)=>bucket.delete(...a),
      put:(...a)=>{
        armed=false;
        // Preserve the exact encrypted PUT at the simulated storage boundary.
        // A later explicit event completes it in R2, after the caller timed out.
        lateArgs=a;
        throw new Error("fixture_timeout_before_late_put");
      },
    };
  }
  return activityContentRequest(new Request("https://activity.internal"+path,request),env);
} };
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-content-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});

async function migrate(db, path) {
  const sql = await readFile(path, "utf8");
  let current = "", trigger = false;
  const statements = [];
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

export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-content-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACTIVITY: { type: "d1", name: "activity-content" },
      ACCOUNTS: { type: "d1", name: "content-accounts" },
      ACTIVITY_RAW: { type: "r2", name: "content-raw" },
    }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACTIVITY");
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const file of ["0001_activity_ledger.sql", "0002_content.sql"]) {
    await migrate(db, new URL(`../../activity-migrations/${file}`, import.meta.url));
  }
  for (const file of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql"]) {
    await migrate(accounts, new URL(`../../../site/migrations/${file}`, import.meta.url));
  }
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const seed = async (who = principal(), selected = kinds) => {
    await accounts.prepare("INSERT INTO users VALUES (?,?,'','',0,0)")
      .bind(who.accountId, `${who.accountId}@example.com`).run();
    await accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)")
      .bind(who.accountId, who.accountId).run();
    await accounts.prepare("INSERT INTO devices VALUES (?,?,0,NULL)")
      .bind(who.accountId, who.deviceId).run();
    await db.prepare("INSERT INTO tenant_fences VALUES (?,?,'active')")
      .bind(who.accountId, who.generation).run();
    await accounts.prepare("INSERT INTO device_consents VALUES (?,?,?,1,?,0)")
      .bind(who.accountId, who.deviceId, who.generation, JSON.stringify({
        mode: "managed-content", version: 1, grantedAtMs: 0,
        scope: { deviceId: who.deviceId, projectIds: ["project"], rootIds: [] },
        serverProcessingAcknowledged: true, contentKinds: selected,
      })).run();
  };
  await seed();
  const send = async (path, value = {}, who = principal()) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid${path}`, {
      method: "POST", headers: {
        "content-type": "application/json", "x-skillar-principal": JSON.stringify(who),
      }, body: JSON.stringify(value),
    });
    return { status: response.status, body: await response.json() };
  };
  const upload = async (packet, who = principal()) => {
    for (const chunk of packet.uploads) {
      assert.equal((await send("/v1/activity/chunks", chunk, who)).status, 201);
    }
    return send("/v1/activity/batches", packet.batch, who);
  };
  return { db, accounts, bucket, rows, seed, send, upload };
}

export async function packet(document, options = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  const through = options.through ?? 7;
  const common = {
    schemaVersion: 2, batchId: options.batchId ?? "batch-1",
    deviceId: options.deviceId ?? "device-a", sourceDomain: "source",
    generation: 1, consentVersion: 1, projectId: "project", rootId: null,
    range: { fromMs: 0, toMs: 1000 }, backfill: null,
  };
  const hash = async bytes => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const uploads = [];
  for (let offset = 0; offset < bytes.length; offset += options.chunkBytes ?? 128 * 1024) {
    const part = bytes.subarray(offset, offset + (options.chunkBytes ?? 128 * 1024));
    uploads.push({ ...common, index: uploads.length, revision: through,
      plaintextHash: await hash(part), bytes: part.length, body: Buffer.from(part).toString("base64") });
  }
  return { uploads, batch: {
    ...common, sequence: options.sequence ?? 1,
    journal: { from: options.from ?? 0, through },
    metadataMutations: options.metadataMutations ?? [],
    chunks: uploads.map(({ index, revision, plaintextHash, bytes }) => ({ index, revision, plaintextHash, bytes })),
    contentHash: await hash(bytes), totalBytes: bytes.length,
  } };
}
