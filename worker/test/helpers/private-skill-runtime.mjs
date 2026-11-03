// SPDX-License-Identifier: AGPL-3.0-only
export const source = `
import { DurableObject } from "cloudflare:workers";
import { PrivateSkillCatalog as Catalog, privateSkillsRequest } from "./src/private-skills/index.ts";
import { admitPrivateSkill } from "./src/private-skills/rate-limit.ts";
import { dispatchAccountControls } from "./src/activity/event-controls.ts";
let hook=null, enabled="true", now=1793720000000;
Date.now=()=>now;
async function trip(env,point) {
  if(hook?.point!==point) return;
  const action=hook; hook=null;
  if(action.sql) await env.ACCOUNTS.prepare(action.sql).bind(...(action.args??[])).run();
  if(action.fail) throw new Error("fixture_storage_failure");
}
function wrapped(env) {
  const bucket=env.ACTIVITY_RAW, db=env.ACCOUNTS;
  return {...env, PRIVATE_SKILLS_ENABLED:enabled,
    ACCOUNTS:{
      prepare(sql) {
        const statement=db.prepare(sql);
        if(!sql.includes("DELETE FROM account_control_outbox WHERE control_id=?")) return statement;
        return {bind(...args) {return {async run() {
          await trip(env,"ack");return statement.bind(...args).run();
        }}}};
      },
      async batch(statements) {await trip(env,"batch");return db.batch(statements);},
    },
    ACTIVITY_RAW:{
      async get(...args) {const value=await bucket.get(...args);await trip(env,"get");return value;},
      async put(...args) {const value=await bucket.put(...args);await trip(env,"put");return value;},
      async delete(...args) {await trip(env,"delete");return bucket.delete(...args);},
    },
  };
}
export class PrivateSkillCatalog extends Catalog {
  constructor(ctx,env) {super(ctx,wrapped(env));}
}
export class RateProbe extends DurableObject {
  async fetch(request) {
    const action=await request.json();now=action.now;
    let admitted=0,status=200;
    for(let i=0;i<action.count;i++) {
      try {admitPrivateSkill(this.ctx.storage,action.principals[i%action.principals.length],action.category);admitted++;}
      catch(error) {status=error.status;break;}
    }
    return Response.json({admitted,status,alarm:await this.ctx.storage.getAlarm()});
  }
}
export default {async fetch(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(path==="/test/hook") {hook=await request.json();return Response.json({armed:true});}
  if(path==="/test/config") {
    const config=await request.json();enabled=config.enabled??enabled;now=config.now??now;
    return Response.json({enabled,now});
  }
  if(path==="/test/relay") {
    try {await dispatchAccountControls(wrapped(env));return Response.json({ok:true});}
    catch(error) {return Response.json({error:error.message},{status:503});}
  }
  if(path==="/test/limits") return env.RATE.get(env.RATE.idFromName("rate")).fetch(request);
  const internal=new Request((request.headers.get("x-test-origin")??"https://activity.internal")+
    path+url.search,request);
  if(request.headers.has("x-test-actor")) {
    return env.PRIVATE_SKILL_CATALOG.get(env.PRIVATE_SKILL_CATALOG.idFromName(
      request.headers.get("x-test-actor"))).fetch(internal);
  }
  return await privateSkillsRequest(internal,wrapped(env))??new Response(null,{status:418});
}};
`;
