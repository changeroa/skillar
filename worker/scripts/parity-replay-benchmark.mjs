#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { fixture } from "../test/helpers/activity-migrations.mjs";
import { packet, principal, kinds } from "../test/helpers/activity-content.mjs";
import { publish, runtime as captureRuntime, query, result } from "../test/helpers/activity-reports.mjs";

// Observe native calls without replacing their execution or inventing SQL counts.
const sourceSuffix = `
import { ReportFlow } from "./src/activity/report-flow.ts";
import { reportInstanceId } from "./src/activity/report-runner.ts";
let metrics;
function resetMetrics() {
  metrics={d1:{},r2:{attempted:{},succeeded:{}}};
}
resetMetrics();
function measuredDb(db,name) {
  const count=()=>metrics.d1[name]??=( {
    statements:0,metadataResults:0,withoutMetadata:0,
    observedRowsRead:0,observedRowsWritten:0,missingRowsRead:0,missingRowsWritten:0
  });
  const observe=result=>{
    const m=count();m.statements++;
    if(result?.meta) {
      m.metadataResults++;
      for(const [field,total,missing] of [
        ["rows_read","observedRowsRead","missingRowsRead"],
        ["rows_written","observedRowsWritten","missingRowsWritten"]]) {
        if(Number.isFinite(result.meta[field]))m[total]+=result.meta[field];
        else m[missing]++;
      }
    } else m.withoutMetadata++;
    return result;
  };
  const unwrap=new WeakMap();
  const statement=raw=>{
    const wrapped=new Proxy(raw,{get(target,key) {
      if(key==="bind")return (...args)=>statement(target.bind(...args));
      const value=Reflect.get(target,key,target);
      if(["all","run","first","raw"].includes(key))
        return async(...args)=>observe(await value.apply(target,args));
      return typeof value==="function"?value.bind(target):value;
    }});
    unwrap.set(wrapped,raw);
    return wrapped;
  };
  return new Proxy(db,{get(target,key) {
    if(key==="prepare")return sql=>statement(target.prepare(sql));
    if(key==="batch")return async statements=>{
      const results=await target.batch(statements.map(s=>unwrap.get(s)??s));
      results.forEach(observe);return results;
    };
    const value=Reflect.get(target,key,target);
    return typeof value==="function"?value.bind(target):value;
  }});
}
function instrument(env) {
  const bucket=env.ACTIVITY_RAW;
  return {...env,ACTIVITY:measuredDb(env.ACTIVITY,"ACTIVITY"),
    ACCOUNTS:measuredDb(env.ACCOUNTS,"ACCOUNTS"),
    ACTIVITY_RAW:new Proxy(bucket,{get(target,key) {
      const value=Reflect.get(target,key,target);
      if(["put","get","head","list","delete"].includes(key))return async(...args)=>{
        metrics.r2.attempted[key]=(metrics.r2.attempted[key]??0)+1;
        const result=await value.apply(target,args);
        metrics.r2.succeeded[key]=(metrics.r2.succeeded[key]??0)+1;
        return result;
      };
      return typeof value==="function"?value.bind(target):value;
    }})};
}
fixtureActions.environment=env=>Object.assign(env,instrument(env));
fixtureActions.benchmarkReset=()=>{resetMetrics();return {reset:true};};
fixtureActions.benchmarkMetrics=()=>metrics;
fixtureActions.benchmarkWorkflow=async(env,principal,input)=>{
  const id=await reportInstanceId({...input,accountId:principal.accountId});
  return (await env.REPORT_FLOW.get(id)).status();
};
export class BenchmarkReportFlow extends ReportFlow {
  async run(event,step) {
    const callback=this.env.BENCHMARK_CALLBACK;
    let completion;
    try {
      const noRetryStep={do:(name,options,callback)=>step.do(name,{
        ...options,retries:{limit:0,delay:"0 seconds"}
      },callback)};
      // Do not mutate the shared native env and wrap it again for later accounts.
      completion=await super.run.call({env:instrument(this.env)},event,noRetryStep);
      return completion;
    }
    catch(error) {
      completion={state:"errored",error:error.message};
      throw error;
    }
    finally {
      const response=await fetch(callback,{
        method:"POST",body:JSON.stringify({
          jobId:event.payload.jobId,...completion
        })});
      if(!response.ok)throw new Error("benchmark_callback_failed");
    }
  }
}
`;

function accountCounts(args) {
  if (args.length === 0) return [10, 100, 1000];
  if (args.length !== 1 || !/^--accounts=\d+(,\d+)*$/.test(args[0])) {
    throw new Error("Usage: node scripts/parity-replay-benchmark.mjs [--accounts=1,2]");
  }
  const counts = args[0].slice("--accounts=".length).split(",").map(Number);
  if (counts.length > 10 || counts.some(n => !Number.isSafeInteger(n) || n < 1 || n > 1000)) {
    throw new Error("Select 1 to 10 scenarios, each with 1 to 1000 accounts");
  }
  return [...new Set(counts)];
}

