import assert from "node:assert/strict";
import { test } from "node:test";
import { distImport } from "./_helpers.mjs";

const { assertBunVersion, assertPlatform } = await distImport("version.js");
const code = (c) => (error) => error.code === c;

test("assertBunVersion enforces >= 1.4.5", () => {
  assert.doesNotThrow(() => assertBunVersion("1.4.5"));
  assert.doesNotThrow(() => assertBunVersion("2.0.0"));
  assert.throws(() => assertBunVersion("1.4.4"), code("bun_too_old"));
  assert.throws(() => assertBunVersion("1.3.14"), code("bun_too_old"));
});

test("assertPlatform rejects win32 only", () => {
  assert.doesNotThrow(() => assertPlatform("darwin"));
  assert.doesNotThrow(() => assertPlatform("linux"));
  assert.throws(() => assertPlatform("win32"), code("unsupported_platform"));
});

test("contracted entry modules exist in dist and export their functions", async () => {
  const contracts = [
    ["server.js", ["startServer"]],
    ["mcp/stdio-proxy.js", ["runStdioProxy"]],
    ["cli/export-import.js", ["runExport", "runImport"]],
    ["cli/eval.js", ["runEval"]],
  ];
  for (const [path, names] of contracts) {
    const mod = await distImport(path);
    for (const name of names) assert.equal(typeof mod[name], "function", `${path} exports ${name}`);
  }
});
