// Fixture account test surface for browser QA of /dashboard/: real Pages handlers and
// real D1 SQL over an in-memory database seeded with the synthetic QA user, plus an
// ACTIVITY_SERVICE stand-in that answers from local/dashboard/dev-fixtures.json.
// Usage: node test/helpers/dashboard-qa-server.mjs  (after `npm run build`), then open
// http://localhost:8788/qa/sign-in to receive the fixture session cookie.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { consentSchema, defaultConsent } from "../../../shared/dist/activity-consent.js";
import { contentKinds } from "../../../shared/dist/activity-schema.js";
import { onRequest as apiRequest } from "../../functions/api/[[path]].ts";
import { onRequest as authRequest } from "../../functions/auth/[[path]].ts";
import { SESSION_COOKIE, signCookie } from "../../lib/auth.ts";
import { activityDb } from "./activity-db.mjs";

const origin = "http://localhost:8788";
const sid = "activity-qa-session-ssssssssssssssssssssssssssssssss";
const dist = new URL("../../dist/", import.meta.url);
const fixtures = JSON.parse(await readFile(new URL("../../../local/dashboard/dev-fixtures.json", import.meta.url), "utf8"));
const usage = JSON.parse(await readFile(new URL("../../../local/dashboard/dev-fixtures-usage.json", import.meta.url), "utf8"));
const { db, accounts } = await activityDb({ after() {} });
db.exec(await readFile(new URL("../fixtures/activity-qa.sql", import.meta.url), "utf8"));
const devices = {
  "qa-device-ready": "full", "qa-device-stale": "full", "qa-device-pending": "full", "qa-device-failing": "full",
  "qa-device-awaiting": "full", "qa-device-partial": "partial", "qa-device-local": "none", "qa-device-revoked": "revoked",
};
const jobs = new Map();
const revision = { sequence: 7, journalThrough: 70, runtimeSequence: 3 };
const capturedAtMs = Date.now() - 3 * 3_600_000, receivedAtMs = Date.now() - 2 * 3_600_000;

function filterRows(rows, filter = {}) {
  return rows.filter(row =>
    (row.automated === undefined || filter.automated !== undefined) &&
    (filter.runtime === undefined || filter.runtime.includes(row.runtime)) &&
    (filter.state === undefined || filter.state.includes(row.state)) &&
    (filter.from === undefined || row.startedAt >= filter.from) &&
    (filter.to === undefined || row.startedAt <= filter.to) &&
    (filter.q === undefined || `${row.firstPrompt ?? ""}\n${row.id}`.toLowerCase().includes(filter.q.toLowerCase())));
}

