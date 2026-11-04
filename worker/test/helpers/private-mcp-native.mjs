// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import {
  createPrivateMcpAuthFixture, privateMcpAuthBindings, browser, origin,
} from "./private-mcp-auth.mjs";

export const skillId = "1381f285-e3d8-49c2-9c51-228f1d852998";
const version = "2026-07-28";
const bundles = Promise.all(["../fixtures/private-mcp-native.ts", "../../src/private-mcp/resource-server.ts"].map(path =>
  build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, write: false,
    platform: "browser", format: "esm", target: "es2022", conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*", "node:*"] })));

async function migrate(db, name) {
  const sql = await readFile(new URL(`../../activity-migrations/${name}`, import.meta.url), "utf8");
  let current = "", trigger = false;
  const statements = [];
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
export async function createPrivateMcpNativeFixture(t) {
  const [activity, resource] = await bundles;
  const worker = (name, bundle, env, exports = {}) => ({ config: {
    type: "worker", name, compatibilityDate: "2026-09-03", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": {
      type: "esm", contents: bundle.outputFiles[0].text,
    } } }, env, exports,
  } });
  const f = await createPrivateMcpAuthFixture(t, { workers: [
    worker("private-mcp-native-activity", activity, {
      ...privateMcpAuthBindings,
      ACTIVITY: { type: "d1", name: "native-mcp-activity", id: "native-mcp-activity" },
      ACTIVITY_RAW: { type: "r2", name: "native-mcp-bytes" },
      CONTENT_KEYRING: { type: "text", value: JSON.stringify({
        current: 1, keys: { 1: Buffer.alloc(32, 7).toString("base64url") },
      }) },
      GOOGLE_CLIENT_ID: { type: "text", value: "synthetic-client" },
      GOOGLE_CLIENT_SECRET: { type: "text", value: "synthetic-secret" },
      SESSION_KEY: { type: "text", value: "synthetic-session-signing-key-32-characters" },
      MCP_AUTH: { type: "worker", worker: "private-mcp-authorization" },
      MCP_RESOURCE: { type: "worker", worker: "private-mcp-native-resource" },
      ACTIVITY_SERVICE: { type: "worker", worker: "private-mcp-native-activity" },
      ACTIVITY_ENABLED: { type: "text", value: "true" },
      PRIVATE_SKILLS_ENABLED: { type: "text", value: "true" },
      ACTIVITY_INGEST_ENABLED: { type: "text", value: "true" },
      PRIVATE_SKILL_CATALOG: { type: "durable-object", worker: "private-mcp-native-activity", exportName: "PrivateSkillCatalog" },
      ACCOUNT_HUB: { type: "durable-object", worker: "private-mcp-native-activity", exportName: "AccountHub" },
      RESOURCE: { type: "worker", worker: "private-mcp-native-resource" },
    }, { PrivateSkillCatalog: { type: "durable-object", storage: "sqlite" },
      AccountHub: { type: "durable-object", storage: "sqlite" } }),
    worker("private-mcp-native-resource", resource, {
      PUBLIC_ORIGIN: privateMcpAuthBindings.PUBLIC_ORIGIN, MCP_ENABLED: privateMcpAuthBindings.MCP_ENABLED,
      MCP_AUTH: { type: "worker", worker: "private-mcp-authorization" },
      ACTIVITY_SERVICE: { type: "worker", worker: "private-mcp-native-activity" },
    }),
  ] });
  const db = await f.runtime.getD1Database("ACTIVITY", "private-mcp-native-activity");
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql",
    "0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql", "0007_account_events.sql",
    "0008_private_skill_notifications.sql"]) await migrate(db, name);
  const driver = await f.runtime.getWorker("private-mcp-native-activity");
  const rawForward = (target, url, { method = "POST", headers = {}, body } = {}) =>
    driver.fetch("https://fixture.internal/__test/forward", { method: "POST", redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, url, method, headers,
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }),
    });
  const forward = async (target, url, options) => {
    const response = await rawForward(target, url, options);
    const text = await response.text();
    const messages = response.headers.get("content-type")?.includes("text/event-stream") ?
      text.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))) :
      text ? [JSON.parse(text)] : [];
    return { status: response.status, headers: response.headers, body: messages.at(-1), messages };
  };
  const api = (path, method, body, principal = browser()) => forward("activity",
    `https://activity.internal/v1/private-skills${path}`, { method, body, headers: {
      "content-type": "application/json", "x-skillar-principal": JSON.stringify(principal),
    } });
  let id = 0;
  const mcp = (token, method, params = {}, { legacy = false, headers = {} } = {}) => {
    const completeParams = legacy ? params : { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": version,
      "io.modelcontextprotocol/clientInfo": { name: "Native parity client", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {}, ...params._meta,
    } };
    return forward("resource", `${origin}/mcp`, { headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`, ...(legacy ? {} : { "MCP-Protocol-Version": version,
        "Mcp-Method": method, ...(method === "tools/call" ? { "Mcp-Name": params.name } :
          method === "resources/read" ? { "Mcp-Name": params.uri } : {}) }), ...headers,
    }, body: { jsonrpc: "2.0", id: ++id, method, params: completeParams } });
  };
  return { ...f, db, driver, rawForward, forward, api, mcp,
    publish: (packet, base = null, principal = browser(), id = skillId) =>
      api(`/${id}/versions`, "POST", { acknowledgePrivateUpload: true, package: packet, base }, principal),
  };
}
