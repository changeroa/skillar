import {
  canonicalCommandJson, canonicalCommandPayload, commandAckSchema, commandPollRequestSchema,
  commandPollResponseSchema, commandResultSchema, commandStatusRequestSchema, sourceCommandRequestSchema,
} from "../../../shared/activity-commands.ts";
import { contentDigest } from "./content-db.ts";
import { writeContentKey } from "./content-keys.ts";
import type { ContentEnv } from "./content-env.ts";
import type { IngestPrincipal } from "./types.ts";
import {
  browserDevice, CommandError, commandGrant, commandIdentity, commandRowSchema, commandStatus,
  commandWrite, connectorScopes, deliveredCommand, loadCommand, operationDescriptor, putCommandObject,
} from "./commands-store.ts";

const encoder = new TextEncoder();
const idWhere = "account_id=? AND generation=? AND device_id=? AND source_domain=? AND command_id=?";

export async function enqueueCommand(env: ContentEnv, p: IngestPrincipal, input: unknown) {
  const request = sourceCommandRequestSchema.parse(input);
  browserDevice(p, request);
  const consent = await commandGrant(env, p);
  const id = commandIdentity(p, request.profile.sourceDomain, request.commandId);
  const bytes = encoder.encode(canonicalCommandPayload(request)), hash = await contentDigest(bytes);
  const now = Date.now();
  // Expired/old-consent reservations cannot block a newly authorized request.
  // They remain discoverable purge intents, including their unfinished R2 PUTs.
  await commandWrite(() => env.ACTIVITY.prepare(`UPDATE connector_commands SET state='purging'
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND state IN ('writing','pending','acking') AND (expires_at<=? OR consent_version<>?
        OR created_at+?<=?)`)
    .bind(p.accountId, p.generation, p.deviceId, request.profile.sourceDomain, now, consent.version,
      Math.min(30, consent.retention.contentDays, consent.retention.projectionDays) * 86_400_000, now).run());
  const managed = await writeContentKey(env.ACTIVITY, p, env.CONTENT_KEYRING);
  const namespace = await contentDigest(encoder.encode(JSON.stringify(id)));
  const objectKey = `activity/${encodeURIComponent(p.accountId)}/${p.generation}/commands/${namespace}/request`;
  await commandGrant(env, p);
  await commandWrite(() => env.ACTIVITY.prepare(`INSERT INTO connector_commands
    (account_id,generation,device_id,source_domain,command_id,payload_hash,base_revision,
      object_key,bytes,key_version,consent_version,created_at,expires_at,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'writing')
    ON CONFLICT(account_id,generation,device_id,source_domain,command_id) DO NOTHING`)
    .bind(...id, hash, request.baseRevision, objectKey, bytes.length, managed.version, consent.version, now,
      now + Math.min(30, consent.retention.contentDays, consent.retention.projectionDays) * 86_400_000).run());
  const row = await loadCommand(env, p, request.profile.sourceDomain, request.commandId);
  if (row.payload_hash !== hash || row.bytes !== bytes.length) throw new CommandError("command_conflict");
  if (row.state === "writing") {
    await putCommandObject(env, p, row, operationDescriptor(row), bytes);
    await commandGrant(env, p, row);
    await commandWrite(() => env.ACTIVITY.prepare(`UPDATE connector_commands SET state='pending'
      WHERE ${idWhere} AND state='writing' AND expires_at>?`).bind(...id, Date.now()).run());
  }
  return commandStatus(env, p, await loadCommand(env, p, request.profile.sourceDomain, request.commandId));
}

export async function readCommandStatus(env: ContentEnv, p: IngestPrincipal, input: unknown) {
  const request = commandStatusRequestSchema.parse(input);
  browserDevice(p, request);
  return commandStatus(env, p, await loadCommand(env, p, request.profile.sourceDomain, request.commandId));
}

export async function pollCommand(env: ContentEnv, p: IngestPrincipal, input: unknown) {
  const request = commandPollRequestSchema.parse(input);
  connectorScopes(p);
  await commandGrant(env, p);
  const saved = await env.ACTIVITY.prepare(`SELECT * FROM connector_commands
    WHERE account_id=? AND generation=? AND device_id=? AND source_domain=?
      AND state IN ('writing','pending','acking') LIMIT 1`)
    .bind(p.accountId, p.generation, p.deviceId, request.sourceDomain).first();
  if (saved === null) {
    await commandGrant(env, p);
    return commandPollResponseSchema.parse({ command: null });
  }
  const row = commandRowSchema.parse(saved);
  await commandGrant(env, p, row);
  const command = await deliveredCommand(env, p, row);
  if (command === null && row.state !== "writing") throw new CommandError("command_integrity");
  if (command !== null && row.state === "writing") {
    // Recover a crash after encrypted PUT but before the D1 publication update.
    await commandGrant(env, p, row);
    await commandWrite(() => env.ACTIVITY.prepare(`UPDATE connector_commands SET state='pending'
      WHERE ${idWhere} AND state='writing' AND expires_at>?`)
      .bind(...commandIdentity(p, request.sourceDomain, row.command_id), Date.now()).run());
  }
  // A concurrent ACK may have completed; never deliver a purged/terminal record.
  const current = await loadCommand(env, p, request.sourceDomain, row.command_id);
  return commandPollResponseSchema.parse({ command: current.acknowledged_at === null ? command : null });
}

export async function acknowledgeCommand(env: ContentEnv, p: IngestPrincipal, input: unknown) {
  const { sourceDomain, ...result } = commandAckSchema.parse(input);
  connectorScopes(p);
  let row = await loadCommand(env, p, sourceDomain, result.commandId);
  if (row.payload_hash !== result.payloadHash || row.state === "writing" ||
      result.state === "applied" && result.sourceRevision < row.base_revision) {
    throw new CommandError("command_conflict");
  }
  const bytes = encoder.encode(canonicalCommandJson(commandResultSchema.parse(result)));
  const hash = await contentDigest(bytes), id = commandIdentity(p, sourceDomain, result.commandId);
  const objectKey = row.object_key.replace(/\/request$/, "/result");
  await commandGrant(env, p, row);
  await commandWrite(() => env.ACTIVITY.prepare(`UPDATE connector_commands
    SET state='acking',outcome=?,source_revision=?,result_hash=?,result_bytes=?,result_object_key=?
    WHERE ${idWhere} AND state='pending' AND result_hash IS NULL AND expires_at>?`)
    .bind(result.state, result.sourceRevision, hash, bytes.length, objectKey, ...id, Date.now()).run());
  row = await loadCommand(env, p, sourceDomain, result.commandId);
  if (row.result_hash !== hash || row.result_bytes !== bytes.length || row.result_object_key !== objectKey) {
    throw new CommandError("command_conflict");
  }
  if (row.acknowledged_at === null) {
    await putCommandObject(env, p, row, { objectKey, hash, bytes: bytes.length }, bytes);
    await commandGrant(env, p, row);
    await commandWrite(() => env.ACTIVITY.prepare(`UPDATE connector_commands SET state=outcome,acknowledged_at=?
      WHERE ${idWhere} AND state='acking' AND result_hash=? AND expires_at>?`)
      .bind(Date.now(), ...id, hash, Date.now()).run());
  }
  return commandStatus(env, p, await loadCommand(env, p, sourceDomain, result.commandId));
}
