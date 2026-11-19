import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { distImport, makeSandbox, PACKAGE_ROOT } from "./_helpers.mjs";

const { codexPack } = await distImport("packs/codex.js");
const { omoPack, resolveOmoAgentDir, resolveGajaeAgentDir } = await distImport("packs/omo.js");
const { gajaePack } = await distImport("packs/gajae.js");

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

function writeConfig(sb, body) {
  const path = join(sb.home, ".codex", "config.toml");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

const managedBlockOf = (plan, path) => {
  const f = plan.files.find((x) => x.path === path);
  assert.ok(f, `plan writes ${path}`);
  return f.after;
};

// --- defect 1: codex TOML unmanaged skillar table gets the omo remote policy ---

test("codex: hosted remote skillar table keeps registration, installs capture only", async () => {
  const sb = makeSandbox();
  try {
    const path = writeConfig(sb, `[mcp_servers.skillar]\nurl = "${HOSTED}"\n`);
    const plan = await codexPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0, "init must not abort");
    const after = managedBlockOf(plan, path);
    assert.ok(after.includes(`url = "${HOSTED}"`), "user's hosted registration kept");
    assert.ok(after.includes("[otel]"), "capture block installed");
    assert.ok(!after.includes("127.0.0.1:8799/mcp"), "no local registration added");
    assert.equal((after.match(/mcp_servers\.skillar/g) ?? []).length, 1, "no duplicate skillar table");
    assert.ok(plan.notes.some((n) => n.includes("skipping local daemon registration")), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("codex: hosted remote with trailing slash and mcp-remote argv both recognized", async () => {
  for (const body of [
    `[mcp_servers.skillar]\nurl = "${HOSTED}/"\n`,
    `[mcp_servers.skillar]\ncommand = "npx"\nargs = ["mcp-remote", "${HOSTED}"]\n`,
  ]) {
    const sb = makeSandbox();
    try {
      const path = writeConfig(sb, body);
      const plan = await codexPack.plan(ctxFor(sb));
      assert.equal(plan.conflicts.length, 0);
      assert.ok(plan.notes.some((n) => n.includes("skipping local daemon registration")), body);
      assert.ok(managedBlockOf(plan, path).includes("[otel]"));
    } finally { sb.cleanup(); }
  }
});

test("codex: a different remote MCP skips this runtime with a warning, no conflict", async () => {
  const sb = makeSandbox();
  try {
    writeConfig(sb, `[mcp_servers.skillar]\nurl = "${OTHER}"\n`);
    const plan = await codexPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0, "init must not abort");
    assert.equal(plan.files.length, 0);
    assert.ok(plan.notes.some((n) => n.startsWith("warning:") && n.includes(OTHER)), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("codex: an unmanaged loopback skillar table is still a conflict", async () => {
  const sb = makeSandbox();
  try {
    writeConfig(sb, `[mcp_servers.skillar]\nurl = "http://127.0.0.1:8799/mcp"\n`);
    const plan = await codexPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].code, "unmanaged_skillar_mcp");
  } finally { sb.cleanup(); }
});

test("codex: gisool-named hosted remote table gets the same policy", async () => {
  const sb = makeSandbox();
  try {
    const path = writeConfig(sb, `[mcp_servers.gisool]\nurl = "${HOSTED}"\n`);
    const plan = await codexPack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.ok(plan.notes.some((n) => n.includes("skipping local daemon registration")), plan.notes.join(" | "));
    assert.ok(managedBlockOf(plan, path).includes("[otel]"));
  } finally { sb.cleanup(); }
});

test("codex: re-init replaces an old local managed block with capture-only when remote appeared", async () => {
  const sb = makeSandbox();
  try {
    const path = writeConfig(sb, `[mcp_servers.skillar]\nurl = "${HOSTED}"\n`);
    const first = await codexPack.plan(ctxFor(sb));
    writeConfig(sb, managedBlockOf(first, path));
    const second = await codexPack.plan(ctxFor(sb));
    assert.equal(second.conflicts.length, 0);
    assert.ok(second.notes.some((n) => n.includes("skipping local daemon registration")));
  } finally { sb.cleanup(); }
});

// --- defect 2: an overridden HOME isolates runtime detection from real-shell env redirects ---

test("omo: runtime-dir env vars must not escape an overridden HOME", () => {
  const outside = join(homedir(), ".omo", "agent");
  for (const name of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) {
    const dir = resolveOmoAgentDir("/tmp/skillar-sandbox-home", { [name]: outside });
    assert.equal(dir, join("/tmp/skillar-sandbox-home", ".omo", "agent"), `${name} escaped the HOME override`);
  }
});

test("omo: isolation holds when $HOME itself is the override (homedir() follows $HOME)", () => {
  // The real CLI condition: the process runs with HOME=<sandbox>, so os.homedir() returns the
  // sandbox too; comparing against os.homedir() would wrongly conclude "not redirected".
  const sandboxHome = "/tmp/skillar-sandbox-home";
  const original = process.env.HOME;
  process.env.HOME = sandboxHome;
  try {
    const dir = resolveOmoAgentDir(sandboxHome, { PI_CODING_AGENT_DIR: join(userInfo().homedir, ".omo", "agent") });
    assert.equal(dir, join(sandboxHome, ".omo", "agent"));
  } finally {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
  }
});

test("omo: runtime-dir env vars still win when HOME is the real home", () => {
  const custom = join(homedir(), "custom-omo-profile");
  assert.equal(resolveOmoAgentDir(homedir(), { OMO_CODING_AGENT_DIR: custom }), custom);
});

test("gajae: runtime-dir env vars must not escape an overridden HOME", () => {
  const outside = join(homedir(), ".gjc", "agent");
  for (const env of [{ GJC_CODING_AGENT_DIR: outside }, { PI_CODING_AGENT_DIR: outside }, { GJC_CONFIG_DIR: "custom" }]) {
    const dir = resolveGajaeAgentDir("/tmp/skillar-sandbox-home", env);
    assert.ok(dir.startsWith("/tmp/skillar-sandbox-home"), `${JSON.stringify(env)} escaped the HOME override: ${dir}`);
  }
});

test("gajae: same hosted-remote policy as omo (shared pi pack)", async () => {
  const sb = makeSandbox();
  try {
    const mcpPath = join(sb.home, ".gjc", "agent", "mcp.json");
    mkdirSync(dirname(mcpPath), { recursive: true });
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { skillar: { url: HOSTED } } }));
    const plan = await gajaePack.plan(ctxFor(sb));
    assert.equal(plan.conflicts.length, 0);
    assert.ok(!plan.files.some((f) => f.path.endsWith("mcp.json")));
    assert.ok(plan.files.some((f) => f.path.endsWith(join("extensions", "skillar", "index.js"))));
    assert.ok(plan.notes.some((n) => n.includes("skipping local daemon registration")), plan.notes.join(" | "));
  } finally { sb.cleanup(); }
});

test("omo: init detection stays inside the sandbox HOME end to end", async () => {
  const sb = makeSandbox();
  try {
    // Real-shell redirect pointing at the real home; an overridden HOME must not follow it.
    const env = { ...sb.env, PI_CODING_AGENT_DIR: join(homedir(), ".omo", "agent") };
    const plan = await omoPack.plan(ctxFor(sb, { env }));
    for (const f of plan.files) assert.ok(f.path.startsWith(sb.home), `escaped HOME: ${f.path}`);
  } finally { sb.cleanup(); }
});
