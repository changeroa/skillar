import assert from "node:assert/strict";
import test from "node:test";
import { sourceOperationSchema } from "../../shared/dist/activity-commands.js";
import { DashboardRequestError, readCommandStatus, routes, submitCommand } from "../src/dashboard/api.ts";
import {
  COMMAND_KINDS, COMMAND_STATE_COPY, buildOperation, checkFailed, checked, classifyFailure, commandRequest, draftFromOperation,
  emptyCommandDraft, fromStatus, isCommandId, newSubmission, nextActions, resultEntries, statusRequest, submitFailed, submitted,
} from "../src/dashboard/commands.ts";

const profile = { deviceId: "device-under-test", sourceDomain: "source-a" };
const commandId = "6f1d2c1e-6a0b-4c7e-9a7b-1a2b3c4d5e6f";
const drafts = {
  "workflow.put": { ...emptyCommandDraft("workflow.put"), workflowName: "review", workflowSteps: JSON.stringify([
    { id: "plan", skills: ["skillar/plan"] }, { id: "code", skills: [], together: true, doneWhen: "tests pass" },
  ]) },
  "flow.create": { ...emptyCommandDraft("flow.create"), workspaceId: "ws-1", flowName: "review", flowVersion: "2", tabId: " ", label: "" },
  "flow.map-step": { ...emptyCommandDraft("flow.map-step"), flowId: "flow-1", paneId: "pane-1", stepId: "plan" },
  "flow.end": { ...emptyCommandDraft("flow.end"), flowId: "flow-1" },
  "eval.add": { ...emptyCommandDraft("eval.add"), query: "find a skill for pdf", expectedUri: "skill://pdf", fromTraceId: "" },
};
const pending = { commandId, state: "pending", baseRevision: 40, sourceRevision: null, result: null, error: null };
const operation = kind => buildOperation(drafts[kind]).operation;

test("result entries retain exact machine keys and values alongside human labels", () => {
  // Given a result with known fields, a structured value and an unfamiliar key.
  const result = { stored: true, flowId: "flow-1", spec: { version: 2 }, toString: false };
  // When it is projected into display entries.
  const entries = resultEntries({ ...pending, state: "applied", result });
  // Then the technical representation loses no keys or values.
  assert.deepEqual(entries.map(({ key, value }) => ({ key, value })), [
    { key: "stored", value: "true" }, { key: "flowId", value: "flow-1" },
    { key: "spec", value: '{"version":2}' }, { key: "toString", value: "false" },
  ]);
  assert.ok(entries.every(entry => typeof entry.label === "string" && entry.label !== entry.key));
  assert.deepEqual(resultEntries(null), []);
  assert.deepEqual(resultEntries(pending), []);
});

function mockFetch(t, status, body) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json(body, { status });
  });
  return calls;
}

test("every command kind builds an operation the shared schema accepts, with workflow defaults applied and blank optionals omitted", () => {
  for (const kind of COMMAND_KINDS) {
    const built = buildOperation(drafts[kind]);
    assert.equal(built.ok, true, kind);
    assert.equal(built.operation.kind, kind);
    assert.deepEqual(sourceOperationSchema.parse(built.operation), built.operation);
  }
  assert.deepEqual(operation("workflow.put").spec.steps[0], { id: "plan", skills: ["skillar/plan"], together: false, expectTools: [] });
  assert.deepEqual(operation("flow.create"), { kind: "flow.create", workspaceId: "ws-1", spec: { name: "review", version: 2 } });
  assert.deepEqual(operation("eval.add"), { kind: "eval.add", query: "find a skill for pdf", expectedUri: "skill://pdf" });
});

