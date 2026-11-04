// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { browser, now, packet, skillId } from "./private-skill-backend.mjs";

export { now, packet, skillId };
const origin = "https://skillar.sh";
const source = `
import { activityContentRequest } from "./src/activity/content-api.ts";
import { reconcileDeletion } from "./src/activity/deletion-cleanup.ts";
import { writeContentKey, readContentKey } from "./src/activity/content-keys.ts";
import { activeFence } from "./src/activity/content-db.ts";
import { activityRequest } from "../site/lib/activity-routes.ts";
import { signCookie, SESSION_COOKIE } from "../site/lib/auth.ts";
export { AccountHub } from "./src/activity/account-hub.ts";
export { PrivateSkillCatalog } from "./src/private-skills/index.ts";
const config={PUBLIC_ORIGIN:"${origin}",GOOGLE_CLIENT_ID:"fixture-client",
  GOOGLE_CLIENT_SECRET:"fixture-secret",SESSION_KEY:"fixture-session-key-at-least-32-characters"};
let clock=${now};
let unavailable=false, failDelete=false;
Date.now=()=>clock;
export default {async fetch(request,bindings) {
  const path=new URL(request.url).pathname;
  const env={...bindings,...config,ACTIVITY_ENABLED:"true",ACTIVITY_INGEST_ENABLED:"true",
    PRIVATE_SKILLS_ENABLED:"true",CONTENT_KEYRING:JSON.stringify({
      current:1,keys:{"1":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}})};
  env.ACTIVITY_SERVICE={fetch:(input,init)=>activityContentRequest(new Request(input,init),env)};
  if(unavailable) env.ACTIVITY_SERVICE={fetch:async()=>Response.json({error:"offline"},{status:503})};
  if(failDelete) env.ACTIVITY_RAW={
    get:(...a)=>bindings.ACTIVITY_RAW.get(...a),put:(...a)=>bindings.ACTIVITY_RAW.put(...a),
    head:(...a)=>bindings.ACTIVITY_RAW.head(...a),list:(...a)=>bindings.ACTIVITY_RAW.list(...a),
    delete:async()=>{throw new Error("fixture_storage_unavailable")}
  };
  if(path==="/test/clock"){clock=(await request.json()).now;return Response.json({ok:true});}
  if(path==="/test/fault"){
    const value=await request.json();
    unavailable=value.unavailable??false;failDelete=value.failDelete??false;
    return Response.json({ok:true});
  }
  if(path==="/test/key"){
    await writeContentKey(env.ACTIVITY,{accountId:"account-a",generation:1},env.CONTENT_KEYRING);
    return Response.json({created:true});
  }
  if(path==="/test/read-key"){
    const target={accountId:"account-a",generation:1};
    try{
      await activeFence(env.ACTIVITY,target);
      await readContentKey(env.ACTIVITY,target,env.CONTENT_KEYRING,1);
      return Response.json({readable:true});
    }catch(error){return Response.json({readable:false,error:error.code},{status:403});}
  }
  if(path==="/test/cookie"){
    const {sub,sid}=await request.json();
    return Response.json({cookie:SESSION_COOKIE+"="+await signCookie({sub,sid},"session",config,clock/1000)});
  }
  if(path==="/test/reconcile"){
    const {target,options}=await request.json();
    return Response.json(await reconcileDeletion(env,target,options));
  }
  if(path.startsWith("/api/")||path.startsWith("/v1/devices/")){
    return activityRequest(new Request("${origin}"+path,request),env);
  }
  return activityContentRequest(new Request("https://activity.internal"+path,request),env);
}};
`;
const bundle = build({
  stdin: { contents: source, resolveDir: new URL("../../", import.meta.url).pathname },
  bundle: true, write: false, format: "esm", platform: "browser",
  external: ["cloudflare:workers"], target: "es2022",
});

async function migrate(db, directory) {
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(name, directory), "utf8");
    let current = "", trigger = false;
    const statements = [];
    for (const line of sql.replace(/^\s*--.*$/gm, "").split("\n")) {
      if (!line.trim()) continue;
      current += `${line} `;
      if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
      if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
        statements.push(db.prepare(current.trim()));
        current = ""; trigger = false;
      }
    }
    assert.equal(current, "", name);
    await db.batch(statements);
  }
}

export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "activity-deletion", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACTIVITY: { type: "d1", name: "deletion-activity" },
      ACCOUNTS: { type: "d1", name: "deletion-accounts" },
      ACTIVITY_RAW: { type: "r2", name: "deletion-raw" },
      PRIVATE_SKILLS_ENABLED: { type: "text", value: "true" },
      PUBLIC_ORIGIN: { type: "text", value: origin },
      ACCOUNT_HUB: { type: "durable-object", worker: "activity-deletion", exportName: "AccountHub" },
      PRIVATE_SKILL_CATALOG: { type: "durable-object", worker: "activity-deletion", exportName: "PrivateSkillCatalog" },
    },
    exports: {
      AccountHub: { type: "durable-object", storage: "sqlite" },
      PrivateSkillCatalog: { type: "durable-object", storage: "sqlite" },
    },
  } }] });
  t.after(() => runtime.dispose());
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const activity = await runtime.getD1Database("ACTIVITY");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  await migrate(accounts, new URL("../../../site/migrations/", import.meta.url));
  await migrate(activity, new URL("../../activity-migrations/", import.meta.url));
  const send = async (path, value, headers = {}, method = "POST") =>
    runtime.dispatchFetch(`https://fixture.invalid${path}`, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  const seed = async (accountId = "account-a") => {
    const principal = browser(accountId);
    await accounts.batch([
      accounts.prepare("INSERT INTO users VALUES (?,?, '', '',0,0)")
        .bind(accountId, `${accountId}@example.test`),
      accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES(?,?)").bind(accountId, accountId),
      accounts.prepare("INSERT INTO sessions VALUES(?,?,?)")
        .bind(principal.sessionId, accountId, now / 1000 + 86400 * 90),
      accounts.prepare("INSERT INTO devices VALUES(?,?,0,NULL)").bind(accountId, `device-${accountId}`),
    ]);
    await activity.prepare("INSERT INTO tenant_fences VALUES(?,1,'active')").bind(accountId).run();
    const { cookie } = await (await send("/test/cookie", { sub: accountId, sid: principal.sessionId })).json();
    return { principal, cookie };
  };
  const owner = await seed();
  return {
    runtime, accounts, activity, bucket, send, seed, owner,
    erase: (generation = 1, cookie = owner.cookie) => send("/api/activity/deletion", {
      generation, confirmation: "DELETE",
    }, { cookie, origin }),
    status: (cookie = owner.cookie) => send("/api/activity/deletion", undefined, { cookie }, "GET"),
    reconcile: async (options = {}, accountId = "account-a") => {
      const response = await send("/test/reconcile", { target: { accountId, generation: 1 }, options });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    },
    publish: value => send(`/v1/private-skills/${skillId}/versions`, {
      base: null, acknowledgePrivateUpload: true, package: value,
    }, { "x-skillar-principal": JSON.stringify(owner.principal) }),
  };
}
