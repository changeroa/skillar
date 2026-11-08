import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";

export const browser = (extra = {}) => ({
  kind: "browser", accountId: "account-a", generation: 1, shardId: "activity-00",
  issuer: "https://skillar.sh", sessionId: "s".repeat(40), deviceId: null, tokenHash: null,
  scopes: ["skills:read", "skills:write"], ...extra,
});
export const ids = Array.from({ length: 5 }, (_, index) =>
  `${index + 1}381f285-e3d8-49c2-9c51-228f1d852998`);
const source = `
import { privatePacksRequest } from "./src/activity/private-packs.ts";
import { sweepPrivatePacks } from "./src/activity/private-packs-cleanup.ts";
Date.now=()=>1793720000000;
let hook=null, reads=[];
export default { async fetch(request, bindings) {
  const path=new URL(request.url).pathname;
  if(path==="/test/hook") { hook=await request.json(); return Response.json({ok:true}); }
  if(path==="/test/reads") return Response.json(reads);
  if(path==="/test/sweep") return Response.json(await sweepPrivatePacks(bindings));
  const env={...bindings,PRIVATE_SKILLS_ENABLED:"true",
    CONTENT_KEYRING:JSON.stringify({current:1,keys:{1:"${Buffer.alloc(32, 7).toString("base64url")}"}})};
  const execute=async(point)=>{
    if(hook?.point!==point) return;
    const action=hook; hook=null;
    if(action.sql) await bindings[action.database??"ACTIVITY"].prepare(action.sql).run();
    if(action.fail) throw new Error("synthetic_storage_failure");
  };
  env.ACTIVITY_RAW={
    put:async(...args)=>{ const result=await bindings.ACTIVITY_RAW.put(...args); await execute("put"); return result; },
    get:async(...args)=>{ reads.push(args[0]); const result=await bindings.ACTIVITY_RAW.get(...args); await execute("get"); return result; },
  };
  env.ACTIVITY={
    prepare:(...args)=>bindings.ACTIVITY.prepare(...args),
    batch:async(...args)=>{ await execute("batch"); return bindings.ACTIVITY.batch(...args); },
  };
  const internal=new Request("https://activity.internal"+path,request);
  if(request.headers.has("x-test-external")) return await privatePacksRequest(request,env);
  return await privatePacksRequest(internal,env)??new Response("unhandled",{status:404});
}};
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    sourcefile: "private-packs-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});
async function migrate(db, path) {
  const text = await readFile(path, "utf8");
  let current = "", trigger = false;
  const statements = [];
  for (const line of text.replace(/^--.*$/gm, "").split("\n")) {
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
export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "private-packs", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACCOUNTS: { type: "d1", name: "pack-accounts" },
      ACTIVITY: { type: "d1", name: "pack-activity" },
      ACTIVITY_RAW: { type: "r2", name: "pack-content" },
    }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const db = await runtime.getD1Database("ACTIVITY");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const name of ["0001_accounts", "0002_activity_accounts", "0003_activity_consent",
    "0004_account_events", "0005_private_skills", "0006_mcp_connections"]) {
    await migrate(accounts, new URL(`../../site/migrations/${name}.sql`, import.meta.url));
  }
  for (const name of ["0001_activity_ledger", "0002_content", "0009_private_packs"]) {
    await migrate(db, new URL(`../activity-migrations/${name}.sql`, import.meta.url));
  }
  for (const account of ["account-a", "account-b"]) {
    await accounts.batch([
      accounts.prepare("INSERT INTO users VALUES (?,?,'','',0,0)").bind(account, `${account}@example.com`),
      accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)").bind(account, account),
      accounts.prepare("INSERT INTO sessions VALUES (?,?,?)")
        .bind(account === "account-a" ? browser().sessionId : "b".repeat(40), account, 1793730000),
      accounts.prepare("INSERT INTO devices VALUES (?,?,0,NULL)").bind(account, "device-a"),
      accounts.prepare("INSERT INTO api_tokens VALUES (?,?,?,?,?,?,1,?,NULL)")
        .bind(account.padEnd(43, "t"), account, "device-a", JSON.stringify(["skills:read", "skills:write"]),
          "https://skillar.sh", "skillar:activity", 1793730000),
    ]);
    await db.prepare("INSERT INTO tenant_fences VALUES (?,1,'active')").bind(account).run();
  }
  const seedSkill = async (id, marker = "base", account = "account-a") => {
    const packet = await createPrivateSkillPackage([{ path: "SKILL.md", mediaType: "text/markdown",
      bytes: new TextEncoder().encode(`---\nname: quartz\ndescription: Quartz analysis\n---\n${id} ${marker}`) }]);
    const uri = `skillar://private/${id}/${packet.manifestDigest}/SKILL.md`;
    const entry = { uri, name: "quartz", description: "Quartz analysis", examples: [], aliasesKo: [],
      invocation: id === ids[4] ? "explicit" : "automatic", bodyHead: marker,
      digest: packet.manifest.resources[0].digest };
    await accounts.batch([
      accounts.prepare(`INSERT INTO private_skills
        (account_id,generation,skill_id,digest,revision,name,description,updated_at,mutation_id)
        VALUES(?,1,?,?,1,'quartz','Quartz analysis',0,?) ON CONFLICT DO NOTHING`)
        .bind(account, id, packet.manifestDigest, randomUUID()),
      accounts.prepare(`INSERT INTO private_skill_versions
        (account_id,generation,skill_id,digest,manifest_json,entry_json,created_at,pinned)
        VALUES(?,1,?,?,?,?,0,1)`)
        .bind(account, id, packet.manifestDigest, JSON.stringify(packet.manifest), JSON.stringify(entry)),
    ]);
    return uri;
  };
  const uris = [];
  for (const id of ids) uris.push(await seedSkill(id));
  const definition = (name = "quartz-pack") => ({
    schema_version: 1, kind: "skill-pack", name, display_name: name,
    description: "Quartz analysis pack", scope: "PRIVATE_PACK_SCOPE", members: [
      { uri: uris[0], phase: "scope", selection: "required", when: "Define scope" },
      { uri: uris[1], phase: "investigate", selection: "required", when: "Investigate" },
      { uri: uris[2], phase: "verify", selection: "required", when: "Verify evidence" },
      { uri: uris[3], phase: "investigate", selection: "when_applicable", when: `${name} conditions` },
      { uri: uris[4], phase: "explain", selection: "when_requested", when: "Explain on request" },
    ],
  });
  const send = async (action, value, who = browser(), headers = {}) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid${action.startsWith("/test/") ? action : "/v1/private-packs/" + action}`, {
      method: "POST", headers: { "content-type": "application/json",
        "x-skillar-principal": JSON.stringify(who), ...headers }, body: JSON.stringify(value),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const create = (def = definition(), request_id = randomUUID()) =>
    ({ request_id, acknowledge_private_upload: true, definition: def });
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  return { db, accounts, bucket, rows, send, seedSkill, definition, create,
    hook: action => send("/test/hook", action) };
}
