import assert from "node:assert/strict";
import test from "node:test";
import {
  agentLabelOf, aggregateSkillActivity, changedBucket, readStateOf, skillIdFromUri,
} from "./activity-filters-core.ts";

const idA = "11223344-1122-4122-8122-112233445566";
const idB = "22446688-2244-4244-8244-224466887799";
const uriA = `skill://private/${idA}/${"a".repeat(64)}/SKILL.md`;
const uriAstorage = `skillar://private/${idA}/${"b".repeat(64)}/SKILL.md`;
const uriB = `skill://private/${idB}/${"c".repeat(64)}/SKILL.md`;

test("skill ids come only from private skill URIs, never from names", () => {
  assert.equal(skillIdFromUri(uriA), idA);
  assert.equal(skillIdFromUri(uriAstorage), idA);
  assert.equal(skillIdFromUri("skill://public/whatever/SKILL.md"), null);
  assert.equal(skillIdFromUri("file:///home/user/skills/x/SKILL.md"), null);
});

test("agent labels use recorded runtime, then recorded client_name, never a guessed product", () => {
  assert.equal(agentLabelOf({ runtime: "claude-code", state: "loaded", skills: [] }), "claude-code");
  assert.equal(agentLabelOf({ runtime: "unknown", state: "loaded", skills: [], clientName: "Senpai" }), "Senpai");
  assert.equal(agentLabelOf({ runtime: "unknown", state: "loaded", skills: [] }), "알 수 없음");
});

test("read state folds loaded over searched over unread across sessions", () => {
  const sessions = [
    { runtime: "codex", state: "exposed_only", skills: [uriA], exposed: [uriA, uriB] },
    { runtime: "unknown", state: "loaded", skills: [uriA], exposed: [], clientName: "MCP client" },
  ];
  const bySkill = aggregateSkillActivity(sessions, new Set([idA, idB]));
  assert.equal(readStateOf(bySkill.get(idA)), "read");
  assert.equal(readStateOf(bySkill.get(idB)), "searched");
  assert.equal(readStateOf(bySkill.get("11223344-1122-4122-8122-112233445599")), "unread");
  assert.deepEqual([...bySkill.get(idA).agents.keys()], ["MCP client"]);
});

test("legacy sessions without exposed still count the top candidate as searched", () => {
  const bySkill = aggregateSkillActivity(
    [{ runtime: "omo", state: "exposed_only", skills: [uriB] }], new Set([idB]));
  assert.equal(readStateOf(bySkill.get(idB)), "searched");
});

test("changed buckets follow KST calendar days, not rolling hours", () => {
  const now = Date.parse("2026-11-20T12:00:00+09:00");
  assert.equal(changedBucket(Date.parse("2026-11-20T00:30:00+09:00"), now), "7d");
  assert.equal(changedBucket(Date.parse("2026-11-14T00:00:00+09:00"), now), "7d");
  assert.equal(changedBucket(Date.parse("2026-11-13T23:59:59+09:00"), now), "30d");
  assert.equal(changedBucket(Date.parse("2026-10-22T00:00:00+09:00"), now), "30d");
  assert.equal(changedBucket(Date.parse("2026-10-21T23:59:59+09:00"), now), "older");
});
