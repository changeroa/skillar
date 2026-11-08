import { z } from "zod";
import { consentSchema } from "../../../shared/activity-consent.ts";
import { contentKinds } from "../../../shared/activity-schema.ts";
import type { AccountId, DeviceId } from "../../../shared/activity-schema.ts";
import { hashContent, MAX_CONTENT_CHUNK_BYTES } from "../../../shared/activity-content.ts";
import type { ContentChunkRef } from "../../../shared/activity-content.ts";
import { summarizeSnapshot } from "../../../shared/activity-sync.ts";
import type { McpContext } from "../../../shared/mcp-auth.ts";
import { requireAuthority } from "../private-skills/authority.ts";
import { contentScope, requireContentConsent } from "../activity/content-consent.ts";
import type { ContentScopeInput } from "../activity/content-consent.ts";
import type { ContentEnv } from "../activity/content-env.ts";
import { storeContentChunk } from "../activity/content-objects.ts";
import { beginMigration, completeMigration, stageMigrationPage } from "../activity/migrations.ts";
import { ActivityLedgerError } from "../activity/types.ts";
import type { IngestPrincipal } from "../activity/types.ts";

/** now is epoch milliseconds; include these statements in the connection-creation batch. */
export function mcpSourceStatements(db: D1Database, input: {
  readonly accountId: AccountId; readonly deviceId: DeviceId;
  readonly recordActivity: boolean; readonly now: number;
}): D1PreparedStatement[] {
  const grant = consentSchema.parse(input.recordActivity ? {
    mode: "managed-content", version: 1, grantedAtMs: input.now,
    scope: { deviceId: input.deviceId, projectIds: [`device:${input.deviceId}`], rootIds: [] },
    serverProcessingAcknowledged: true, contentKinds,
  } : { mode: "local-only" });
  return [
    db.prepare(`INSERT INTO devices(account_id,device_id,created_at,revoked_at)
      SELECT account_id,?,?,NULL FROM accounts WHERE account_id=? AND state='active'`)
      .bind(input.deviceId, Math.floor(input.now / 1000), input.accountId),
    db.prepare(`INSERT INTO device_consents
      (account_id,device_id,generation,version,consent_json,granted_at_ms)
      SELECT account_id,?,auth_generation,1,?,? FROM accounts
      WHERE account_id=? AND state='active'`)
      .bind(input.deviceId, JSON.stringify(grant), input.now, input.accountId),
  ];
}

export function mcpIngestPrincipal(context: McpContext): IngestPrincipal {
  return { kind: "device", accountId: context.principal.accountId,
    deviceId: context.principal.deviceId, generation: context.principal.generation,
    shardId: context.principal.shardId, scopes: ["activity:read", "activity:ingest"] };
}

/** The primary authority is never inferred from the synthetic ingest principal. */
export async function requireMcpRecording(env: ContentEnv, context: McpContext) {
  if (!context.recordActivity || !context.principal.scopes.includes("skills:read")) {
    throw new ActivityLedgerError("forbidden");
  }
  await requireAuthority(env, context.principal, "skills:read");
  const p = context.principal;
  const row = await env.ACCOUNTS.prepare(`SELECT c.created_at,d.version,d.consent_json
    FROM mcp_connections c JOIN accounts a ON a.account_id=c.account_id
    JOIN devices v ON v.account_id=c.account_id AND v.device_id=c.device_id
    JOIN device_consents d ON d.account_id=c.account_id AND d.device_id=c.device_id
      AND d.generation=c.auth_generation
    WHERE c.connection_id=? AND c.account_id=? AND c.device_id=? AND c.auth_generation=?
      AND a.auth_generation=c.auth_generation AND a.state='active' AND a.shard_id=?
      AND c.revoked_at IS NULL AND v.revoked_at IS NULL AND c.expires_at>?
      AND c.record_activity=1
      AND EXISTS(SELECT 1 FROM json_each(c.scopes_json) WHERE value='activity:record')
      AND EXISTS(SELECT 1 FROM json_each(c.scopes_json) WHERE value='skills:read')
      AND (c.kind='pat' OR EXISTS(SELECT 1 FROM mcp_credentials t
        WHERE t.connection_id=c.connection_id AND t.token_hash=? AND t.kind='access'
          AND t.revoked_at IS NULL AND t.expires_at>?
          AND EXISTS(SELECT 1 FROM json_each(t.scopes_json) WHERE value='activity:record')))
    ORDER BY d.version DESC LIMIT 1`)
    .bind(p.connectionId, p.accountId, p.deviceId, p.generation, p.shardId,
      Math.floor(Date.now() / 1000), p.tokenHash, Math.floor(Date.now() / 1000)).first();
  if (row === null) throw new ActivityLedgerError("forbidden");
  const saved = z.object({ created_at: z.number(), version: z.number(), consent_json: z.string() }).parse(row);
  const consent = consentSchema.parse(JSON.parse(saved.consent_json));
  if (consent.mode !== "managed-content" || consent.version !== saved.version ||
      contentKinds.some(kind => !consent.contentKinds.includes(kind))) {
    throw new ActivityLedgerError("forbidden");
  }
  return consent;
}

