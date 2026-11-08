import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mcpConnectionsSchema, mcpPatRequestSchema, mcpPatResponseSchema } from "../../shared/dist/mcp-auth.js";
import {
  checkDraft, classifyFailure, connectionStatus, createPat, draftFieldProblems, emptyDraft, initialModel, readConnections, revokeConnection, routes,
  sortConnections, update,
} from "../src/mcp-connections.ts";

const now = 1_800_000_000;
const resource = "https://skillar.sh/mcp";
const connectionId = "11223344-1122-4122-8122-112233445566";
const otherId = "11223344-1122-4122-8122-000000000002";
test("pointer confirmation puts the safe action before the destructive action", async () => {
  const source = await readFile(new URL("../src/connections-workspace.ts", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/"data-action": "([^"]+)"/g)].map(match => match[1]),
    ["keep", "confirm", "revoke"]);
});
const pat = {
  connectionId, kind: "pat", name: "laptop agent", scopes: ["skills:read"], recordActivity: false,
  createdAt: now, expiresAt: now + 7 * 86_400, revokedAt: null,
};
const oauth = { ...pat, connectionId: otherId, kind: "oauth", name: "Claude Code", scopes: ["skills:read", "offline_access"], createdAt: now - 60 };
const syntheticToken = `skm_${"A".repeat(43)}`;
const listing = { resource, connections: [pat, oauth] };
const draft = { name: " laptop agent ", expiresInDays: "30", recordActivity: true };

function mockFetch(t, status, body) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  });
  return calls;
}

test("routes follow the P11 contract, encode identifiers and return to this page after sign-in", () => {
  assert.equal(routes.connections, "/api/mcp/connections");
  assert.equal(routes.connection(connectionId), `/api/mcp/connections/${connectionId}`);
  assert.equal(routes.connection("a/b c"), "/api/mcp/connections/a%2Fb%20c");
  assert.equal(routes.signIn, "/auth/google?returnTo=%2Fconnections%2F");
});

test("the default draft is a 7-day token with recording off and no name", () => {
  // Given
  const empty = emptyDraft();
  // Then
  assert.deepEqual(empty, { name: "", expiresInDays: "7", recordActivity: false });
  assert.deepEqual(initialModel.draft, empty);
  assert.equal(initialModel.token, null);
  const check = checkDraft(empty);
  assert.equal(check.ok, false);
  assert.equal(check.problems.length, 1);
});

test("a complete draft becomes the shared PAT request with a trimmed name; each bad field adds one problem", () => {
  // When
  const check = checkDraft(draft);
  // Then
  assert.equal(check.ok, true);
  assert.deepEqual(check.body, { name: "laptop agent", expiresInDays: 30, recordActivity: true });
  assert.deepEqual(mcpPatRequestSchema.parse(check.body), check.body);
  for (const expiresInDays of ["0", "31", "7.5", "", "seven", "-1"]) {
    const bad = checkDraft({ ...draft, expiresInDays });
    assert.equal(bad.ok, false, expiresInDays);
    assert.equal(bad.problems.length, 1, expiresInDays);
  }
  assert.equal(checkDraft({ ...draft, name: "x".repeat(81) }).problems.length, 1);
  assert.equal(checkDraft({ ...draft, name: "   ", expiresInDays: "0" }).problems.length, 2);
});

test("PAT field errors map independently and disappear when a field is corrected", () => {
  const both = checkDraft({ name: "", expiresInDays: "0", recordActivity: false });
  assert.equal(both.problems.length, 2);
  assert.deepEqual(draftFieldProblems({ name: "", expiresInDays: "0", recordActivity: false }, both.problems), [
    { field: "name", text: both.problems[0] },
    { field: "days", text: both.problems[1] },
  ]);
  const one = checkDraft({ name: "valid name", expiresInDays: "0", recordActivity: false });
  assert.deepEqual(draftFieldProblems({ name: "valid name", expiresInDays: "0", recordActivity: false }, one.problems), [
    { field: "days", text: one.problems[0] },
  ]);
});

