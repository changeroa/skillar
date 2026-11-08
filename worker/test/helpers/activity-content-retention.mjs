import assert from "node:assert/strict";
import { fixture as migrationFixture } from "./activity-migrations.mjs";
export { packet, principal } from "./activity-content.mjs";
export { snapshot, ref } from "./activity-migrations.mjs";

const sourceSuffix = `
import { sweepSourceContent } from "./src/activity/content-retention.ts";
import { readChunkBytes } from "./src/activity/content-objects.ts";
import { exportContent } from "./src/activity/export-service.ts";
import { commitRuntime,readRuntimeContext } from "./src/activity/runtime-api.ts";
let nowMs=10000,gets=0;
Date.now=()=>nowMs;
fixtureActions.clock=(_env,_principal,input)=>{nowMs=input.nowMs;return {nowMs};};
fixtureActions.sourceSweep=(env,_principal,input)=>sweepSourceContent(env,input);
fixtureActions.gets=()=>({gets});
fixtureActions.direct=async(env,principal,input)=>{
  gets=0;
  const bucket=env.ACTIVITY_RAW;
  env.ACTIVITY_RAW={async get(key) {
    gets++;
    const object=await bucket.get(key);
    if(input.afterGet==="terminal")
      await env.ACTIVITY.prepare("UPDATE content_uploads SET state='purged' WHERE object_key=?").bind(key).run();
    if(input.afterGet==="expiry")nowMs=input.expireAtMs;
    if(input.afterGet==="shorter")
      await env.ACCOUNTS.prepare("UPDATE device_consents SET consent_json=json_set(consent_json,'$.retention.projectionDays',1)").run();
    if(input.afterGet==="fence")
      await env.ACTIVITY.prepare("UPDATE tenant_fences SET state='closed'").run();
    return object;
  }};
  return {bytes:Array.from(await readChunkBytes(env,principal,input.chunk))};
};
fixtureActions.sourceExport=(env,principal,input)=>exportContent(env,principal,input);
fixtureActions.budgetReads=async(env,principal)=>{
  const chunks=(await env.ACTIVITY.prepare("SELECT * FROM content_uploads ORDER BY chunk_index").all()).results;
  let queries=0;
  const tick=()=>{if(++queries>1000)throw new Error("fixture_d1_query_limit");};
  const meter=db=>{
    const native=new WeakMap();
    const wrap=statement=>{
      const proxy=new Proxy(statement,{get(target,name) {
        if(name==="bind")return (...args)=>wrap(target.bind(...args));
        if(["first","all","run","raw"].includes(name))return (...args)=>{tick();return target[name](...args);};
        return Reflect.get(target,name);
      }});
      native.set(proxy,statement);return proxy;
    };
    return {prepare:sql=>wrap(db.prepare(sql)),
      batch:values=>{tick();return db.batch(values.map(value=>native.get(value)));}};
  };
  const metered={...env,ACTIVITY:meter(env.ACTIVITY),ACCOUNTS:meter(env.ACCOUNTS)};
  for(const chunk of chunks)await readChunkBytes(metered,principal,chunk);
  return {chunks:chunks.length,queries};
};
fixtureActions.runtimeCommit=(env,principal,input)=>commitRuntime(env,principal,input);
fixtureActions.runtimeRead=(env,principal,input)=>readRuntimeContext(env,principal,input);
fixtureActions.failedSourceSweep=(env,_principal,input)=>sweepSourceContent({
  ...env,ACTIVITY_RAW:{delete:()=>{throw new Error("fixture_delete_failed");}},
},input);
`;
export async function fixture(t) {
  const f = await migrationFixture(t, { sourceSuffix, migrations: ["0005_runtime.sql"] });
  await f.consent({ backfill: null, range: { fromMs: 0, toMs: 1000 } }, {
    grantedAtMs: 0, backfill: undefined,
  });
  const grant = async (changes = {}, version = 1) => {
    const saved = await f.accounts.prepare("SELECT consent_json FROM device_consents WHERE version=1").first();
    const value = { ...JSON.parse(saved.consent_json), ...changes, version };
    await f.accounts.prepare(`INSERT INTO device_consents VALUES ('account-a','device-a',1,?,?,0)
      ON CONFLICT(account_id,device_id,version) DO UPDATE SET consent_json=excluded.consent_json`)
      .bind(version, JSON.stringify(value)).run();
  };
  const upload = async p => {
    for (const part of p.uploads) {
      const stored = await f.send("chunk", part);
      assert.equal(stored.status, 200, JSON.stringify(stored));
    }
    return f.send("cdc", p.batch);
  };
  return { ...f, grant, upload };
}
