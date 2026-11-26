import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { openDb, SCHEMA_VERSION } from "./dist/store/db.js";

const executable = resolve(process.argv[2] ?? "dist/sidecars/darwin-arm64/skillar");
const home = await mkdtemp(join(tmpdir(), "skillar-sidecar-"));
const state = join(home, ".skillar");
const dbPath = join(state, "skillar.db");
let child;
try {
  const root = join(home, "skills");
  await mkdir(join(root, "sidecar-smoke"), { recursive: true });
  await mkdir(state);
  await writeFile(join(root, "sidecar-smoke/SKILL.md"), "---\nname: sidecar-smoke\ndescription: Sidecar smoke test fixture\n---\n");
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop();
  await writeFile(join(state, "config.json"), JSON.stringify({ port, roots: [{ id: "smoke", path: root }] }));
  const original = process.argv[3];
  if (original) await copyFile(original, dbPath);
  else {
    using db = openDb(dbPath);
    db.prepare("INSERT INTO sessions(id, runtime, started_at) VALUES ('sidecar-existing', 'codex', 5)").run();
  }
  function databaseState() {
    using db = new Database(dbPath);
    return {
      version: db.query("PRAGMA user_version").get().user_version,
      integrity: db.query("PRAGMA integrity_check").get().integrity_check,
      sessions: db.query("SELECT id FROM sessions ORDER BY id").values(),
    };
  }
  const before = databaseState();
  assert.equal(before.version, SCHEMA_VERSION);
  assert.equal(before.integrity, "ok");
  assert.ok(before.sessions.length > 0);
  // A paused synthetic connection starts the embedded Worker without making a network request.
  await mkdir(join(state, "cloud"));
  await writeFile(join(state, "cloud/control.json"), JSON.stringify({ paused: true }));
  await writeFile(join(state, "cloud/connection.json"), JSON.stringify({
    version: 1, instanceId: crypto.randomUUID(), origin: "https://fixture.invalid",
    accountId: "fixture", deviceId: "fixture", generation: 1, token: "A".repeat(43),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }));
  const env = { HOME: home, SKILLAR_HOME: state, SKILLAR_HERDR: "off", SKILLAR_NO_CLI: "1", PATH: "/usr/bin:/bin" };
  child = Bun.spawn([executable, "serve"], { cwd: home, env, stdout: "inherit", stderr: "inherit" });
  const origin = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    const res = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (res?.ok) { health = await res.json(); break; }
    await Bun.sleep(50);
  }
  assert.equal(health?.ok, true);
  console.log(`healthz 200: ${JSON.stringify(health)}`);
  const token = (await readFile(join(state, "token"), "utf8")).trim();
  const auth = { Authorization: `Bearer ${token}` };
  for (const path of ["/", "/assets/styles.css"]) {
    const response = await fetch(origin + path, { headers: auth, signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0, path);
    console.log(`dashboard ${path}: 200`);
  }
  const response = await fetch(`${origin}/mcp`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "search_skills" },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "search_skills", arguments: { query: "sidecar smoke test fixture" },
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "sidecar-smoke", version: "1" } },
    } }),
  });
  assert.equal(response.status, 200);
  const rpc = await response.json();
  const result = JSON.parse(rpc.result.content[0].text);
  assert.equal(result.candidates[0].name, "sidecar-smoke");
  console.log(`MCP search_skills 200: ${result.candidates[0].name}`);
  const statusPath = join(state, "cloud/status.json");
  const deadline = Date.now() + 3000;
  while (!(await Bun.file(statusPath).exists()) && Date.now() < deadline) await Bun.sleep(25);
  assert.equal(JSON.parse(await readFile(statusPath, "utf8")).phase, "paused");
  console.log("embedded cloud worker: paused (no network)");
  assert.deepEqual(databaseState(), before);
  console.log(`SQLite integrity=ok; schema=${before.version}; ${before.sessions.length} existing session(s) preserved`);
} finally {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { await child.exited; } finally { clearTimeout(force); }
  }
  await rm(home, { recursive: true, force: true });
}
