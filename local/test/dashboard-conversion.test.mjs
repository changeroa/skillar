// Unit tests for skill candidate counts and version digests (local/dashboard/views/conversion.ts).
// Run: node --test local/test/dashboard-conversion.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { PACKAGE_ROOT } from "./_helpers.mjs";

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("dashboard/views/conversion.ts", PACKAGE_ROOT))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { searchCandidateCounts, loadDigests } = await loadModule();

const step = (ts, kind, detail) => ({ ts, kind, summary: "", detail });

test("searchCandidateCounts counts each candidate uri once per search", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }, { uri: "skill://b" }] }),
    step(2000, "search", { traceId: "t2", candidates: [{ uri: "skill://a" }] }),
    step(3000, "load", { uri: "skill://b" }),
  ];
  assert.deepEqual([...searchCandidateCounts(steps)], [["skill://a", 2], ["skill://b", 1]]);
});

test("searchCandidateCounts dedupes repeated deliveries of the same search and skips tracked raw events", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(1001, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "skill_request", { operation: "search", status: "succeeded", requestId: "r1", total: 1, candidates: [{ uri: "skill://b" }] }),
    step(2001, "search", { requestId: "r1", candidates: [{ uri: "skill://b" }] }),
    step(3000, "skill_request", { operation: "search", status: "succeeded", requestId: "r2", total: 0 }),
  ];
  assert.deepEqual([...searchCandidateCounts(steps)], [["skill://a", 1], ["skill://b", 1]]);
});

test("searchCandidateCounts counts in_progress skill_request searches only after a result", () => {
  const steps = [
    step(1000, "skill_request", { operation: "search", status: "in_progress", requestId: "r1" }),
    step(1001, "skill_request", { operation: "search", status: "succeeded", requestId: "r1", total: 1, candidates: [{ uri: "skill://a" }] }),
  ];
  assert.deepEqual([...searchCandidateCounts(steps)], [["skill://a", 1]]);
});

test("loadDigests maps uri to manifestDigest from load steps", () => {
  const steps = [
    step(1000, "load", { uri: "skill://a", manifestDigest: "abc123" }),
    step(2000, "load", { uri: "skill://a", manifestDigest: "def456" }),
    step(3000, "load", { uri: "skill://b" }),
  ];
  const digests = loadDigests(steps);
  assert.equal(digests.get("skill://a"), "def456");
  assert.equal(digests.has("skill://b"), false);
});
