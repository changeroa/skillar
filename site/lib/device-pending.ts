import { z } from "zod";
import { pkceChallenge, randomToken } from "./auth.ts";
import { ACTIVITY_AUDIENCE, connectorScopeSchema } from "./activity-auth.ts";
import type { ActivityEnv, BrowserPrincipal } from "./activity-auth.ts";
import { consentSchema } from "../../shared/dist/activity-consent.js";
import { contentKindSchema } from "../../shared/dist/activity-schema.js";
import {
  PENDING_CODE_RETENTION_SECONDS, SWEEP_PENDING_CODES_SQL,
} from "../../shared/activity-pending.ts";

export const PENDING_CODE_TTL_SECONDS = 600;
export const PENDING_POLL_INTERVAL_SECONDS = 5;
const MAX_FAILED_APPROVALS = 5;
// App-level guessing limits for the browser approve endpoint: per-account and
// per-IP attempts per one-minute bucket, counted in D1 rows (hashed subjects).
const APPROVE_ACCOUNT_LIMIT = 10;
const APPROVE_IP_LIMIT = 60;
const ATTEMPT_WINDOW_SECONDS = 60;
const ATTEMPT_ROW_RETENTION_SECONDS = 3600;
// Short-lived, single-use: the CLI redeems the grant once through the existing
// /v1/devices/exchange boundary, which mints the long-lived token.
const GRANT_TTL_SECONDS = 600;
// 40-bit, Crockford base32 (no I/L/O/U look-alikes). Displayed XXXX-XXXX.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const createSchema = z.strictObject({
  deviceLabel: z.string().min(1).max(120),
  scopes: z.array(connectorScopeSchema).min(1).max(4).readonly(),
});
const pollSchema = z.strictObject({ pollToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
// The browser submits only the user's choice; the server builds the consent
// record itself because the device id (and its derived project id) is minted
// here. The record never exists before this explicit submission (default off).
const consentChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("metadata") }),
  z.strictObject({ mode: z.literal("managed-content"),
    contentKinds: z.array(contentKindSchema).min(1).max(7).readonly(),
    serverProcessingAcknowledged: z.literal(true) }),
]);
const approveSchema = z.strictObject({
  code: z.string().min(8).max(16),
  consent: consentChoiceSchema.optional(),
});
const deviceScopes = createSchema.shape.scopes;
// Same scopes re-validation the grant exchange applies inside the atomic write.
const pendingScopes = `json_valid(p.scopes_json)
  AND json_type(CASE WHEN json_valid(p.scopes_json) THEN p.scopes_json ELSE 'null' END)='array'
  AND json_array_length(CASE WHEN json_valid(p.scopes_json) THEN p.scopes_json ELSE '[]' END)>0
  AND NOT EXISTS (SELECT 1 FROM json_each(
    CASE WHEN json_valid(p.scopes_json) THEN p.scopes_json ELSE '[]' END)
    WHERE type!='text' OR value NOT IN ('activity:read','activity:ingest','skills:read','skills:write'))`;
const liveApproval = `SELECT 1 FROM accounts a JOIN sessions s ON s.user_sub=a.user_sub
  WHERE a.account_id=? AND a.auth_generation=? AND a.state='active'
  AND s.id=? AND s.expires_at>?`;

function userCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out = CODE_ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function normalizeCode(code: string): string | null {
  const bare = code.replaceAll("-", "").toUpperCase();
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(bare) ? bare : null;
}

export type PendingIssue = {
  readonly userCode: string; readonly pollToken: string;
  readonly expiresIn: number; readonly pollInterval: number;
};

