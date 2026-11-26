import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { verify } from "../../scripts/verify.mjs";

const bun = process.execPath;
const expectedChecks = [
  ["shared", "bun", ["install", "--frozen-lockfile"]],
  ["shared", "bun", ["run", "build"]],
  ["shared", "bun", ["run", "test"]],
  ["server", "bun", ["install", "--frozen-lockfile"]],
  ["worker", "npm", ["ci"]],
  ["local", "bun", ["install", "--frozen-lockfile"]],
  ["site", "npm", ["ci"]],
  [".", bun, ["scripts/build-theme.mjs"]],
  ["server", "bun", ["run", "build"]],
  ["server", "bun", ["run", "test"]],
  [".", bun, ["server/bench/search.mjs", "--check"]],
  ["server", "bun", ["run", "build:codex-plugin"]],
  ["worker", "npm", ["run", "typecheck"]],
  ["worker", "npm", ["test"]],
  ["site", "npm", ["test"]],
  ["site", "npm", ["run", "build"]],
  [".", bun, ["scripts/check-team-plugin.mjs"]],
  ["local", "bun", ["run", "build"]],
  ["local", "bun", ["run", "typecheck"]],
  ["local", "bun", ["run", "test"]],
  [".", bun, ["local/bench/search.mjs", "--check"]],
  ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.team.jsonc", "--dry-run"]],
  ["worker", "npx", ["--no-install", "wrangler", "versions", "upload", "--dry-run"]],
  ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.oauth.jsonc", "--dry-run"]],
  ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.activity.jsonc", "--dry-run"]],
  ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.mcp-auth.jsonc", "--dry-run"]],
  ["worker", "npx", ["--no-install", "wrangler", "deploy", "--config", "wrangler.mcp.jsonc", "--dry-run"]],
];

test("shared verifier runs the CI checks from its supplied root", () => {
  const calls = [];
  assert.equal(verify({
    root: "/checkout",
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  }), expectedChecks.length);
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), expectedChecks.map(([, command, args]) => [command, args]));
  assert.deepEqual(calls.map(({ options }) => options.cwd), expectedChecks.map(([directory]) => resolve("/checkout", directory)));
  for (const { options } of calls) {
    assert.equal(options.stdio, "inherit");
    assert.equal(options.env.WRANGLER_SEND_METRICS, "false");
  }
});

test("shared verifier stops at the first failed check", () => {
  let calls = 0;
  assert.throws(() => verify({
    run: () => {
      calls += 1;
      return { status: calls === 2 ? 9 : 0 };
    },
  }), /bun run build failed \(9\)/);
  assert.equal(calls, 2);
});

test("shared verifier preserves a process-start error and stops immediately", () => {
  let calls = 0;
  const failure = Object.assign(new Error("missing executable"), { code: "ENOENT" });
  assert.throws(() => verify({ run: () => {
    calls += 1;
    return { error: failure, status: null };
  } }), error => error === failure);
  assert.equal(calls, 1);
});

test("runtime workflow invokes the shared verifier for main and dev source changes", () => {
  const workflow = parse(readFileSync(new URL("../../.github/workflows/runtime.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["main", "dev", "feat/dev-tools-mvp"]);
  for (const trigger of [workflow.on.push, workflow.on.pull_request]) assert.ok(trigger.paths.includes("scripts/**"));
  assert.equal(workflow.permissions.contents, "read");
  const [checkout, setupNode, setupBun, verifyStep] = workflow.jobs.runtime.steps;
  assert.equal(checkout.uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.equal(setupNode.uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.equal(setupNode.with.cache, "npm");
  assert.equal(setupNode.with["cache-dependency-path"], "worker/package-lock.json\nsite/package-lock.json\n");
  assert.equal(setupBun.uses, "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6");
  assert.equal(verifyStep.run, "bun scripts/verify.mjs");
  assert.equal(workflow.jobs.runtime.steps.length, 4);
});
