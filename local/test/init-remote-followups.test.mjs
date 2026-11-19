import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distImport, makeSandbox, makeTempDir, PACKAGE_ROOT, removeDir } from "./_helpers.mjs";

const { omoPack } = await distImport("packs/omo.js");
const { geminiPack } = await distImport("packs/gemini.js");
const { cursorPack } = await distImport("packs/cursor.js");
const { claudeCodePack } = await distImport("packs/claude-code.js");
const { planService, nodePath, packageRoot, writeConfigPort } = await distImport("cli/serve.js");

const root = fileURLToPath(PACKAGE_ROOT).replace(/\/$/, "");
const HOSTED = "https://skillar.sh/mcp";
const OTHER = "https://other.example/mcp";
const TOKEN = "t".repeat(64);

function ctxFor(sb, overrides = {}) {
  return {
    home: sb.home,
    env: sb.env,
    port: 8799,
    token: TOKEN,
    nodePath: "/usr/local/bin/node",
    packageRoot: root,
    disableRemote: false,
    ...overrides,
  };
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

const hostedMcpRemote = { command: "npx", args: ["mcp-remote", HOSTED] };
const otherMcpRemote = { command: "npx", args: ["mcp-remote", OTHER] };
const registeredNote = (plan) => plan.notes.some((n) => n.includes("skipping local daemon registration"));
const warningNote = (plan, url) => plan.notes.some((n) => n.startsWith("warning:") && n.includes(url));

// --- defect 1: a hosted remote skillar registration no longer aborts init ---

test("omo: hosted remote registration keeps capture install, skips re-register", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".omo/agent/mcp.json"), { mcpServers: { skillar: hostedMcpRemote } });
    const plan = await omoPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.ok(!plan.files.some((f) => f.path.endsWith("mcp.json")), "mcp.json untouched");
    assert.ok(plan.files.some((f) => f.path.endsWith(join("extensions", "skillar", "index.js"))), "capture extension still installed");
    assert.ok(registeredNote(plan), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("omo: a different remote MCP skips this runtime with a warning, no conflict", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".omo/agent/mcp.json"), { mcpServers: { skillar: otherMcpRemote } });
    const plan = await omoPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0, "init must not abort");
    assert.equal(plan.files.length, 0);
    assert.ok(warningNote(plan, OTHER), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("omo: a loopback skillar URL is treated as a local registration", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".omo/agent/mcp.json"), { mcpServers: { skillar: { url: "http://127.0.0.1:8799/mcp" } } });
    const plan = await omoPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    const mcp = plan.files.find((f) => f.path.endsWith("mcp.json"));
    assert.ok(mcp, "local registration planned");
    assert.ok(mcp.after.includes("127.0.0.1:8799"));
  } finally { sb.cleanup(); }
});

test("gemini: hosted remote registration keeps hooks install, skips re-register", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".gemini/settings.json"), { mcpServers: { skillar: { httpUrl: HOSTED } }, hooks: {} });
    const plan = await geminiPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    const file = plan.files.find((f) => f.path.endsWith("settings.json"));
    assert.ok(file, "settings.json still planned for hooks");
    const after = JSON.parse(file.after);
    assert.equal(after.mcpServers.skillar.httpUrl, HOSTED, "remote registration kept");
    assert.ok(!Object.values(after.mcpServers).some((s) => JSON.stringify(s).includes("127.0.0.1")), "no local registration added");
    assert.ok(Object.keys(after.hooks).length > 0, "capture hooks still installed");
    assert.ok(registeredNote(plan), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("gemini: a different remote MCP skips this runtime with a warning", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".gemini/settings.json"), { mcpServers: { skillar: { httpUrl: OTHER } }, hooks: {} });
    const plan = await geminiPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.files.length, 0);
    assert.ok(warningNote(plan, OTHER), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("cursor: hosted remote registration keeps hooks install, skips re-register", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".cursor/mcp.json"), { mcpServers: { skillar: { url: HOSTED } } });
    const plan = await cursorPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.ok(!plan.files.some((f) => f.path.endsWith("mcp.json")), "mcp.json untouched");
    assert.ok(plan.files.some((f) => f.path.endsWith("hooks.json")), "capture hooks still installed");
    assert.ok(registeredNote(plan), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("cursor: a different remote MCP skips this runtime with a warning", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".cursor/mcp.json"), { mcpServers: { skillar: { url: OTHER } } });
    const plan = await cursorPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.files.length, 0);
    assert.ok(warningNote(plan, OTHER), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("claude-code: hosted remote registration keeps hooks install, skips mcp add", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".claude.json"), { mcpServers: { skillar: { type: "http", url: HOSTED } } });
    const plan = await claudeCodePack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.ok(plan.files.length > 0, "hook settings still installed");
    assert.equal(plan.commands.length, 0, "no claude mcp add");
    assert.ok(!plan.notes.some((n) => n.includes("claude mcp add")), "no manual mcp add step");
    assert.ok(registeredNote(plan), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("claude-code: a different remote MCP skips this runtime with a warning", async () => {
  const sb = makeSandbox();
  try {
    writeJson(join(sb.home, ".claude.json"), { mcpServers: { skillar: { type: "http", url: OTHER } } });
    const plan = await claudeCodePack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0, "init must not abort");
    assert.equal(plan.files.length, 0);
    assert.equal(plan.commands.length, 0);
    assert.ok(warningNote(plan, OTHER), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("claude-code: without a remote registration the mcp add step is still planned", async () => {
  const sb = makeSandbox();
  try {
    const plan = await claudeCodePack.plan(ctxFor(sb));
    assert.ok(plan.notes.some((n) => n.includes("claude mcp add")), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

// --- defect 2: service units pass HOME so daemon runtime detection sees the invoking user's home ---

test("systemd unit passes HOME and SKILLAR_HOME to the daemon", () => {
  const home = "/tmp/skillar user home";
  const plan = planService({ home, skillarHome: join(home, ".skillar"), env: { SKILLAR_NO_CLI: "1" }, nodePath: nodePath(), packageRoot: packageRoot(), platform: "linux", uid: 1000 });
  assert.ok(plan.file.after.includes(`Environment="HOME=${home}"`), plan.file.after);
  assert.ok(plan.file.after.includes(`Environment="SKILLAR_HOME=${join(home, ".skillar")}"`), plan.file.after);
});

test("launchd plist passes HOME and SKILLAR_HOME to the daemon", () => {
  const home = "/tmp/skillar user home";
  const plan = planService({ home, skillarHome: join(home, ".skillar"), env: { SKILLAR_NO_CLI: "1" }, nodePath: nodePath(), packageRoot: packageRoot(), platform: "darwin", uid: 501 });
  assert.ok(plan.file.after.includes("<key>HOME</key>"), plan.file.after);
  assert.ok(plan.file.after.includes(`<string>${home}</string>`), plan.file.after);
  assert.ok(plan.file.after.includes("<key>SKILLAR_HOME</key>"), plan.file.after);
});

// --- defect 3: an explicit --port is persisted so open --print targets the running daemon ---

test("writeConfigPort persists the port without dropping other config keys", () => {
  const dir = makeTempDir("skillar-config-");
  try {
    writeJson(join(dir, "config.json"), { token: "tok-abc", port: 8799 });
    writeConfigPort(dir, 9911);
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    assert.equal(cfg.port, 9911);
    assert.equal(cfg.token, "tok-abc");
  } finally { removeDir(dir); }
});