export async function createPendingCode(input: unknown, env: ActivityEnv): Promise<PendingIssue> {
  const request = createSchema.parse(input);
  const code = userCode();
  const pollToken = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await env.ACCOUNTS.prepare(`INSERT INTO device_pending_codes
    (code_hash,poll_hash,device_label,scopes_json,created_at,expires_at)
    VALUES(?,?,?,?,?,?)`)
    .bind(await pkceChallenge(code.replace("-", "")), await pkceChallenge(pollToken),
      request.deviceLabel, JSON.stringify(request.scopes), now, now + PENDING_CODE_TTL_SECONDS)
    .run();
  return {
    userCode: code, pollToken,
    expiresIn: PENDING_CODE_TTL_SECONDS, pollInterval: PENDING_POLL_INTERVAL_SECONDS,
  };
}

export type PendingSummary = {
  readonly deviceLabel: string; readonly scopes: readonly string[]; readonly expiresAt: number;
};

export async function readPendingCode(code: string, env: ActivityEnv): Promise<PendingSummary | null> {
  const bare = normalizeCode(code);
  if (bare === null) return null;
  const row = await env.ACCOUNTS.prepare(`SELECT device_label AS deviceLabel,
    scopes_json AS scopesJson, expires_at AS expiresAt FROM device_pending_codes
    WHERE code_hash=? AND expires_at>? AND approved_at IS NULL AND failed_attempts<?`)
    .bind(await pkceChallenge(bare), Math.floor(Date.now() / 1000), MAX_FAILED_APPROVALS).first();
  if (row === null) return null;
  const parsed = z.object({ deviceLabel: z.string(), scopesJson: z.string(), expiresAt: z.number() })
    .parse(row);
  return {
    deviceLabel: parsed.deviceLabel,
    scopes: deviceScopes.parse(JSON.parse(parsed.scopesJson)),
    expiresAt: parsed.expiresAt,
  };
}

export type ApproveOutcome =
  | { readonly kind: "approved"; readonly deviceId: string }
  | { readonly kind: "unknown" }
  | { readonly kind: "conflict" }
  | { readonly kind: "limited" };

/** Counts one approve attempt for the account and the client IP; true when either is over its per-minute limit. */
async function countApproveAttempt(env: ActivityEnv, accountId: string, clientIp: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % ATTEMPT_WINDOW_SECONDS);
  const subjects = [`acct:${accountId}`, `ip:${await pkceChallenge(clientIp)}`];
  const limits = [APPROVE_ACCOUNT_LIMIT, APPROVE_IP_LIMIT];
  const results = await env.ACCOUNTS.batch(subjects.map(subject =>
    env.ACCOUNTS.prepare(`INSERT INTO device_pending_attempts(subject,window_start,attempts)
      VALUES(?,?,1)
      ON CONFLICT(subject,window_start) DO UPDATE SET attempts=attempts+1
      RETURNING attempts`).bind(subject, window)));
  return results.some((result, index) =>
    z.object({ attempts: z.number() }).parse(result?.results[0]).attempts > (limits[index] ?? 0));
}

