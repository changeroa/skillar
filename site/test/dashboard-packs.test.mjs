import assert from "node:assert/strict";
import test from "node:test";
import { privatePackCreateSchema } from "../../shared/dist/private-packs.js";
import { DashboardRequestError } from "../src/dashboard/api.ts";
import { publishPrivatePack, readPrivatePacks, readPrivatePackStatus } from "../src/dashboard/pack-api.ts";

const requestId = "e7c84b91-144d-4f4c-99d8-8a9495d568aa";
const digest = "a".repeat(64), previous = "b".repeat(64);
const create = privatePackCreateSchema.parse({
  request_id: requestId, acknowledge_private_upload: true,
  definition: {
    schema_version: 1, kind: "skill-pack", name: "synthetic-pack", display_name: "Synthetic pack",
    description: "Synthetic pack", scope: "Synthetic review",
    members: ["scope", "investigate", "verify"].map((phase, index) => ({
      uri: `skillar://private/${index + 1}381f285-e3d8-49c2-9c51-228f1d852998/${digest}/SKILL.md`,
      phase, selection: "required", when: `Synthetic ${phase}`,
    })),
  },
});
const published = {
  request_id: requestId, uri: "pack://private/synthetic-pack", digest, current_digest: digest,
  status: "published", revision: 1, unchanged: false, content_durable: true, searchable: true, error: null,
};
const signal = () => new AbortController().signal;

function response(t, status, body) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json(body, { status });
  });
  return calls;
}

test("pack creation posts the explicit private upload confirmation and immutable request ID", async t => {
  // Given an acknowledged local pack definition.
  const calls = response(t, 200, published), abort = signal();
  // When its create request is sent.
  const result = await publishPrivatePack({ action: "create", body: create }, abort);
  // Then the boundary preserves the exact payload and authenticated request policy.
  assert.deepEqual(result, published);
  assert.equal(calls[0].url, "/api/packs/create");
  assert.deepEqual(calls[0].body, create);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.signal, abort);
});

test("pack updates retain the selected digest CAS", async t => {
  // Given an edited definition based on a known published digest.
  const calls = response(t, 200, published), body = {
    ...create, uri: published.uri, expected_digest: previous,
  };
  // When the update is sent.
  await publishPrivatePack({ action: "update", body }, signal());
  // Then the server receives its exact optimistic concurrency boundary.
  assert.equal(calls[0].url, "/api/packs/update");
  assert.deepEqual(calls[0].body, body);
});

test("a failed CAS receipt remains queryable and retry preserves the same request", async t => {
  // Given a durable failed job rather than an unconfirmed publication.
  const failed = {
    ...published, status: "failed", revision: null, unchanged: false,
    current_digest: previous, content_durable: false, searchable: false, error: "pack_conflict",
  };
  const calls = response(t, 409, failed), request = { action: "create", body: create };
  // When the same request is retried.
  assert.deepEqual(await publishPrivatePack(request, signal()), failed);
  assert.deepEqual(await publishPrivatePack(request, signal()), failed);
  // Then neither its identity nor its payload is replaced.
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[1].body.request_id, requestId);
});

test("pack status uses only its durable request identity", async t => {
  // Given a request whose accepted outcome is still pending publication.
  const accepted = {
    ...published, status: "accepted", revision: null, unchanged: false,
    current_digest: null, content_durable: false, searchable: false,
  };
  const calls = response(t, 200, accepted);
  // When its status is inspected.
  const result = await readPrivatePackStatus({ request_id: requestId }, signal());
  // Then no unrelated URI field is sent to the strict status contract.
  assert.equal(calls[0].url, "/api/packs/status");
  assert.deepEqual(calls[0].body, { request_id: requestId });
  assert.equal(result.status, "accepted");
  assert.equal(result.searchable, false);
});

test("invalid pack definitions fail before network transfer", t => {
  // Given a definition with its required members removed.
  const calls = response(t, 200, published);
  // When client validation sees the invalid request.
  assert.throws(() => publishPrivatePack({
    action: "create", body: { ...create, definition: { ...create.definition, members: [] } },
  }, signal()));
  // Then no upload is attempted.
  assert.equal(calls.length, 0);
});

test("an expired pack session reaches the existing account expiry boundary", async t => {
  // Given a server rejection of the current session.
  response(t, 401, { error: "unauthorized" });
  // When a status read crosses that boundary.
  await assert.rejects(() => readPrivatePackStatus({ request_id: requestId }, signal()),
    error => error instanceof DashboardRequestError && error.status === 401 && error.code === "unauthorized");
});

test("pack listing is an explicit bounded read rather than a polling loop", async t => {
  // Given an empty account-private pack catalog.
  const calls = response(t, 200, { packs: [], totalMatches: 0, offset: 0, limit: 5 });
  // When the user requests a refresh.
  const result = await readPrivatePacks(signal());
  // Then one bounded request is made.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/packs/search");
  assert.deepEqual(calls[0].body, { mode: "explicit", query: "", offset: 0, limit: 5 });
  assert.equal(result.totalMatches, 0);
});
