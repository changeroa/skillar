import assert from "node:assert/strict";
import test from "node:test";
import {
  eventCursor, eventCursorScope, eventCursorSchema, invalidationSchema,
  eventMessageSchema, replaySchema,
} from "../dist/activity-events.js";

test("account-wide cursors bind the account and retain exact safe sequence numbers", async () => {
  const scope = await eventCursorScope("first-account");
  assert.equal(scope.length, 64);
  assert.equal(await eventCursorScope("first-account"), scope);
  assert.notEqual(await eventCursorScope("other-account"), scope);
  assert.equal(eventCursor(scope, 1, 0), `${scope}.1.0`);
  assert.equal(eventCursor(scope, 2, Number.MAX_SAFE_INTEGER), `${scope}.2.${Number.MAX_SAFE_INTEGER}`);
  for (const value of [`${scope}.0.0`, `${scope}.1.-1`, `${scope}.1.01`,
    `${scope}.1.9007199254740992`, `${scope}.9007199254740992.0`, "1.2", `${scope}.1.1.filter`]) {
    assert.equal(eventCursorSchema.safeParse(value).success, false);
  }
});

test("invalidation frames reject private entity fields and unsupported kinds", () => {
  const frame = { generation: 1, seq: 2, invalidationKind: "activity" };
  assert.deepEqual(invalidationSchema.parse(frame), frame);
  for (const extra of [{ accountId: "private" }, { entityId: "private" }, { prompt: "private" },
    { invalidationKind: "arbitrary" }, { seq: 0 }, { generation: 0 }]) {
    assert.equal(invalidationSchema.safeParse({ ...frame, ...extra }).success, false);
  }
});

test("ready, reset, and bounded replay share the same validated cursor", async () => {
  const cursor = eventCursor(await eventCursorScope("first-account"), 1, 5);
  const connectionId = crypto.randomUUID();
  assert.equal(eventMessageSchema.safeParse({
    type: "ready", connectionId, cursor, expiresAtMs: 1000,
  }).success, true);
  assert.equal(eventMessageSchema.safeParse({ type: "resync_required", cursor }).success, true);
  const frame = { generation: 1, seq: 5, invalidationKind: "runtime" };
  assert.equal(replaySchema.safeParse({
    state: "ok", head: 5, cursor, changes: [frame], hasMore: false,
  }).success, true);
  assert.equal(replaySchema.safeParse({
    state: "ok", head: 5, cursor, changes: Array(101).fill(frame), hasMore: true,
  }).success, false);
});