const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const document = accountId => ({ schemaVersion: 2, rows: [{
  table: "sessions", key: '["session"]', revision: 1, operation: "upsert", sourceOrder: 1,
  values: { id: "session", runtime: "codex", runtime_session_id: "session",
    conversation_id: null, client_name: null, cwd: "/synthetic/project",
    started_at: 100, ended_at: null, first_prompt: `Synthetic prompt ${accountId}`,
    end_orders_json: "{}" },
}, {
  table: "recording_clock", key: "[1]", revision: 1, operation: "upsert", sourceOrder: 2,
  values: { singleton: 1, domain: "source", position: 1 },
}] });

async function scenario(accounts) {
  const cleanup = [], events = new EventEmitter(), runId = randomUUID();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks));
    response.end("ok");
    events.emit(value.jobId, value);
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  let output;
  const started = performance.now();
  try {
    const f = await fixture({ after(fn) { cleanup.push(fn); } }, {
      sourceSuffix,
      migrations: ["0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql"],
      env: {
        CONTENT_KEYRING: { type: "text", value: JSON.stringify({
          current: 1, keys: { 1: Buffer.alloc(32, 7).toString("base64url") },
        }) },
        BENCHMARK_CALLBACK: { type: "text", value: `http://127.0.0.1:${server.address().port}` },
        REPORT_FLOW: { type: "workflow", name: "benchmark-report",
          worker: "activity-migrations-fixture", exportName: "BenchmarkReportFlow" },
      },
    });
    const setupMs = performance.now() - started;
    const identities = Array.from({ length: accounts }, (_, index) =>
      principal({ accountId: `bench-${runId}-${index}` }));
    // Provisioning is synthetic setup, not replay usage. Never touch an owner namespace.
    for (const who of identities) {
      await f.accounts.prepare("INSERT INTO users VALUES (?,?,'','',0,0)")
        .bind(who.accountId, `${who.accountId}@example.invalid`).run();
      await f.accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)")
        .bind(who.accountId, who.accountId).run();
      await f.accounts.prepare("INSERT INTO devices VALUES (?,?,0,NULL)")
        .bind(who.accountId, who.deviceId).run();
      await f.db.prepare("INSERT INTO tenant_fences VALUES (?,1,'active')").bind(who.accountId).run();
    }
    await f.send("benchmarkReset", {});
    const requests = {}, requestTimes = [], accountTimes = [], reportTimes = [];
    const timed = async (path, action) => {
      const start = performance.now();
      const value = await action();
      requestTimes.push(performance.now() - start);
      requests[path] = (requests[path] ?? 0) + 1;
      return value;
    };
    let plaintextBytes = 0;
    const replayStart = performance.now();
    for (const who of identities) {
      const accountStart = performance.now();
      const scoped = {
        ...f,
        send: (name, input) => timed(`fixture:${name}`, () => f.send(name, input, who)),
        api: async (path, input) => timed(path, async () => {
          const reply = await f.api(path, input, who);
          return { status: reply.status, body: await reply.json() };
        }),
        consent: async begin => {
          const grant = { mode: "managed-content", version: 1, grantedAtMs: 0,
            scope: { deviceId: who.deviceId, projectIds: [begin.projectId], rootIds: [] },
            serverProcessingAcknowledged: true, contentKinds: kinds,
            backfill: { ...begin.backfill, range: begin.range } };
          await f.accounts.prepare(`INSERT INTO device_consents VALUES (?,?,1,1,?,0)
            ON CONFLICT(account_id,device_id,version)
            DO UPDATE SET consent_json=excluded.consent_json`)
            .bind(who.accountId, who.deviceId, JSON.stringify(grant))
            .run();
        },
      };
      const input = document(who.accountId);
      plaintextBytes += Buffer.byteLength(JSON.stringify(input));
      const begin = await publish(scoped, [input], { snapshotId: "snapshot", cut: 1 });
      // Same immutable CDC packet twice: native idempotence, not a fake row multiplier.
      const p = await packet({ schemaVersion: 2, rows: [{
        ...input.rows[0], revision: 2,
        values: { ...input.rows[0].values, first_prompt: `Replayed ${who.accountId}` },
      }] }, { from: 1, through: 2, batchId: "cdc", sequence: 1 });
      const scope = { projectId: begin.projectId, range: begin.range, backfill: begin.backfill };
      plaintextBytes += p.batch.totalBytes;
      const receipts = [];
      for (let replay = 0; replay < 2; replay++) {
        for (const upload of p.uploads) {
          const accepted = await scoped.api("/v1/activity/chunks", { ...upload, ...scope });
          assert.equal(accepted.status, 201, JSON.stringify(accepted));
        }
        const accepted = await scoped.api("/v1/activity/batches", { ...p.batch, ...scope });
        assert.equal(accepted.status, 200, JSON.stringify(accepted));
        receipts.push(accepted.body);
      }
      assert.deepEqual(receipts[1], receipts[0]);
      await captureRuntime(scoped, { ...begin, cut: 2 }, { capturedAtMs: 1000, activeRequests: [],
        ingest: { accepted: 1, rejected: 0, dropped: 0 } });
      const request = query(begin, { kind: "sessions", filter: { automated: "include" } },
        { requestId: "00000000-0000-4000-8000-000000000001" });
      // One account at a time, so the same source/job IDs deliberately collide across tenants.
      const finished = once(events, request.requestId, { signal: AbortSignal.timeout(30000) });
      const reportStart = performance.now();
      const acceptedReport = await scoped.api("/v1/activity/query", request);
      assert.equal(acceptedReport.status, 202, JSON.stringify(acceptedReport));
      let completion;
      try { completion = (await finished)[0]; }
      catch {
        const status = await f.send("benchmarkWorkflow", {
          deviceId: begin.deviceId, generation: begin.generation,
          sourceDomain: begin.sourceDomain, jobId: request.requestId,
        }, who);
        throw new Error(`Workflow completion unavailable: ${JSON.stringify(status)}`);
      }
      assert.equal(completion.state, "complete", JSON.stringify(completion));
      const report = await result(scoped, request);
      assert.equal(report.value.payload.length, 1);
      assert.equal(report.value.payload[0].firstPrompt, `Replayed ${who.accountId}`);
      assert.equal(report.value.coverage.complete, true);
      reportTimes.push(performance.now() - reportStart);
      accountTimes.push(performance.now() - accountStart);
    }
    const replayWallMs = performance.now() - replayStart;
    const metricsReply = await f.send("benchmarkMetrics", {});
    assert.equal(metricsReply.status, 200);
    const metrics = metricsReply.body;
    for (const value of Object.values(metrics.d1)) {
      value.rowsRead = value.withoutMetadata + value.missingRowsRead === 0 ? value.observedRowsRead : null;
      value.rowsWritten = value.withoutMetadata + value.missingRowsWritten === 0 ? value.observedRowsWritten : null;
    }
    const ops = metrics.r2.attempted;
    // Inventory diagnostics are excluded from workload operation counters.
    let cursor, storedBytes = 0, objects = 0;
    do {
      const page = await f.bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const object of page.objects) { storedBytes += object.size; objects++; }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const receipts = await f.rows("SELECT count(*) AS n FROM ingest_receipts WHERE batch_id='cdc'");
    assert.equal(receipts[0].n, accounts);
    output = { accounts, runId, emulatorMetrics: true,
      workload: "managed-content snapshot + runtime + CDC twice + native sessions ReportFlow",
      concurrency: 1, requests, requestCount: Object.values(requests).reduce((a, b) => a + b, 0),
      timingMs: { setup: setupMs, replayWall: replayWallMs, requestP95: percentile(requestTimes),
        accountP95: percentile(accountTimes), reportEndToEndP95: percentile(reportTimes) },
      d1: metrics.d1,
      r2: { ...metrics.r2, classAOperationAttempts: (ops.put ?? 0) + (ops.list ?? 0),
        classBOperationAttempts: (ops.get ?? 0) + (ops.head ?? 0), storedBytes, objects },
      uniqueDocumentPlaintextBytes: plaintextBytes,
      billing: { workerCpuMs: null, billableRequests: null, d1StorageBytes: null,
        workflowSteps: null, workflowStateBytes: null, monthlyCost: null },
      assertions: { duplicateReceipts: true, accountScopedReportContent: true,
        completeNativeReport: true, receiptCount: receipts[0].n } };
  } finally {
    try {
      for (const dispose of cleanup.reverse()) await dispose();
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  return { ...output, disposed: true };
}

try {
  const counts = accountCounts(process.argv.slice(2));
  const scenarios = [];
  for (const count of counts) scenarios.push(await scenario(count));
  console.log(JSON.stringify({ schemaVersion: 1, scenarios,
    measurement: "Native Miniflare emulator; wall time is NOT billable Worker CPU",
    conditionalCostRisk: "D1 hidden/missing metadata, production CPU, storage, workflows, retries, maintenance, backups and other shared-account usage remain unmeasured; no invoice or allowance claim." }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
