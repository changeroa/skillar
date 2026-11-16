// Unit tests for 후보→읽기 전환 attribution (local/dashboard/views/conversion.ts).
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

const { searchLoadConversion, loadDigests } = await loadModule();

const step = (ts, kind, detail) => ({ ts, kind, summary: "", detail });

test("raw search with candidates followed by a candidate load counts as converted", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }, { uri: "skill://b" }] }),
    step(2000, "load", { uri: "skill://b", manifestDigest: "deadbeefcafe" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 1 });
});

test("load before the search does not convert", () => {
  const steps = [
    step(1000, "load", { uri: "skill://a" }),
    step(2000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 0 });
});

test("loading a URI outside the candidates does not convert", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://other" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 0 });
});

test("search with empty candidates is not counted at all", () => {
  const steps = [step(1000, "search", { traceId: "t1", candidates: [] })];
  assert.deepEqual(searchLoadConversion(steps), { searches: 0, converted: 0 });
});

test("duplicate search events for the same traceId count once", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(1100, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 1 });
});

test("raw event skipped when a skill_request tracks its requestId", () => {
  const steps = [
    step(1000, "skill_request", { operation: "search", status: "succeeded", requestId: "r1", traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(1000, "search", { requestId: "r1", traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 1 });
});

test("wrapped skill_request search counts via candidates, wrapped load must succeed", () => {
  const steps = [
    step(1000, "skill_request", { operation: "search", status: "succeeded", requestId: "r1", traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(1500, "skill_request", { operation: "load", status: "failed", requestId: "r2", uri: "skill://a" }),
    step(2000, "skill_request", { operation: "load", status: "succeeded", requestId: "r3", uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 1 });
});

test("in-progress wrapped search does not count", () => {
  const steps = [
    step(1000, "skill_request", { operation: "search", status: "in_progress", requestId: "r1", traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 0, converted: 0 });
});

test("each search counts at most once even with many matching loads", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
    step(3000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 1 });
});

test("two searches convert independently by time order", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
    step(3000, "search", { traceId: "t2", candidates: [{ uri: "skill://b" }] }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 2, converted: 1 });
});

test("one load is never attributed to two searches (same skill searched twice, loaded once)", () => {
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "search", { traceId: "t2", candidates: [{ uri: "skill://a" }] }),
    step(3000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 2, converted: 1 });
});

test("a load that already happened does not convert a later search; a later load does", () => {
  const steps = [
    step(1000, "load", { uri: "skill://a" }),
    step(2000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 1, converted: 0 });
  const steps2 = [...steps, step(3000, "load", { uri: "skill://a" })];
  assert.deepEqual(searchLoadConversion(steps2), { searches: 1, converted: 1 });
});

test("the later search owns the shared load, leaving the earlier one unconverted", () => {
  // t1 → load a → t2(candidates a) → load a: both loads resolve, t2 gets only the later load.
  const steps = [
    step(1000, "search", { traceId: "t1", candidates: [{ uri: "skill://a" }] }),
    step(2000, "load", { uri: "skill://a" }),
    step(3000, "search", { traceId: "t2", candidates: [{ uri: "skill://a" }] }),
    step(4000, "load", { uri: "skill://a" }),
  ];
  assert.deepEqual(searchLoadConversion(steps), { searches: 2, converted: 2 });
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