/** Native writes retain their shard transaction fence and gain the primary MCP fence. */
export function mcpRecordingEnv(env: ContentEnv, context: McpContext, scope: ContentScopeInput): ContentEnv {
  const check = async () => {
    await requireMcpRecording(env, context);
    await requireContentConsent(env.ACCOUNTS, mcpIngestPrincipal(context), contentScope(scope, contentKinds));
  };
  return { ...env, ACTIVITY: new Proxy(env.ACTIVITY, {
    get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await check();
        return target.batch(statements);
      };
      if (key === "prepare") return (sql: string) => {
        const guard = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
          get(prepared, method) {
            if (method === "bind") return (...values: unknown[]) => guard(prepared.bind(...values));
            if (method === "run") return async () => { await check(); return prepared.run(); };
            const value = Reflect.get(prepared, method, prepared);
            return typeof value === "function" ? value.bind(prepared) : value;
          },
        });
        return guard(target.prepare(sql));
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) };
}

export async function uploadMcpContent(env: ContentEnv, principal: IngestPrincipal, input: {
  readonly scope: ContentScopeInput; readonly batchId: string; readonly revision: number;
  readonly value: unknown;
}) {
  const bytes = new TextEncoder().encode(JSON.stringify(input.value));
  const chunks: ContentChunkRef[] = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_CONTENT_CHUNK_BYTES) {
    const part = bytes.slice(offset, offset + MAX_CONTENT_CHUNK_BYTES);
    const ref = { index: chunks.length, revision: input.revision,
      plaintextHash: await hashContent(part), bytes: part.length };
    // Build base64 without spreading a full chunk onto the JS call stack.
    let binary = "";
    for (const byte of part) binary += String.fromCharCode(byte);
    await storeContentChunk(env, principal, { ...input.scope, schemaVersion: 2,
      sourceDomain: "mcp", generation: principal.generation, batchId: input.batchId,
      ...ref, body: btoa(binary) });
    chunks.push(ref);
  }
  return { chunks, contentHash: await hashContent(bytes), totalBytes: bytes.length };
}

export async function initializeMcpSource(env: ContentEnv, context: McpContext, scope: ContentScopeInput) {
  const principal = mcpIngestPrincipal(context);
  const existing = await env.ACTIVITY.prepare(`SELECT 1 FROM device_streams
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain='mcp'`)
    .bind(principal.accountId, principal.generation, principal.deviceId).first();
  if (existing !== null) return;
  const summary = await summarizeSnapshot([]);
  const reference = { deviceId: principal.deviceId, generation: principal.generation,
    sourceDomain: "mcp", snapshotId: context.principal.connectionId };
  const begin = { ...scope, ...reference, schemaVersion: 1, purpose: "initial",
    cut: 0, pageCount: 1, counts: summary.counts, snapshotHash: summary.snapshotHash };
  await beginMigration(env, principal, begin);
  const batchId = `${reference.snapshotId}:baseline`;
  const content = await uploadMcpContent(env, principal, {
    scope, batchId, revision: 0, value: { schemaVersion: 2, rows: [] },
  });
  await stageMigrationPage(env, principal, { ...reference, index: 0, batchId, ...content, counts: summary.counts });
  await completeMigration(env, principal, reference);
}
