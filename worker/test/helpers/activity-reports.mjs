import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { fixture as migrationFixture, snapshot, ref } from "./activity-migrations.mjs";
import { packet } from "./activity-content.mjs";

export { snapshot, ref, packet };
const sourceSuffix = `
import { ReportFlow } from "./src/activity/report-flow.ts";
import { sweepReports } from "./src/activity/report-objects.ts";
import { dispatchPendingReports } from "./src/activity/report-api.ts";
fixtureActions.sweepReports=(env)=>sweepReports(env);
fixtureActions.dispatchReports=(env)=>dispatchPendingReports(env);
fixtureActions.setClock=(_env,_principal,input)=>{
  Date.now=()=>input.now;
  return {now:Date.now()};
};
let dispatchAvailable=true;
fixtureActions.dispatchAvailable=(_env,_principal,input)=>{
  dispatchAvailable=input.available;
  return {available:dispatchAvailable};
};
fixtureActions.environment=(env)=>{
  if(!dispatchAvailable)env.REPORT_FLOW=new Proxy(env.REPORT_FLOW,{
    get(target,key){
      if(key==="create")return async()=>{throw new Error("fixture_dispatch_unavailable");};
      const value=Reflect.get(target,key,target);
      return typeof value==="function"?value.bind(target):value;
    },
  });
};
export class TestReportFlow extends ReportFlow {
  async run(event,step) {
    const notify=async(path,value)=>fetch(this.env.TEST_REPORT_URL+path,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
    await notify("/started",{jobId:event.payload.jobId});
    if(this.env.TEST_REPORT_PARTS==="true") {
      const bucket=this.env.ACTIVITY_RAW;
      this.env.ACTIVITY_RAW=new Proxy(bucket,{get(target,key){
        const value=Reflect.get(target,key,target);
        if(key==="put")return async(...args)=>{
          const stored=await value.apply(target,args);
          await notify("/part",{jobId:event.payload.jobId});
          return stored;
        };
        return typeof value==="function"?value.bind(target):value;
      }});
    }
    try {
      const result=await super.run(event,step);
      await notify("/finished",result);
      return result;
    } catch(error) {
      await notify("/finished",{jobId:event.payload.jobId,state:"errored"});
      throw error;
    }
  }
}
`;
export async function fixture(t, options = {}) {
  const events = new EventEmitter(), hooks = new Map(), partHooks = new Map();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks));
    if (request.url === "/started") await hooks.get(value.jobId)?.();
    if (request.url === "/part") await partHooks.get(value.jobId)?.();
    events.emit(`${request.url}:${value.jobId}`, value);
    response.end("ok");
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const f = await migrationFixture(t, {
    sourceSuffix, migrations: ["0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql"],
    env: {
      CONTENT_KEYRING: { type: "text", value: JSON.stringify({
        current: 1, keys: { 1: Buffer.alloc(32, 7).toString("base64url") },
      }) },
      TEST_REPORT_URL: { type: "text", value: `http://127.0.0.1:${server.address().port}` },
      TEST_REPORT_PARTS: { type: "text", value: options.observeParts ? "true" : "false" },
      REPORT_FLOW: {
        type: "workflow", name: "report-flow-fixture",
        worker: "activity-migrations-fixture", exportName: "TestReportFlow",
      },
    },
  });
  const api = async (path, input, who) => {
    const response = await f.api(path, input, who);
    return { status: response.status, body: await response.json() };
  };
  return {
    ...f, api,
    onStart(jobId, callback) { hooks.set(jobId, callback); },
    onPart(jobId, callback) { partHooks.set(jobId, callback); },
    finished(jobId) {
      return once(events, `/finished:${jobId}`, { signal: AbortSignal.timeout(30000) }).then(([value]) => value);
    },
  };
}
export async function ingest(f, begin, rows, { from = begin.cut, through = begin.cut + 1, sequence = 1 } = {}) {
  const p = await packet({ schemaVersion: 2, rows }, { from, through, sequence, batchId: randomUUID() });
  const scope = { deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
    generation: begin.generation, consentVersion: begin.consentVersion,
    projectId: begin.projectId, rootId: begin.rootId, range: begin.range, backfill: begin.backfill };
  for (const upload of p.uploads) assert.equal((await f.api("/v1/activity/chunks", { ...upload, ...scope })).status, 201);
  const accepted = await f.api("/v1/activity/batches", { ...p.batch, ...scope });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted.body;
}
export async function publish(f, documents, options = {}) {
  const cut = options.cut ?? 1, snapshotId = options.snapshotId ?? randomUUID();
  const migration = await snapshot(f, documents, {
    ...options, cut, snapshotId, projectId: "device:device-a",
    range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 },
  });
  await f.consent(migration.begin, { scope: {
    deviceId: "device-a", projectIds: ["device:device-a"], rootIds: [],
  } });
  assert.equal((await f.send("begin", migration.begin)).status, 200);
  for (let page = 0; page < documents.length; page++) assert.equal((await migration.stage(page)).status, 200);
  assert.equal((await f.send("complete", ref(migration.begin))).status, 200);
  return migration.begin;
}
export async function runtime(f, begin, context, sequence = 1) {
  const now = context.capturedAtMs ?? Date.now();
  const value = { schemaVersion: 1, capturedAtMs: now, activeRequests: [], tz: "UTC",
    ingest: { accepted: 0, rejected: 0, dropped: 0 }, ...context };
  const document = Buffer.from(JSON.stringify(value)), hash = createHash("sha256").update(document).digest("hex");
  const batchId = randomUUID(), scope = {
    deviceId: begin.deviceId, sourceDomain: begin.sourceDomain, generation: begin.generation,
    consentVersion: begin.consentVersion, projectId: begin.projectId, rootId: null,
    range: { fromMs: 1000, toMs: 8_640_000_000_000_000 }, backfill: null,
  };
  const upload = { schemaVersion: 2, ...scope, batchId, index: 0, revision: begin.cut,
    plaintextHash: hash, bytes: document.length, body: document.toString("base64") };
  assert.equal((await f.api("/v1/activity/chunks", upload)).status, 201);
  const committed = await f.api("/v1/activity/context", {
    schemaVersion: 1, ...scope, batchId, sequence, sourceCut: begin.cut,
    capturedAtMs: now, chunks: [{ index: 0, revision: begin.cut, plaintextHash: hash, bytes: document.length }],
    contentHash: hash, totalBytes: document.length,
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  return value;
}
export function query(begin, selection, changes = {}) {
  return {
    schemaVersion: 1, requestId: randomUUID(), deviceId: begin.deviceId, sourceDomain: begin.sourceDomain,
    generation: begin.generation, consentVersion: begin.consentVersion, projectId: begin.projectId,
    rootId: null, range: begin.range, backfill: begin.backfill, tz: "UTC", query: selection, ...changes,
  };
}
export async function result(f, request) {
  const reference = { deviceId: request.deviceId, sourceDomain: request.sourceDomain,
    generation: request.generation, jobId: request.requestId };
  const status = await f.api("/v1/activity/reports/status", reference);
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.state, "complete", JSON.stringify(status.body));
  const parts = [];
  for (let part = 0; part < status.body.result.parts; part++) {
    const reply = await f.api("/v1/activity/reports/result", { ...reference, part });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const bytes = Buffer.from(reply.body.body, "base64");
    assert.equal(bytes.length, reply.body.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), reply.body.hash);
    parts.push(bytes);
  }
  const bytes = Buffer.concat(parts);
  assert.equal(bytes.length, status.body.result.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), status.body.result.hash);
  return { status: status.body, value: JSON.parse(bytes), bytes };
}