test("invalid drafts report one problem per field and build nothing", () => {
  const counts = [
    [emptyCommandDraft("workflow.put"), 2],
    [{ ...drafts["workflow.put"], workflowSteps: "[{" }, 1],
    [{ ...drafts["workflow.put"], workflowSteps: JSON.stringify([{ id: "a", skills: [] }, { id: "a", skills: [] }]) }, 1],
    [{ ...drafts["workflow.put"], workflowSteps: JSON.stringify([{ id: "a", skills: [], extra: 1 }]) }, 1],
    [{ ...drafts["workflow.put"], workflowName: "-bad name" }, 1],
    [{ ...drafts["flow.create"], flowVersion: "0" }, 1],
    [{ ...drafts["flow.create"], flowVersion: "two" }, 1],
    [emptyCommandDraft("flow.map-step"), 3],
    [emptyCommandDraft("eval.add"), 1],
  ];
  for (const [draft, expected] of counts) {
    const built = buildOperation(draft);
    assert.equal(built.ok, false);
    assert.equal(built.problems.length, expected, built.problems.join(" | "));
  }
});

test("a sent operation copied back into the form rebuilds the same operation", () => {
  for (const kind of COMMAND_KINDS) {
    assert.deepEqual(buildOperation(draftFromOperation(operation(kind))).operation, operation(kind), kind);
  }
});

test("submitCommand posts the exact request to the commands route and parses a 202 pending status", async t => {
  const calls = mockFetch(t, 202, pending);
  const submission = newSubmission(profile, 40, operation("flow.end"), 1, commandId);
  assert.deepEqual(await submitCommand(commandRequest(submission)), pending);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, routes.commands);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { profile, commandId, baseRevision: 40, operation: { kind: "flow.end", flowId: "flow-1" } });
});

test("readCommandStatus posts only the profile and command ID to the status route", async t => {
  const calls = mockFetch(t, 200, { ...pending, state: "applied", sourceRevision: 41, result: { flowId: "flow-1" } });
  const status = await readCommandStatus(statusRequest(newSubmission(profile, 40, operation("flow.end"), 1, commandId)));
  assert.equal(status.state, "applied");
  assert.equal(calls[0].url, routes.commandStatus);
  assert.deepEqual(calls[0].body, { profile, commandId });
});

test("a status answer outside the shared schema is a failure, never partial data", async t => {
  mockFetch(t, 202, { commandId, state: "done" });
  await assert.rejects(submitCommand(commandRequest(newSubmission(profile, 40, operation("flow.end"), 1, commandId))));
});

test("an unconfirmed send keeps its command ID, base and operation so a retry replays the same request", () => {
  const first = newSubmission(profile, 40, operation("eval.add"), 1, commandId);
  const network = submitFailed(first, classifyFailure(new TypeError("fetch failed")));
  assert.deepEqual(network.outcome, { kind: "uncertain", cause: "network", check: "unchecked" });
  assert.deepEqual(commandRequest(network), commandRequest(first));
  assert.deepEqual(nextActions(network, 40, 1), { retry: true, check: true, refresh: false, resubmit: false, edit: false });
  const server = submitFailed(first, classifyFailure(new DashboardRequestError(503, "command_unavailable")));
  assert.deepEqual(server.outcome, { kind: "uncertain", cause: "server", check: "unchecked" });
  const missing = checkFailed(network, classifyFailure(new DashboardRequestError(404, "not_found")));
  assert.equal(missing.outcome.check, "missing");
  assert.equal(nextActions(missing, 40, 1).retry, true);
  assert.equal(checkFailed(network, classifyFailure(new TypeError("fetch failed"))).outcome.check, "unreachable");
});

test("a pending reservation can clear after a no-op without advancing the source revision", () => {
  // Given a refused second writer while the first command holds the source.
  const first = newSubmission(profile, 40, operation("flow.end"), 1, commandId);
  const conflict = submitFailed(first, classifyFailure(new DashboardRequestError(409, "command_conflict")));
  // When sources are explicitly reloaded after the first writer's no-op ACK.
  const actions = nextActions(conflict, 40, 2);
  // Then the unchanged source cut can be submitted with a new command ID.
  assert.equal(actions.retry, false);
  assert.equal(actions.resubmit, true);
});