test("PAT form describes only each invalid field's own error", async () => {
  const html = await readFile(new URL("../connections/index.html", import.meta.url), "utf8");
  assert.match(html, /<input id="pat-name"[^>]*>/);
  assert.doesNotMatch(html.match(/<input id="pat-name"[^>]*>/)[0], /aria-describedby="pat-problems"/);
  assert.match(html, /<input id="pat-days"[^>]*>/);
  assert.doesNotMatch(html.match(/<input id="pat-days"[^>]*>/)[0], /aria-describedby="pat-problems"/);
});

test("listing connections is a same-origin GET parsed with the shared schema", async t => {
  // Given
  const calls = mockFetch(t, 200, listing);
  // When
  const parsed = await readConnections();
  // Then
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, routes.connections);
  assert.deepEqual([calls[0].init.method, calls[0].init.credentials, calls[0].init.cache, calls[0].init.body], ["GET", "same-origin", "no-store", undefined]);
  assert.deepEqual(parsed, mcpConnectionsSchema.parse(listing));
  assert.equal(parsed.resource, resource);
});

test("a listing without the canonical resource is refused as unexpected rather than shown partially", async t => {
  mockFetch(t, 200, { connections: [pat] });
  await assert.rejects(readConnections(), error => classifyFailure(error) === "unexpected");
});

test("listing failures distinguish signed-out, disabled, unavailable, rate-limited and rejected by status", async t => {
  const cases = [[401, "unauthorized", "signed-out"], [404, "not_found", "disabled"], [503, "mcp_unavailable", "unavailable"],
    [429, "rate_limited", "rate-limited"], [400, "invalid_request", "rejected"], [418, "teapot", "other"]];
  for (const [status, code, kind] of cases) {
    mockFetch(t, status, { error: code });
    await assert.rejects(readConnections(), error => classifyFailure(error) === kind && error.code === code && error.status === status, String(status));
  }
  assert.equal(classifyFailure(new TypeError("fetch failed")), "unreachable");
  assert.equal(classifyFailure(new Error("other")), "other");
});

test("a token is issued only by an explicit POST of the validated draft and the response is schema-checked", async t => {
  // Given
  const calls = mockFetch(t, 200, { connection: pat, token: syntheticToken });
  const check = checkDraft(draft);
  // When
  const result = await createPat(check.body);
  // Then
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, routes.connections);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "laptop agent", expiresInDays: 30, recordActivity: true });
  assert.deepEqual(result, mcpPatResponseSchema.parse({ connection: pat, token: syntheticToken }));
});

test("a success response whose token is not a skm_ credential has an unconfirmed outcome", async t => {
  mockFetch(t, 200, { connection: pat, token: "skm_short" });
  await assert.rejects(createPat(checkDraft(draft).body), error => classifyFailure(error) === "unconfirmed");
});

test("the model holds a created token masked, in memory only, until dismissed; the connection stays listed", () => {
  // Given
  const loaded = update(update(initialModel, { type: "load" }), { type: "loaded", list: mcpConnectionsSchema.parse({ resource, connections: [oauth] }) });
  const edited = update(loaded, { type: "draft", draft });
  const creating = update(edited, { type: "create" });
  // When
  const created = update(creating, { type: "created", result: mcpPatResponseSchema.parse({ connection: pat, token: syntheticToken }) });
  // Then
  assert.equal(creating.creating, true);
  assert.equal(created.creating, false);
  assert.equal(created.token === syntheticToken, true);
  assert.equal(created.tokenVisible, false);
  assert.deepEqual(created.draft, emptyDraft());
  assert.deepEqual(created.connections.map(connection => connection.connectionId), [connectionId, otherId]);
  const shown = update(created, { type: "token-visible", visible: true });
  assert.equal(shown.tokenVisible, true);
  assert.equal(update(shown, { type: "token-visible", visible: false }).tokenVisible, false);
  const dismissed = update(shown, { type: "token-dismissed" });
  assert.equal(dismissed.token, null);
  assert.equal(dismissed.tokenVisible, false);
  assert.deepEqual(dismissed.connections, created.connections);
  assert.equal(update(dismissed, { type: "token-visible", visible: true }).tokenVisible, false);
  assert.equal(JSON.stringify(dismissed).includes(syntheticToken), false);
});

