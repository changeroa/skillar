import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixtureText, bearer, http, jsonHeaders, startTestServer } from "./helpers/api.mjs";
import { distImport } from "./_helpers.mjs";
import { DAY, NOW, event, openStore, skillEntry, uri } from "./helpers/store.mjs";

const get = (server, path) => http(server.port, { path, headers: bearer(server.token) });
const send = (server, method, path, body) => http(server.port, {
  method, path, headers: jsonHeaders(server.token), body: JSON.stringify(body),
});

async function deleteHistory(server, body) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/history`, {
    method: "DELETE", headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) };
}

function subscribe(server) {
  return new Promise((resolve, reject) => {
    let connected = false;
    const req = request({ host: "127.0.0.1", port: server.port, path: "/api/events/stream",
      headers: { Host: `127.0.0.1:${server.port}`, ...bearer(server.token) } }, (res) => {
      let buffer = "";
      let closed = false;
      const waiters = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith(": connected")) {
            connected = true;
            resolve({
              next(timeoutMs = 2_000) {
                return new Promise((ok, fail) => {
                  const timer = setTimeout(() => fail(new Error(`no SSE event within ${timeoutMs} ms`)), timeoutMs);
                  waiters.push((value) => { clearTimeout(timer); ok(value); });
                });
              },
              close: () => new Promise((done) => {
                if (closed || res.destroyed) return done();
                closed = true;
                res.once("close", done);
                req.destroy();
              }),
            });
          }
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (event && data) waiters.shift()?.({ event, data: JSON.parse(data) });
        }
      });
      assert.equal(res.statusCode, 200);
    });
    req.on("error", (error) => { if (!connected) reject(error); });
    req.end();
  });
}

function oldPrompt(text) {
  const body = JSON.parse(fixtureText("claude-otlp-user-prompt.json"));
  const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
  for (const attr of attrs) {
    if (attr.key === "session.id") attr.value.stringValue = "privacy-full-session";
    if (attr.key === "prompt.id") attr.value.stringValue = "privacy-full-prompt";
    if (attr.key === "prompt") attr.value.stringValue = text;
    if (attr.key === "prompt_length") attr.value.intValue = String(text.length);
  }
  return body;
}

test("privacy API applies capture and retention changes live, requires confirmations, and preserves its config", async () => {
  const server = await startTestServer();
  const stream = await subscribe(server);
  try {
    const firstEvent = stream.next();
    assert.equal((await send(server, "POST", "/ingest/otlp/v1/logs", oldPrompt("full text that retention must remove"))).status, 202);
    const first = await firstEvent;
    assert.equal(first.event, "session");
    const fullSession = first.data.id;
    const fullTrace = await get(server, `/api/sessions/${encodeURIComponent(fullSession)}/trace`);
    assert.equal(fullTrace.status, 200);
    assert.equal(fullTrace.json.find((step) => step.kind === "prompt").detail.text, "full text that retention must remove");

    const metadata = await send(server, "PUT", "/api/privacy", { captureLevel: "metadata", retentionDays: null });
    assert.deepEqual(metadata.json, { captureLevel: "metadata", retentionDays: null });
    const config = JSON.parse(readFileSync(join(server.skillarHome, "config.json"), "utf8"));
    assert.deepEqual(config.roots, [{ id: "agents", path: join(server.home, "skills") }]);
    assert.deepEqual(config.runtimes, {});

    const metadataEvent = stream.next();
    assert.equal((await send(server, "POST", "/ingest/hook/claude-code", {
      hook_event_name: "UserPromptSubmit", session_id: "privacy-metadata-session", prompt_id: "privacy-metadata-prompt", prompt: "metadata must not retain this text",
    })).status, 202);
    const second = await metadataEvent;
    const metadataTrace = await get(server, `/api/sessions/${encodeURIComponent(second.data.id)}/trace`);
    const metadataPrompt = metadataTrace.json.find((step) => step.kind === "prompt");
    assert.equal(metadataPrompt.detail.text, undefined);
    assert.equal(metadataPrompt.detail.textLength, "metadata must not retain this text".length);
    await stream.close();

    const retained = await send(server, "PUT", "/api/privacy", { captureLevel: "metadata", retentionDays: 1 });
    assert.deepEqual(retained.json, { captureLevel: "metadata", retentionDays: 1 });
    const expiredTrace = await get(server, `/api/sessions/${encodeURIComponent(fullSession)}/trace`);
    assert.equal(expiredTrace.json.find((step) => step.kind === "prompt").detail.text, undefined, "the live retention update expired old full text");

    const unconfirmed = await send(server, "PUT", "/api/privacy", { captureLevel: "full", retentionDays: 1 });
    assert.equal(unconfirmed.status, 400);
    assert.equal((await get(server, "/api/privacy")).json.captureLevel, "metadata");
    const confirmed = await send(server, "PUT", "/api/privacy", { captureLevel: "full", retentionDays: 1, confirmFullCapture: true });
    assert.deepEqual(confirmed.json, { captureLevel: "full", retentionDays: 1 });

    assert.deepEqual((await get(server, "/api/privacy")).json, { captureLevel: "full", retentionDays: 1 });
  } finally {
    await stream.close();
    await server.stop();
  }
});

test("history API requires an exact confirmation token before deletion", async () => {
  const server = await startTestServer();
  try {
    const missingConfirmation = await deleteHistory(server, {});
    assert.equal(missingConfirmation.status, 400);
    const deleted = await deleteHistory(server, { confirm: "DELETE_HISTORY" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.json.deleted, {
      sessions: 0, events: 0, loads: 0, spans: 0, links: 0, workspaces: 0, tabs: 0, panes: 0,
      flows: 0, flowSteps: 0, reconciliationCandidates: 0, ingestTelemetry: 0,
    });
  } finally {
    await server.stop();
  }
});

test("history API refuses queued cloud history instead of reporting a local deletion as complete", async () => {
  const server = await startTestServer();
  const { openDb } = await distImport("store/db.js");
  const db = openDb(join(server.skillarHome, "skillar.db"));
  try {
    const secret = "queued API privacy secret";
    const payload = JSON.stringify({ secret });
    db.prepare(`INSERT INTO sync_streams(stream_id, source_domain, device_id, next_sequence, ack_sequence, ack_cut)
      VALUES ('privacy-api-pending', 'privacy-api-domain', 'privacy-api-device', 2, 0, 0)`).run();
    db.prepare(`INSERT INTO sync_outbox
      (stream_id, sequence, batch_id, payload, payload_hash, payload_bytes, journal_from, journal_through)
      VALUES ('privacy-api-pending', 1, 'privacy-api-pending-batch', ?, ?, ?, 0, 0)`)
      .run(payload, "b".repeat(64), Buffer.byteLength(payload));

    const rejected = await deleteHistory(server, { confirm: "DELETE_HISTORY" });

    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error, "history_sync_pending");
    assert.match(rejected.json.message, /cloud sync batch/);
    assert.match(db.prepare("SELECT payload FROM sync_outbox").get().payload, new RegExp(secret));
  } finally {
    db.close();
    await server.stop();
  }
});

test("history API refuses a cloud-bound source even after its local queue is empty", async () => {
  const server = await startTestServer();
  const { openDb } = await distImport("store/db.js");
  const db = openDb(join(server.skillarHome, "skillar.db"));
  try {
    db.prepare("INSERT INTO meta(key, value) VALUES ('cloud.binding', 'bound-instance')").run();

    const rejected = await deleteHistory(server, { confirm: "DELETE_HISTORY" });

    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error, "history_remote_history");
    assert.match(rejected.json.message, /bound to cloud history/);
  } finally {
    db.close();
    await server.stop();
  }
});

test("history API refuses a disconnected P6 spool that can retain full captured text", async () => {
  const server = await startTestServer();
  const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
  const spoolPath = join(server.skillarHome, "cloud", "spool.sqlite");
  const blobs = new CloudBlobs(spoolPath);
  blobs.close();
  const spool = new DatabaseSync(spoolPath);
  try {
    const secret = "queued P6 privacy secret";
    const payload = JSON.stringify({ secret });
    spool.prepare(`INSERT INTO sync_streams(stream_id, source_domain, device_id, next_sequence, ack_sequence, ack_cut)
      VALUES ('privacy-p6-pending', 'privacy-p6-domain', 'privacy-p6-device', 2, 0, 0)`).run();
    spool.prepare(`INSERT INTO sync_outbox
      (stream_id, sequence, batch_id, payload, payload_hash, payload_bytes, journal_from, journal_through)
      VALUES ('privacy-p6-pending', 1, 'privacy-p6-pending-batch', ?, ?, ?, 0, 0)`)
      .run(payload, "c".repeat(64), Buffer.byteLength(payload));

    const rejected = await deleteHistory(server, { confirm: "DELETE_HISTORY" });

    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error, "history_sync_pending");
    assert.match(rejected.json.message, /disconnected cloud spool/);
    assert.match(spool.prepare("SELECT payload FROM sync_outbox").get().payload, new RegExp(secret));
  } finally {
    spool.close();
    await server.stop();
  }
});

test("history API removes disconnected orphaned cloud spool and snapshot files with local history", async () => {
  const server = await startTestServer();
  const { CloudBlobs } = await distImport("sync/cloud-blobs.js");
  const cloud = join(server.skillarHome, "cloud");
  const spool = join(cloud, "spool.sqlite");
  const prepared = join(cloud, "prepared", "orphan.sqlite");
  const blobs = new CloudBlobs(spool);
  blobs.close();
  mkdirSync(join(cloud, "prepared"), { recursive: true, mode: 0o700 });
  writeFileSync(prepared, "orphaned full-text privacy secret", { mode: 0o600 });
  try {
    const deleted = await deleteHistory(server, { confirm: "DELETE_HISTORY" });

    assert.equal(deleted.status, 200);
    assert.equal(existsSync(spool), false);
    assert.equal(existsSync(prepared), false);
  } finally {
    await server.stop();
  }
});

function seedHistory(store, db) {
  const ref = { runtime: "claude-code", runtimeSessionId: "delete-history" };
  const session = store.upsertSession(ref, NOW - DAY);
  const attr = { sessionId: session, method: "runtime_id" };
  const prompt = event("prompt", NOW - DAY, ref, { text: "delete me" });
  const load = event("load", NOW - DAY + 1, ref, { source: "mcp", skillUri: uri("kept-skill"), data: { attributionCandidates: [session] } });
  store.append(prompt, attr);
  store.append(load, attr);
  db.prepare("INSERT INTO load_candidates(load_id, session_id, ts) VALUES (?, ?, ?)").run(load.id, session, NOW - DAY + 1);
  store.putLoad({ loadId: load.id, uri: uri("kept-skill"), manifestDigest: "sha256:load", resources: [] });
  store.putSpans([{ traceId: "delete-trace", spanId: "delete-span", name: "tool", runtime: "claude-code", receivedAt: NOW }]);
  store.upsertSkills([skillEntry("kept-skill")]);
  store.addEvalCase({ query: "curated eval", expectedUri: uri("kept-skill") });
  store.countIngest("accepted");
  store.countIngest("rejected", "bad_json");
  db.prepare("INSERT INTO meta(key, value) VALUES ('aliases_overrides', '{}')").run();
  db.prepare("INSERT INTO herdr_workspaces(id, label, created_ms) VALUES ('workspace', 'history', ?)").run(NOW);
  db.prepare("INSERT INTO herdr_tabs(id, workspace_id, created_ms) VALUES ('tab', 'workspace', ?)").run(NOW);
  db.prepare("INSERT INTO herdr_panes(id, workspace_id, tab_id, created_ms) VALUES ('pane', 'workspace', 'tab', ?)").run(NOW);
  db.prepare("INSERT INTO pane_sessions(pane_id, agent_session_value, session_id) VALUES ('pane', 'delete-history', ?)").run(session);
  db.prepare("INSERT INTO workflow_specs(id, name, version, body_json, digest, created_ms) VALUES ('spec', 'curated', 1, '{\"name\":\"curated\",\"steps\":[]}', 'digest', ?)").run(NOW);
  db.prepare("INSERT INTO flows(id, workspace_id, spec_id, registered_ms) VALUES ('flow', 'workspace', 'spec', ?)").run(NOW);
  db.prepare("INSERT INTO flow_steps(flow_id, pane_id, step_id, registered_ms) VALUES ('flow', 'pane', 'step', ?)").run(NOW);
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

test("history deletion transactionally removes only recorded activity and retains curated data", () => {
  const { db, store } = openStore();
  try {
    seedHistory(store, db);
    const clock = { ...db.prepare("SELECT * FROM recording_clock").get() };
    assert.deepEqual(store.deleteHistory(), {
      sessions: 1, events: 2, loads: 1, spans: 1, links: 1, workspaces: 1, tabs: 1, panes: 1,
      flows: 1, flowSteps: 1, reconciliationCandidates: 1, ingestTelemetry: 3,
    });
    for (const table of ["sessions", "events", "loads", "otel_spans", "pane_sessions", "herdr_workspaces", "herdr_tabs", "herdr_panes", "flows", "flow_steps", "load_candidates"]) {
      assert.equal(count(db, table), 0, table);
    }
    assert.equal(count(db, "skills"), 1);
    assert.equal(count(db, "eval_cases"), 1);
    assert.equal(count(db, "workflow_specs"), 1);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'aliases_overrides'").get().value, "{}");
    assert.deepEqual({ ...db.prepare("SELECT * FROM recording_clock").get() }, clock);
  } finally {
    store.close();
  }
});

test("history deletion rolls back every table when one deletion fails", () => {
  const { db, store } = openStore();
  try {
    seedHistory(store, db);
    db.exec("CREATE TRIGGER block_history_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    assert.throws(() => store.deleteHistory(), /blocked/);
    assert.equal(count(db, "events"), 2);
    assert.equal(count(db, "sessions"), 1);
    assert.equal(count(db, "loads"), 1);
    assert.equal(count(db, "pane_sessions"), 1);
    assert.equal(count(db, "flows"), 1);
  } finally {
    store.close();
  }
});

test("history deletion refuses when a queued sync payload can retain full captured text", () => {
  const { db, store } = openStore();
  try {
    const ref = { runtime: "claude-code", runtimeSessionId: "queued-history" };
    const session = store.upsertSession(ref, NOW - DAY);
    const secret = "queued full-text privacy secret";
    store.append(event("prompt", NOW - DAY, ref, { text: secret }), { sessionId: session, method: "runtime_id" });
    const journal = db.prepare("SELECT group_concat(COALESCE(row_json, '') || COALESCE(before_json, ''), '\n') AS body FROM sync_journal").get().body;
    assert.match(journal, new RegExp(secret));
    const through = db.prepare("SELECT MAX(seq) AS seq FROM sync_journal").get().seq;
    const payload = JSON.stringify({ secret });
    db.prepare(`INSERT INTO sync_streams(stream_id, source_domain, device_id, next_sequence, ack_sequence, ack_cut)
      VALUES ('privacy-pending', 'privacy-domain', 'privacy-device', 2, 0, 0)`).run();
    db.prepare(`INSERT INTO sync_outbox
      (stream_id, sequence, batch_id, payload, payload_hash, payload_bytes, journal_from, journal_through)
      VALUES ('privacy-pending', 1, 'privacy-pending-batch', ?, ?, ?, 0, ?)`).run(payload, "a".repeat(64), Buffer.byteLength(payload), through);

    assert.throws(() => store.deleteHistory(), (error) => error?.code === "history_sync_pending");
    assert.equal(db.prepare("SELECT text FROM events").get().text, secret);
    assert.match(db.prepare("SELECT payload FROM sync_outbox").get().payload, new RegExp(secret));
    assert.match(db.prepare("SELECT group_concat(COALESCE(row_json, '') || COALESCE(before_json, ''), '\n') AS body FROM sync_journal").get().body, new RegExp(secret));
  } finally {
    store.close();
  }
});

test("history deletion clears local raw journal images when no cloud batch exists", () => {
  const { db, store } = openStore();
  try {
    const ref = { runtime: "claude-code", runtimeSessionId: "local-history" };
    const session = store.upsertSession(ref, NOW - DAY);
    const secret = "local journal privacy secret";
    store.append(event("prompt", NOW - DAY, ref, { text: secret }), { sessionId: session, method: "runtime_id" });
    assert.match(db.prepare("SELECT group_concat(COALESCE(row_json, '') || COALESCE(before_json, ''), '\n') AS body FROM sync_journal").get().body, new RegExp(secret));

    store.deleteHistory();

    assert.equal(count(db, "events"), 0);
    assert.doesNotMatch(db.prepare("SELECT COALESCE(group_concat(COALESCE(row_json, '') || COALESCE(before_json, ''), '\n'), '') AS body FROM sync_journal").get().body, new RegExp(secret));
  } finally {
    store.close();
  }
});

test("retention clears both search-text copies while preserving ranking metadata and curated cases", () => {
  const { db, store } = openStore();
  try {
    const ref = { runtime: "codex", runtimeSessionId: "expired-search" };
    const id = store.upsertSession(ref, NOW - 100 * DAY);
    const attribution = { sessionId: id, method: "runtime_id" };
    store.append(event("search", NOW - 100 * DAY, ref, { text: "expired private query",
      data: { query: "expired private query", candidates: [], elapsedMs: 4 } }), attribution);
    store.addEvalCase({ query: "separately curated query" });
    assert.equal(store.retention(90), 1);
    const row = db.prepare("SELECT text, data_json FROM events WHERE session_id = ?").get(id);
    assert.equal(row.text, null);
    assert.deepEqual(JSON.parse(row.data_json), { query: "", candidates: [], elapsedMs: 4 });
    assert.equal(store.evalCases()[0].query, "separately curated query");
    assert.equal(store.retention(90), 0);
  } finally {
    store.close();
  }
});
