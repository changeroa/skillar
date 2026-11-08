import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { onRequest } from "../../site/functions/api/[[path]].ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";
import { fixture, publish, runtime } from "../../worker/test/helpers/activity-reports.mjs";
import { seedParity, snapshot, reportReader, NOW } from "./helpers/activity-facts.mjs";

const bundle = await build({
  entryPoints: [new URL("../dashboard/cloud.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
const { createCloudApi } = await import(`data:text/javascript;base64,${
  Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const origin = "https://skillar.sh";
const json = value => JSON.parse(JSON.stringify(value));

test("browser cloud adapter crosses real Google-session Pages and Worker routes for every dashboard view", {
  timeout: 180000,
}, async t => {
  t.mock.method(Date, "now", () => NOW);
  const local = seedParity(t);
  local.session("dst-before-gap", Date.parse("2026-03-08T06:30:00Z"), "Before the DST gap");
  local.session("dst-after-gap", Date.parse("2026-03-08T07:30:00Z"), "After the DST gap");
  local.add("dst-before-gap", "prompt", Date.parse("2026-03-08T06:30:00Z"), { text: "Before the DST gap" });
  local.add("dst-after-gap", "prompt", Date.parse("2026-03-08T07:30:00Z"), { text: "After the DST gap" });
  const rows = snapshot(local.db), captured = local.runtime();
  const remote = await fixture(t);
  assert.equal((await remote.send("setClock", { now: NOW })).status, 200);
  const documents = [];
  for (let start = 0; start < rows.length; start += 100) {
    documents.push({ schemaVersion: 2, rows: rows.slice(start, start + 100) });
  }
  const clock = rows.find(row => row.table === "recording_clock").values;
  const begin = await publish(remote, documents, { cut: clock.position, sourceDomain: clock.domain });
  await runtime(remote, begin, captured);
  const sid = "browser-fixture-session-".padEnd(43, "s");
  const now = Math.floor(Date.now() / 1000);
  await remote.accounts.prepare("INSERT INTO sessions VALUES (?,'account-a',?)").bind(sid, now + 3600).run();
  const forwarded = [], reports = [];
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: origin,
    ACCOUNTS: remote.accounts, ACTIVITY_ENABLED: "true", ACTIVITY_INGEST_ENABLED: "true",
    ACTIVITY_SERVICE: { async fetch(request) {
      assert.equal(request.headers.has("cookie"), false);
      assert.equal(request.headers.has("authorization"), false);
      const path = new URL(request.url).pathname;
      const principal = JSON.parse(request.headers.get("x-skillar-principal"));
      forwarded.push({ path, principal });
      const response = await remote.api(path, await request.json(), principal);
      return Response.json(response.body, { status: response.status });
    } },
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "account-a", sid }, "session", env, now)}`;
  let completion, release;
  let sessionRevoked = false;
  const fetcher = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    if (init.method === "POST") headers.set("origin", origin);
    if (path === "/api/dashboard/query" && !sessionRevoked) {
      const body = JSON.parse(init.body);
      // Subscribe before dispatch; the adapter's scheduler awaits the exact Workflow event.
      completion = remote.finished(body.requestId);
      const gate = Promise.withResolvers();
      release = gate.resolve;
      remote.onStart(body.requestId, () => gate.promise);
    }
    return onRequest({ env, request: new Request(new URL(path, origin), { ...init, headers }) });
  };
  const profile = { deviceId: begin.deviceId, sourceDomain: begin.sourceDomain };
  const api = createCloudApi(profile, {
    fetch: fetcher, tz: captured.tz,
    wait: async () => { release(); assert.equal((await completion).state, "complete"); },
    onReport: report => reports.push(report), onUnauthorized() {},
  });
  t.after(() => api.dispose());

  // The initial migration creates a sequence-zero stream anchor, before any CDC receipt.
  assert.equal((await remote.rows("SELECT count(*) n FROM ingest_receipts"))[0].n, 0);
  assert.deepEqual((await remote.rows("SELECT sequence FROM device_streams")).map(row => row.sequence), [0]);
  const profilesResponse = await fetcher("/api/dashboard/profiles");
  assert.equal(profilesResponse.status, 200, await profilesResponse.clone().text());
  const profiles = await profilesResponse.json();
  const selected = profiles.profiles.find(row => row.deviceId === profile.deviceId &&
    row.sourceDomain === profile.sourceDomain);
  assert.equal(selected.availability, "ready");
  assert.equal(selected.sourceSequence, 0);
  assert.equal(selected.runtimeSequence, 1);
  assert.deepEqual(await api.health(), { ok: true, version: "cloud", transport: "snapshot" });

  const readReport = reportReader(local.store);
  const cases = [
    ["sessions", () => api.sessions({ automated: "include", q: "Alpha" }),
      local.store.sessions({ automated: "include", q: "Alpha" })],
    ["trace", () => api.trace(local.human), local.store.trace(local.human)],
    ["flow", () => api.flow({}, { unit: "search_requests", top: 3 }),
      local.store.flow({}, "search_requests", 3)],
    ["stats", () => api.stats({ automated: "include" }), local.store.stats({ automated: "include" })],
    ["skill-week", () => api.skillWeek({}), local.store.skillWeek({})],
    ["workspaces", () => api.flows({ automated: "include", limit: 2 }),
      readReport("/api/flows", {}, { automated: "include", limit: "2" }).body],
    ["workspace detail", () => api.flowReport("ws:w", { automated: "include", limit: 2 }),
      readReport("/api/flows/:id", { id: "ws:w" }, { automated: "include", limit: "2" }).body],
    ["session report", () => api.skillReport(local.human, { automated: "include" }),
      readReport("/api/sessions/:id/skill-report", { id: local.human }, { automated: "include" }).body],
  ];
  for (const tz of ["America/New_York", "Asia/Kolkata", "Australia/Lord_Howe"]) {
    const filter = { automated: "include" };
    cases.push([`heatmap ${tz}`, () => api.heatmap(filter, { tz, weekStart: 0, bucket: 2 }),
      local.store.heatmap(filter, tz, 0, 2)]);
  }
  for (const [label, read, expected] of cases) assert.deepEqual(await read(), json(expected), label);
  const dstFilter = { from: Date.parse("2026-03-08T00:00:00Z"), to: Date.parse("2026-03-09T00:00:00Z") };
  const dst = await api.heatmap(dstFilter, { tz: "America/New_York", weekStart: 0, bucket: 1 });
  assert.deepEqual(dst, json(local.store.heatmap(dstFilter, "America/New_York", 0, 1)));
  assert.equal(dst.cells.find(cell => cell.dow === 0 && cell.hour === 1).count, 1);
  assert.equal(dst.cells.find(cell => cell.dow === 0 && cell.hour === 2).count, 0);
  assert.equal(dst.cells.find(cell => cell.dow === 0 && cell.hour === 3).count, 1);
  assert.ok((await api.skills()).length > 0);
  const name = local.db.prepare("SELECT name FROM workflow_specs ORDER BY name LIMIT 1").get().name;
  assert.deepEqual(await api.workflowVersions(name), json(local.store.workflowSpecVersions(name).map(row => ({
    id: row.id, name: row.name, version: row.version, digest: row.digest,
    createdMs: row.createdMs, steps: row.spec.steps,
  }))));
  const cursorRow = local.store.listFlows({ automated: "include", limit: 1 })[0];
  const cursor = { orderMs: cursorRow.orderMs, id: cursorRow.id }, jobId = crypto.randomUUID();
  const acceptedPage = await fetcher("/api/dashboard/query", {
    method: "POST", body: JSON.stringify({
      profile, requestId: jobId, tz: captured.tz,
      query: { kind: "flows", automated: "include", limit: 2, cursor },
    }), headers: { "content-type": "application/json" },
  });
  assert.equal(acceptedPage.status, 202);
  release();
  assert.equal((await completion).state, "complete");
  const status = await (await fetcher("/api/dashboard/reports/status", {
    method: "POST", body: JSON.stringify({ profile, jobId }), headers: { "content-type": "application/json" },
  })).json();
  const parts = [];
  for (let part = 0; part < status.result.parts; part++) {
    const response = await fetcher("/api/dashboard/reports/result", {
      method: "POST", body: JSON.stringify({ profile, jobId, part }), headers: { "content-type": "application/json" },
    });
    assert.equal(response.status, 200);
    parts.push(Buffer.from((await response.json()).body, "base64"));
  }
  assert.deepEqual(JSON.parse(Buffer.concat(parts)).payload, readReport("/api/flows", {}, {
    automated: "include", limit: "2",
    cursor: Buffer.from(`${cursor.orderMs}:${cursor.id}`).toString("base64url"),
  }).body, "cursor pagination crosses the browser bridge without changing its cut");
  await api.addEvalCase({ query: "BROWSER_EVAL_PRIVATE_FIXTURE", fromTraceId: "chosen-trace" });
  await remote.send("setClock", { now: NOW + 60001 });
  await api.stats();
  assert.equal(reports.at(-1).stale, true);
  assert.equal(reports.at(-1).sourceCapturedAt, captured.capturedAtMs);
  await remote.send("setClock", { now: NOW });
  assert.ok(reports.some(report => report.pending));
  assert.ok(reports.some(report => report.state === "complete"));
  assert.ok(forwarded.some(call => call.path === "/v1/activity/dashboard/eval-cases"));
  for (const call of forwarded.filter(call => call.path !== "/v1/activity/dashboard/profiles")) {
    assert.equal(call.principal.accountId, "account-a");
    assert.equal(call.principal.deviceId, begin.deviceId);
    assert.deepEqual(call.principal.scopes, ["activity:read"]);
  }
  assert.deepEqual(snapshot(local.db), rows, "cloud-owned eval creation never rewrites the local source");

  // Session revocation is checked on the next browser request, not only at initial mount.
  sessionRevoked = true;
  await remote.accounts.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
  await assert.rejects(api.sessions({}), { code: "cloud_unauthorized" });
  t.diagnostic(`${cases.length + 1} browser adapter payloads matched SQLite, including DST gap, half-hour zones, cursor pagination and stale capture metadata`);
});
