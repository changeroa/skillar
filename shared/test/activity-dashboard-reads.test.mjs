import assert from "node:assert/strict";
import test from "node:test";
import { createFactStore } from "../dist/activity-facts.js";
import { activityQuerySchema } from "../dist/activity-query.js";

const runtime = { schemaVersion: 1, capturedAtMs: 1000, activeRequests: [], tz: "UTC",
  ingest: { accepted: 0, rejected: 0, dropped: 0 } };
const row = (table, values) => ({ table, key: table, operation: "upsert", revision: 1, sourceOrder: 1, values });
const skill = {
  uri: "skill://local/r/group/a%20b/SKILL.md", rootId: "r", dir: "group/a b", name: "a b",
  description: "description", tags: ["tag"], whenToUse: "when", examples: ["example"], aliasesKo: ["별명"],
  group: { id: "family", stage: "build" }, invocation: "explicit", bodyHead: "body", digest: "digest",
  manifestDigest: "manifest", resources: [{ uri: "skill://local/r/group/a%20b/SKILL.md", digest: "digest", size: 12 }],
  mtimeMs: 9,
};
test("skills query projects retained catalog fields and omits tombstones", () => {
  // Given the same scalar catalog fields persisted by the local store.
  const values = {
    uri: skill.uri, root_id: skill.rootId, name: skill.name, description: skill.description,
    tags_json: JSON.stringify(skill.tags), when_to_use: skill.whenToUse, examples_json: JSON.stringify(skill.examples),
    aliases_ko_json: JSON.stringify(skill.aliasesKo), group_id: "family", group_stage: "build", invocation: "explicit",
    body_head: skill.bodyHead, digest: skill.digest, manifest_digest: skill.manifestDigest,
    resources_json: JSON.stringify(skill.resources), mtime_ms: skill.mtimeMs, removed_at: null,
  };
  const rows = [row("skills", values), row("skills", { ...values, uri: "skill://local/r/removed/SKILL.md", removed_at: 1 })];
  const store = createFactStore(rows, { runtime });
  // When the fact adapter supplies dashboard catalog reads.
  const actual = store.skills();
  // Then every retained catalog field and nested directory matches the local DTO.
  assert.deepEqual(actual, [skill]);
  assert.deepEqual(activityQuerySchema.parse({ kind: "skills" }), { kind: "skills" });
});
test("workflow versions preserve descending version and step semantics", () => {
  // Given multiple immutable workflow versions, including an unrelated workflow.
  const spec = (name, version) => row("workflow_specs", {
    id: `${name}:${version}`, name, version, digest: "hash", created_ms: version,
    body_json: JSON.stringify({ name, steps: [{ id: "step", skills: ["a"], together: true, expectTools: ["tool"] }] }),
  });
  const store = createFactStore([spec("flow", 1), spec("other", 3), spec("flow", 2)], { runtime });
  // When the versions requested by the dashboard are read.
  const versions = store.workflowSpecVersions("flow");
  // Then only matching versions are returned newest first, without lossy steps.
  assert.deepEqual(versions.map(v => v.version), [2, 1]);
  assert.deepEqual(versions[0].spec.steps, [{ id: "step", skills: ["a"], together: true, expectTools: ["tool"] }]);
  assert.deepEqual(activityQuerySchema.parse({ kind: "workflow-versions", name: "flow" }),
    { kind: "workflow-versions", name: "flow" });
  assert.equal(activityQuerySchema.safeParse({ kind: "skills", accountId: "foreign" }).success, false);
});
