// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

export const origin = "https://skillar.sh";
export const resource = `${origin}/mcp`;
export const hash = value => createHash("sha256").update(value).digest("hex");
export const browser = (account = "a", session = account) => ({
  kind: "browser", accountId: `account-${account}`, generation: 1,
  shardId: "activity-00", issuer: origin, scopes: ["skills:read", "skills:write"],
  sessionId: session.repeat(32), deviceId: null, tokenHash: null,
});
export const privateMcpAuthBindings = {
  // Miniflare 5 keys D1 by id; name alone gets a worker-specific default id.
  ACCOUNTS: { type: "d1", name: "private-mcp-auth-primary", id: "private-mcp-auth-primary" },
  OAUTH_KV: { type: "kv", id: "private-mcp-auth-oauth" },
  OAUTH_RATE_LIMITER: {
    type: "rate-limit", namespace: "1001", simple: { limit: 120, period: 60 },
  },
  PUBLIC_ORIGIN: { type: "text", value: origin },
  MCP_ENABLED: { type: "text", value: "true" },
};
const bundles = Promise.all([
  "../fixtures/private-mcp-auth.ts", "../../src/private-mcp/authorization-server.ts",
].map(path => build({
  entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  conditions: ["workerd", "worker", "browser"], external: ["cloudflare:*", "node:*"],
})));

async function migrate(db, name) {
  const sql = await readFile(new URL(`../../../site/migrations/${name}`, import.meta.url), "utf8");
  const statements = [];
  let current = "", trigger = false;
  for (const line of sql.replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim())); current = ""; trigger = false;
    }
  }
  assert.equal(current, "");
  await db.batch(statements);
}

// Additional workers may share privateMcpAuthBindings.ACCOUNTS/OAUTH_KV and bind
// AUTH to worker "private-mcp-authorization". This helper adds no resource server.
export async function createPrivateMcpAuthFixture(t, { workers = [] } = {}) {
  const [driver, auth] = await bundles;
  const env = privateMcpAuthBindings;
  const worker = (name, output, bindings) => ({ config: {
    type: "worker", name, compatibilityDate: "2026-09-03",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: output.outputFiles[0].text },
    } }, env: bindings,
  } });
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [
    worker("private-mcp-auth-driver", driver,
      { ...env, AUTH: { type: "worker", worker: "private-mcp-authorization" } }),
    worker("private-mcp-authorization", auth, env),
    ...workers,
  ] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("ACCOUNTS");
  for (const name of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql",
    "0004_account_events.sql", "0005_private_skills.sql", "0006_mcp_connections.sql"]) await migrate(db, name);
  for (const account of ["a", "b"]) {
    await db.batch([
      db.prepare("INSERT INTO users VALUES (?,?, 'Synthetic Google user','',0,0)")
        .bind(`google-${account}`, `${account}@example.invalid`),
      db.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)")
        .bind(`account-${account}`, `google-${account}`),
      db.prepare("INSERT INTO sessions VALUES (?,?,?)")
        .bind(account.repeat(32), `google-${account}`, Math.floor(Date.now() / 1000) + 3600),
    ]);
  }
  await db.prepare("INSERT INTO sessions VALUES (?, 'google-a', ?)")
    .bind("c".repeat(32), Math.floor(Date.now() / 1000) + 3600).run();
  const authDb = await runtime.getD1Database("ACCOUNTS", "private-mcp-authorization");
  assert.equal((await authDb.prepare("SELECT count(*) AS total FROM accounts").first()).total, 2);
  const call = async (operation, path = "/", options = {}) => {
    const response = await runtime.dispatchFetch("http://fixture.internal/", {
      method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, url: `${origin}${path}`, ...options }),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text,
      body: response.headers.get("content-type")?.includes("application/json") && text ? JSON.parse(text) : null };
  };
  const manage = (method, body, principal = browser(), path = "/api/mcp/connections", headers = {}) =>
    call("manage", path, { method, principal, headers: {
      origin, "content-type": "application/json", ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const pat = async (recordActivity = false) => {
    const response = await manage("POST", { name: "Native PAT", expiresInDays: 7, recordActivity });
    assert.equal(response.status, 201);
    return response.body;
  };
  const validate = async (token, operation = "validate", audience = resource) => {
    const response = await call(operation, "/", { token, resource: audience });
    assert.equal(response.status, 200, "private native validation RPC must complete successfully");
    assert.match(response.headers.get("content-type"), /application\/json/);
    return response.body;
  };
  const token = form => call("public", "/oauth/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString() });
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const frontendSend = (path, { principal = browser(), headers = {}, ...options } = {}) => {
    const pathname = new URL(path, origin).pathname;
    const operation = pathname === "/oauth/authorize" ? "authorize"
      : pathname.startsWith("/api/mcp/connections") ? "manage" : "public";
    return call(operation, path, { principal, ...options, headers: { origin, ...headers } });
  };
  return { runtime, primaryD1: db, db, call, frontendSend, manage, pat,
    authValidate: validate, validate, token, rows };
}