export async function approvePendingCode(
  principal: BrowserPrincipal, input: unknown, env: ActivityEnv, clientIp = "unknown",
): Promise<ApproveOutcome> {
  const request = approveSchema.parse(input);
  if (await countApproveAttempt(env, principal.accountId, clientIp)) return { kind: "limited" };
  const bare = normalizeCode(request.code);
  if (bare === null) return { kind: "unknown" };
  const hash = await pkceChallenge(bare);
  const now = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const row = await env.ACCOUNTS.prepare(`SELECT scopes_json AS scopesJson FROM device_pending_codes
    WHERE code_hash=? AND expires_at>? AND approved_at IS NULL AND failed_attempts<?`)
    .bind(hash, now, MAX_FAILED_APPROVALS).first();
  if (row === null) return { kind: "unknown" };
  deviceScopes.parse(JSON.parse(z.object({ scopesJson: z.string() }).parse(row).scopesJson));
  const deviceId = randomToken();
  const live = [principal.accountId, principal.generation, principal.sessionId, now];
  const statements = [
    // Conditional on the request still being approvable so a lost race inserts
    // nothing — the batch has no rollback, every statement guards itself.
    env.ACCOUNTS.prepare(`INSERT INTO devices(account_id,device_id,created_at)
      SELECT ?,?,? WHERE EXISTS (${liveApproval})
      AND EXISTS (SELECT 1 FROM device_pending_codes
        WHERE code_hash=? AND approved_at IS NULL AND expires_at>? AND failed_attempts<?)`)
      .bind(principal.accountId, deviceId, now, ...live, hash, now, MAX_FAILED_APPROVALS),
    env.ACCOUNTS.prepare(`UPDATE device_pending_codes SET
      account_id=?, session_id=?, device_id=?, approved_at=?
      WHERE code_hash=? AND approved_at IS NULL AND expires_at>? AND failed_attempts<?
      AND EXISTS (SELECT 1 FROM devices WHERE account_id=? AND device_id=? AND revoked_at IS NULL)`)
      .bind(principal.accountId, principal.sessionId, deviceId, now,
        hash, now, MAX_FAILED_APPROVALS, principal.accountId, deviceId),
  ];
  // Pre-validation: a wrong consent version is a client error, not an attempt
  // against the code, so it is rejected before any write or counter change.
  let consentPayload: string | null = null;
  if (request.consent !== undefined) {
    const scope = { deviceId, projectIds: [`device:${deviceId}`], rootIds: [] };
    const retention = { contentDays: 30, projectionDays: 30, backupDays: 30 };
    const consent = consentSchema.parse(request.consent.mode === "metadata" ? {
      mode: "metadata", version: 1, grantedAtMs: nowMs, scope, retention,
    } : {
      mode: "managed-content", version: 1, grantedAtMs: nowMs, scope, retention,
      serverProcessingAcknowledged: true,
      contentKinds: request.consent.contentKinds,
      externalModelTransfer: false,
    });
    consentPayload = JSON.stringify(consent);
    statements.push(env.ACCOUNTS.prepare(`INSERT INTO device_consents
      (account_id,device_id,generation,version,consent_json,granted_at_ms)
      SELECT ?,?,?,1,?,? WHERE EXISTS (
        SELECT 1 FROM accounts a JOIN devices d ON d.account_id=a.account_id
        JOIN sessions s ON s.user_sub=a.user_sub
        WHERE a.account_id=? AND a.auth_generation=? AND a.state='active'
        AND d.device_id=? AND d.revoked_at IS NULL AND s.id=? AND s.expires_at>?
      ) AND COALESCE((SELECT MAX(version) FROM device_consents
        WHERE account_id=? AND device_id=?),0)=0`)
      .bind(principal.accountId, deviceId, principal.generation, consentPayload, nowMs,
        principal.accountId, principal.generation, deviceId, principal.sessionId, now,
        principal.accountId, deviceId));
  }
  let results;
  try {
    results = await env.ACCOUNTS.batch(statements);
  } catch (error) {
    await bumpFailedAttempts(env, hash);
    throw error;
  }
  if (results[1]?.meta.changes !== 1 ||
      (consentPayload !== null && results[2]?.meta.changes === 0)) {
    // Lost a race against another approver or the request turned unapprovable
    // between the read and the batch; nothing was written by statement 1.
    await bumpFailedAttempts(env, hash);
    return { kind: "conflict" };
  }
  return { kind: "approved", deviceId };
}

async function bumpFailedAttempts(env: ActivityEnv, codeHash: string): Promise<void> {
  await env.ACCOUNTS.prepare(`UPDATE device_pending_codes
    SET failed_attempts=failed_attempts+1 WHERE code_hash=?`).bind(codeHash).run();
}

export type PollOutcome =
  | { readonly kind: "issued"; readonly grant: string; readonly deviceId: string; readonly expiresAt: number }
  | { readonly kind: "pending" }
  | { readonly kind: "throttled" }
  | { readonly kind: "consumed" }
  | { readonly kind: "unknown" };