function payloadFor(query) {
  switch (query.kind) {
    case "sessions": return filterRows(fixtures.sessions, query.filter);
    case "trace": return fixtures.traces[query.sessionId] ?? [];
    case "flow": return { ...fixtures.flow, unit: query.unit };
    case "heatmap": return fixtures.heatmap;
    case "skill-week": return fixtures.skillWeek;
    case "stats": return { ...fixtures.stats, ...usage.stats };
    case "skills": return fixtures.skills;
    case "flows": return { generatedAt: Date.now(), from: null, to: null, limit: query.limit, automated: query.automated, flows: [], nextCursor: null };
    case "workflow-versions": return [];
    default: return undefined;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function startJob(input) {
  const jobId = crypto.randomUUID();
  const base = {
    schemaVersion: 1, jobId, generatedAt: Date.now(), sourceCapturedAt: capturedAtMs, sourceReceivedAt: receivedAtMs,
    inputRevision: revision, analysisVersion: 1, stale: input.deviceId === "qa-device-stale", pending: true, error: null, result: null,
  };
  const payload = payloadFor(input.query);
  const job = { polls: 0, parts: [], status: { ...base, state: "queued" } };
  if (input.deviceId === "qa-device-pending") job.final = { ...base, state: "running" };
  else if (input.deviceId === "qa-device-failing" || payload === undefined) {
    job.final = { ...base, state: "failed", pending: false, error: payload === undefined ? `${input.query.kind.replace(/-/g, "_")}_unavailable` : "runtime_missing" };
  } else {
    const envelope = { generatedAt: base.generatedAt, inputRevision: revision, analysisVersion: 1, coverage: {}, sourceCapturedAt: capturedAtMs, sourceReceivedAt: receivedAtMs, pending: false, payload };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    for (let offset = 0; offset < bytes.length; offset += 120_000) {
      const chunk = bytes.subarray(offset, offset + 120_000);
      job.parts.push({ index: job.parts.length, bytes: chunk.length, hash: sha256(chunk), body: chunk.toString("base64") });
    }
    job.final = { ...base, state: "complete", pending: false, result: { parts: job.parts.length, bytes: bytes.length, hash: sha256(bytes) } };
  }
  jobs.set(jobId, job);
  return job.status;
}

function pollJob(jobId) {
  const job = jobs.get(jobId);
  if (job === undefined) return Response.json({ error: "report_missing" }, { status: 404 });
  job.polls += 1;
  return Response.json(job.polls >= 1 ? job.final : job.status);
}

async function profiles(principal) {
  const rows = accounts.prepare(`SELECT d.device_id, d.created_at, d.revoked_at, c.version, c.consent_json FROM devices d
    LEFT JOIN device_consents c ON c.account_id=d.account_id AND c.device_id=d.device_id AND c.generation=?
      AND c.version=(SELECT max(v.version) FROM device_consents v WHERE v.account_id=d.account_id AND v.device_id=d.device_id AND v.generation=?)
    WHERE d.account_id=? ORDER BY d.created_at, d.device_id`).bind(principal.generation, principal.generation, principal.accountId);
  const list = (await rows.all()).results.map(row => ({
    deviceId: row.device_id, createdAt: row.created_at, revokedAt: row.revoked_at, consentVersion: row.version ?? 0,
    consent: row.consent_json === null ? defaultConsent : consentSchema.parse(JSON.parse(row.consent_json)),
  }));
  const sources = list.map(device => {
    const consent = device.consent;
    const complete = consent.mode === "managed-content" && consent.version === device.consentVersion &&
      contentKinds.every(kind => consent.contentKinds.includes(kind));
    const runtimeSequence = device.deviceId === "qa-device-awaiting" ? null : revision.runtimeSequence;
    const availability = device.revokedAt !== null ? "revoked" : consent.mode === "local-only" ? "local-only" :
      consent.mode === "metadata" ? "metadata-only" : !complete ? "partial" : runtimeSequence === null ? "awaiting-runtime" : "ready";
    return { deviceId: device.deviceId, sourceDomain: `fixture-${device.deviceId}`, sourceSequence: revision.sequence,
      journalThrough: revision.journalThrough, runtimeSequence, capturedAtMs, receivedAtMs, availability };
  });
  return { schemaVersion: 1, ingestEnabled: true, devices: list, profiles: sources };
}

export const service = {
  async fetch(request) {
    const input = await request.json();
    const principal = JSON.parse(request.headers.get("x-skillar-principal"));
    switch (new URL(request.url).pathname) {
      case "/v1/activity/dashboard/profiles": return Response.json(await profiles(principal));
      case "/v1/activity/query": return Response.json(startJob(input));
      case "/v1/activity/reports/status": return pollJob(input.jobId);
      case "/v1/activity/reports/result": {
        const part = jobs.get(input.jobId)?.parts[input.part];
        return part === undefined ? Response.json({ error: "report_missing" }, { status: 404 }) : Response.json(part);
      }
      case "/v1/activity/dashboard/eval-cases":
        return Response.json({ caseId: crypto.randomUUID(), state: "stored", retainedUntilMs: Date.now() + 30 * 86_400_000 });
      default: return Response.json({ error: "not_found" }, { status: 404 });
    }
  },
};
export const env = {
  GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture", SESSION_KEY: "fixture-session-key-at-least-32-characters",
  PUBLIC_ORIGIN: origin, ACCOUNTS: accounts, ACTIVITY_ENABLED: "true", ACTIVITY_INGEST_ENABLED: "true", ACTIVITY_SERVICE: service,
};
const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "activity-qa", sid }, "session", env, Math.floor(Date.now() / 1000))}`;

async function seed() {
  const call = (path, body) => apiRequest({ env, request: new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) });
  await call("/api/dashboard/status");
  const accountId = db.prepare("SELECT account_id FROM accounts WHERE user_sub='activity-qa'").get().account_id;
  const now = Math.floor(Date.now() / 1000);
  let order = 0;
  for (const [deviceId, kind] of Object.entries(devices)) {
    db.prepare("INSERT INTO devices VALUES (?,?,?,?)").run(accountId, deviceId, now - 86_400 * (7 - order++), kind === "revoked" ? now - 3600 : null);
    if (kind !== "full" && kind !== "partial") continue;
    const response = await call(`/api/devices/${deviceId}/consent`, { baseVersion: 0, consent: {
      mode: "managed-content", version: 1, grantedAtMs: 0, serverProcessingAcknowledged: true,
      scope: { deviceId, projectIds: [`device:${deviceId}`], rootIds: [] },
      contentKinds: kind === "full" ? contentKinds : ["query"],
    } });
    if (response.status !== 200) throw new Error(`seed consent for ${deviceId} failed with ${response.status}`);
  }
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".txt": "text/plain" };

async function serveStatic(pathname) {
  const file = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  try {
    const body = await readFile(new URL(`.${file}`, dist));
    return new Response(body, { headers: { "content-type": types[extname(file)] ?? "application/octet-stream" } });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return new Response("Not found", { status: 404 });
    throw error;
  }
}

async function toResponse(request) {
  const url = new URL(request.url);
  if (url.pathname === "/qa/sign-in") {
    return new Response(null, { status: 303, headers: { location: "/dashboard/", "set-cookie": `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (url.pathname === "/qa/expire") {
    db.prepare("DELETE FROM sessions WHERE id=?").run(sid);
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/qa/restore") {
    db.prepare("INSERT OR REPLACE INTO sessions VALUES (?,'activity-qa',?)").run(sid, Math.floor(Date.now() / 1000) + 3600);
    return new Response(null, { status: 204 });
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) return apiRequest({ env, request });
  if (url.pathname.startsWith("/auth/")) return authRequest({ env, request });
  return serveStatic(url.pathname);
}

await seed();
createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request(`${origin}${incoming.url}`, {
    method: incoming.method, headers: incoming.headers, ...(body.length === 0 ? {} : { body }),
  });
  const response = await toResponse(request);
  const headers = [];
  for (const [name, value] of response.headers) if (name !== "set-cookie") headers.push([name, value]);
  for (const value of response.headers.getSetCookie()) headers.push(["set-cookie", value]);
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(8788, "127.0.0.1", () => console.log(`QA SURFACE READY ${origin}`));