test("load and create failures keep the draft; a lost session clears the token and list but not the draft", () => {
  // Given
  const edited = update(update(initialModel, { type: "loaded", list: mcpConnectionsSchema.parse(listing) }), { type: "draft", draft });
  const withToken = update(edited, { type: "created", result: mcpPatResponseSchema.parse({ connection: pat, token: syntheticToken }) });
  // When / Then
  for (const failure of ["unavailable", "unreachable", "unexpected", "rate-limited", "rejected", "other"]) {
    const failed = update(update(edited, { type: "load" }), { type: "load-failed", failure });
    assert.equal(failed.phase, failure);
    assert.deepEqual(failed.draft, draft, failure);
    assert.equal(failed.connections.length, 2, failure);
  }
  const createFailed = update(update(edited, { type: "create" }), { type: "create-failed" });
  assert.deepEqual(createFailed.draft, draft);
  assert.equal(createFailed.creating, false);
  const signedOut = update(withToken, { type: "load-failed", failure: "signed-out" });
  assert.equal(signedOut.phase, "signed-out");
  assert.equal(signedOut.token, null);
  assert.equal(signedOut.resource, null);
  assert.deepEqual(signedOut.connections, []);
  assert.deepEqual(signedOut.draft, emptyDraft());
  const disabled = update(initialModel, { type: "load-failed", failure: "disabled" });
  assert.equal(disabled.phase, "disabled");
  assert.equal(disabled.resource, null);
});

test("revocation needs a confirmation step, keeping is free of requests, and confirming is one DELETE", async t => {
  // Given
  const loaded = update(initialModel, { type: "loaded", list: mcpConnectionsSchema.parse(listing) });
  const calls = mockFetch(t, 200, { revoked: true });
  // When
  const asked = update(loaded, { type: "revoke-asked", connectionId });
  const kept = update(asked, { type: "revoke-kept" });
  const revoking = update(asked, { type: "revoke" });
  // Then
  assert.equal(asked.confirming, connectionId);
  assert.equal(kept.confirming, null);
  assert.equal(calls.length, 0);
  assert.deepEqual([revoking.confirming, revoking.revoking], [null, connectionId]);
  await revokeConnection(connectionId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, routes.connection(connectionId));
  assert.deepEqual([calls[0].init.method, calls[0].init.credentials], ["DELETE", "same-origin"]);
  const revoked = update(revoking, { type: "revoked", connectionId, at: now + 100 });
  assert.equal(revoked.revoking, null);
  assert.equal(connectionStatus(revoked.connections.find(connection => connection.connectionId === connectionId), now + 100), "revoked");
  assert.equal(connectionStatus(revoked.connections.find(connection => connection.connectionId === otherId), now + 100), "active");
  assert.equal(update(revoking, { type: "revoke-failed" }).revoking, null);
});

test("a success revoke answer other than revoked:true is unconfirmed and a 404 is reported as disabled", async t => {
  mockFetch(t, 200, { revoked: false });
  await assert.rejects(revokeConnection(connectionId), error => classifyFailure(error) === "unconfirmed");
  mockFetch(t, 404, { error: "not_found" });
  await assert.rejects(revokeConnection(connectionId), error => classifyFailure(error) === "disabled");
});

test("status is revoked over expired over active, and the newest connection lists first", () => {
  assert.equal(connectionStatus(pat, now), "active");
  assert.equal(connectionStatus(pat, pat.expiresAt), "expired");
  assert.equal(connectionStatus({ ...pat, revokedAt: now + 1 }, now), "revoked");
  assert.equal(connectionStatus({ ...pat, revokedAt: now + 1 }, pat.expiresAt + 1), "revoked");
  assert.deepEqual(sortConnections([oauth, pat]).map(connection => connection.connectionId), [connectionId, otherId]);
  assert.deepEqual(sortConnections([{ ...oauth, createdAt: now, name: "b" }, { ...pat, name: "a" }]).map(connection => connection.name), ["a", "b"]);
});