export async function pollPendingCode(
  input: unknown, env: ActivityEnv, issuer: string,
): Promise<PollOutcome> {
  const request = pollSchema.parse(input);
  if (!z.url().safeParse(issuer).success) return { kind: "unknown" };
  const hash = await pkceChallenge(request.pollToken);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.ACCOUNTS.prepare(`SELECT approved_at AS approvedAt,
    consumed_at AS consumedAt, last_poll_at AS lastPollAt, expires_at AS expiresAt
    FROM device_pending_codes WHERE poll_hash=?`).bind(hash).first();
  const state = z.object({
    approvedAt: z.number().nullable(), consumedAt: z.number().nullable(),
    lastPollAt: z.number().nullable(), expiresAt: z.number(),
  }).nullable().parse(row);
  if (state === null || state.expiresAt <= now) return { kind: "unknown" };
  if (state.consumedAt !== null) return { kind: "consumed" };
  if (state.lastPollAt !== null && now - state.lastPollAt < PENDING_POLL_INTERVAL_SECONDS) {
    return { kind: "throttled" };
  }
  await env.ACCOUNTS.prepare(`UPDATE device_pending_codes SET last_poll_at=?
    WHERE poll_hash=?`).bind(now, hash).run();
  if (state.approvedAt === null) return { kind: "pending" };
  // The browser approved: mint a single-use short-lived device grant the CLI
  // redeems once through the existing /v1/devices/exchange boundary, which
  // mints the long-lived token. The grant plaintext exists only in memory and
  // in this response — the table keeps its hash — so no secret rests in the
  // database beyond pickup (same storage shape as issueDeviceGrant).
  const grant = randomToken();
  const grantHash = await pkceChallenge(grant);
  const expiresAt = now + GRANT_TTL_SECONDS;
  const results = await env.ACCOUNTS.batch([
    env.ACCOUNTS.prepare(`INSERT INTO device_grants
      (grant_hash,account_id,device_id,session_id,scopes_json,issuer,audience,auth_generation,expires_at)
      SELECT ?,p.account_id,p.device_id,p.session_id,p.scopes_json,?,?,a.auth_generation,?
      FROM device_pending_codes p
      JOIN accounts a ON a.account_id=p.account_id
      JOIN sessions s ON s.id=p.session_id AND s.user_sub=a.user_sub
      JOIN devices d ON d.account_id=p.account_id AND d.device_id=p.device_id
      WHERE p.poll_hash=? AND p.consumed_at IS NULL AND p.approved_at IS NOT NULL AND p.expires_at>?
      AND s.expires_at>? AND a.state='active' AND d.revoked_at IS NULL
      AND p.account_id IS NOT NULL AND ${pendingScopes}
      RETURNING device_id AS deviceId`)
      .bind(grantHash, issuer, ACTIVITY_AUDIENCE, expiresAt, hash, now, now),
    env.ACCOUNTS.prepare(`UPDATE device_pending_codes SET consumed_at=?
      WHERE poll_hash=? AND consumed_at IS NULL
      AND EXISTS (SELECT 1 FROM device_grants WHERE grant_hash=?)`)
      .bind(now, hash, grantHash),
  ]);
  const inserted = results[0];
  if (inserted?.meta.changes !== 1) return { kind: "unknown" };
  const issued = z.object({ deviceId: z.string() }).parse(inserted.results[0]);
  return { kind: "issued", grant, expiresAt, ...issued };
}

export async function sweepPendingCodes(
  db: ActivityEnv["ACCOUNTS"], nowSeconds: number,
): Promise<void> {
  // Two independent housekeeping statements: neither failure skips the other.
  try {
    await db.prepare(SWEEP_PENDING_CODES_SQL)
      .bind(nowSeconds - PENDING_CODE_RETENTION_SECONDS).run();
  } catch (error) {
    // Housekeeping only: the TTL checks keep expired rows unusable, so a
    // failing sweep is logged, never retried loudly.
    console.error("pending code sweep failed", error);
  }
  try {
    await db.prepare("DELETE FROM device_pending_attempts WHERE window_start<?")
      .bind(nowSeconds - ATTEMPT_ROW_RETENTION_SECONDS).run();
  } catch (error) {
    console.error("pending attempt sweep failed", error);
  }
}
