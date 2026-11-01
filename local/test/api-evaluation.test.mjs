import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { bearer, http, jsonHeaders, startTestServer } from "./helpers/api.mjs";

let server;
before(async () => { server = await startTestServer(); });
after(async () => { await server.stop(); });

const get = (path) => http(server.port, { path, headers: bearer(server.token) });
const post = (path, body) => http(server.port, { method: "POST", path, headers: jsonHeaders(server.token), body: JSON.stringify(body) });
const patch = (path, body) => http(server.port, { method: "PATCH", path, headers: jsonHeaders(server.token), body: JSON.stringify(body) });
const SKILL = "skill://local/agents/pr-review/SKILL.md";

test("evaluation routes preserve unlabeled captures, validate catalog labels, and persist a baseline", async () => {
  const saved = await post("/api/eval-cases", { query: "review this change", fromTraceId: "trace-local" });
  assert.equal(saved.status, 201);
  assert.equal(saved.json.case.label, "unlabeled");
  assert.match(saved.json.case.id, /^[0-9a-f-]+$/i, "ids stay opaque");

  const id = saved.json.case.id;
  assert.equal((await patch(`/api/eval-cases/${id}`, { label: "skill", expectedUri: "skill://local/agents/missing/SKILL.md" })).status, 400);
  const labeled = await patch(`/api/eval-cases/${id}`, { label: "skill", expectedUri: SKILL });
  assert.equal(labeled.status, 200);
  assert.deepEqual(labeled.json.case.label, "skill");
  assert.equal((await patch(`/api/eval-cases/${id}`, { label: "no_match", expectedUri: SKILL })).status, 400);
  assert.equal((await patch(`/api/eval-cases/${id}`, { label: "no_match", fromTraceId: "rewritten" })).status, 400);
  const noMatch = await patch(`/api/eval-cases/${id}`, { label: "no_match" });
  assert.equal(noMatch.status, 200);
  assert.equal(noMatch.json.case.expectedUri, undefined, "explicit no-match clears a former skill label");

  const list = await get("/api/eval-cases");
  assert.deepEqual(list.json.map((item) => [item.id, item.label, item.fromTraceId]), [[id, "no_match", "trace-local"]]);
  const baseline = await post("/api/evaluation/runs", { baseline: true });
  assert.equal(baseline.status, 201);
  assert.equal(baseline.json.run.baseline, true);
  assert.equal(baseline.json.latest.metrics.noMatchLabels, 1);
  assert.equal(baseline.json.latest.metrics.noMatchAccuracy, 0, "a matching query is not a correct no-match");

  const summary = await get("/api/evaluation");
  assert.equal(summary.status, 200);
  assert.equal(summary.json.baseline.id, baseline.json.run.id);
  assert.equal(summary.json.comparison, undefined, "the same catalog has no before/after claim");
});