test("a refused command is never retried blindly; a conflict needs a fresh sources load covering the base", () => {
  const first = newSubmission(profile, 40, operation("flow.end"), 1, commandId);
  const conflict = submitFailed(first, classifyFailure(new DashboardRequestError(409, "command_conflict")));
  assert.deepEqual(conflict.outcome, { kind: "refused", reason: "conflict", technical: "409 (command_conflict)" });
  assert.deepEqual(nextActions(conflict, 40, 1), { retry: false, check: false, refresh: true, resubmit: false, edit: true });
  assert.equal(nextActions(conflict, 39, 2).resubmit, false);
  assert.equal(nextActions(conflict, 40, 2).resubmit, true);
  assert.equal(nextActions(conflict, 41, 2).resubmit, true);
  const refusals = [
    [403, "forbidden", "forbidden"], [404, "not_found", "disabled"], [400, "invalid_request", "invalid"],
    [413, "batch_too_large", "too-large"], [429, "rate_limited", "rate-limited"], [409, "command_integrity", "other"],
  ];
  for (const [status, code, reason] of refusals) {
    const refused = submitFailed(first, classifyFailure(new DashboardRequestError(status, code)));
    assert.deepEqual(refused.outcome, { kind: "refused", reason, technical: `${status} (${code})` });
    assert.equal(nextActions(refused, 50, 9).retry, false, code);
    assert.equal(nextActions(refused, 50, 9).resubmit, false, code);
  }
  assert.deepEqual(classifyFailure(new DashboardRequestError(401, "unauthorized")), { kind: "unauthorized" });
});

test("an accepted command stays pending until the device reports, and each terminal state gates the next step", () => {
  const accepted = submitted(newSubmission(profile, 40, operation("workflow.put"), 1, commandId), pending);
  assert.equal(accepted.outcome.kind, "tracked");
  assert.equal(accepted.outcome.status.state, "pending");
  assert.equal(COMMAND_STATE_COPY.pending.tone, "pending");
  assert.notEqual(COMMAND_STATE_COPY.pending.tone, COMMAND_STATE_COPY.applied.tone);
  assert.deepEqual(nextActions(accepted, 40, 1), { retry: false, check: true, refresh: false, resubmit: false, edit: false });
  const applied = checked(accepted, { ...pending, state: "applied", sourceRevision: 41, result: { name: "review" } });
  assert.deepEqual(nextActions(applied, 41, 2), { retry: false, check: false, refresh: false, resubmit: false, edit: true });
  const conflict = checked(accepted, { ...pending, state: "conflict", sourceRevision: 45, error: "journal moved" });
  assert.equal(nextActions(conflict, 44, 2).resubmit, false);
  assert.equal(nextActions(conflict, 45, 1).resubmit, false);
  assert.deepEqual(nextActions(conflict, 45, 2), { retry: false, check: false, refresh: true, resubmit: true, edit: true });
  const rejected = checked(accepted, { ...pending, state: "rejected", sourceRevision: 40, error: "unknown workflow" });
  assert.deepEqual(nextActions(rejected, 40, 1), { retry: false, check: false, refresh: false, resubmit: false, edit: true });
  const unreachable = checkFailed(accepted, classifyFailure(new TypeError("fetch failed")));
  assert.equal(unreachable.outcome.status.state, "pending");
  assert.equal(unreachable.outcome.check, "unreachable");
});

test("a status looked up by ID is tracked without an operation and is never offered for resubmission", () => {
  const found = fromStatus(profile, { ...pending, state: "conflict", sourceRevision: 45 }, 3);
  assert.equal(found.operation, null);
  assert.equal(found.baseRevision, 40);
  assert.deepEqual(nextActions(found, 50, 4), { retry: false, check: false, refresh: true, resubmit: false, edit: false });
  assert.throws(() => commandRequest(found), TypeError);
  assert.equal(isCommandId(commandId), true);
  assert.equal(isCommandId("not-a-command-id"), false);
});
