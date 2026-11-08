import { fixture as migrationFixture } from "./activity-migrations.mjs";
import { principal } from "./activity-content.mjs";

export const browser = (changes = {}) => ({
  ...principal(), kind: "browser", deviceId: null, sessionId: "s".repeat(32),
  scopes: ["activity:read", "device:manage"], ...changes,
});
const sourceSuffix = `
import { sweepDashboardEvalCases } from "./src/activity/dashboard-eval-cleanup.ts";
import { readContentKey } from "./src/activity/content-keys.ts";
import { decryptContent } from "./src/activity/crypto.ts";
let failEvalPut=false,lateEvalPut,fenceEvalPut;
fixtureActions.evalSweep=(env,_principal,input)=>sweepDashboardEvalCases(env,input.now);
fixtureActions.evalArm=()=>{failEvalPut=true;return {armed:true};};
fixtureActions.evalFencePut=(_env,_principal,input)=>{fenceEvalPut=input.target;return {armed:true};};
fixtureActions.evalRelease=async(env)=>{
  await env.ACTIVITY_RAW.put(...lateEvalPut);
  return {released:true};
};
fixtureActions.environment=(env)=>{
  if(!failEvalPut&&!fenceEvalPut)return;
  const bucket=env.ACTIVITY_RAW;
  env.ACTIVITY_RAW=new Proxy(bucket,{get(target,key){
    if(key==="put")return async(...args)=>{
      if(failEvalPut){
        failEvalPut=false;lateEvalPut=args;throw new Error("fixture_late_eval_put");
      }
      const fence=fenceEvalPut;fenceEvalPut=null;
      if(fence==="generation")await env.ACTIVITY.prepare("UPDATE tenant_fences SET state='closed'").run();
      if(fence==="device")await env.ACCOUNTS.prepare("UPDATE devices SET revoked_at=1").run();
      if(fence==="consent")await env.ACCOUNTS.prepare("DELETE FROM device_consents").run();
      return target.put(...args);
    };
    const value=Reflect.get(target,key,target);
    return typeof value==="function"?value.bind(target):value;
  }});
};
fixtureActions.evalDecrypt=async(env,principal,input)=>{
  const key=await readContentKey(env.ACTIVITY,principal,env.CONTENT_KEYRING,input.key_version);
  const object=await env.ACTIVITY_RAW.get(input.object_key);
  const bytes=await decryptContent(key,{accountId:principal.accountId,generation:principal.generation,
    objectKey:input.object_key,revision:0,schemaVersion:1},await object.json());
  return {body:new TextDecoder().decode(bytes)};
};
`;
export async function fixture(t) {
  const f = await migrationFixture(t, {
    sourceSuffix, migrations: ["0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql"],
  });
  await f.accounts.prepare("INSERT INTO sessions VALUES (?,'account-a',?)")
    .bind(browser().sessionId, Math.floor(Date.now() / 1000) + 3600).run();
  await f.consent({ backfill: { version: 1, snapshotId: "snapshot-1", journalCut: 0 },
    range: { fromMs: 0, toMs: 1000 } }, {
    scope: { deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [] },
  });
  return {
    ...f,
    api: async (path, input = {}, who = principal({ scopes: ["activity:read"] })) => {
      const response = await f.api(path, input, who);
      return { status: response.status, body: await response.json() };
    },
  };
}
