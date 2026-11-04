// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  PRIVATE_SKILL_MAX_RESOURCES, privateSkillDigestSchema, privateSkillIdSchema,
} from "../../../shared/private-skills.ts";
import type { PrivateSkillsEnv } from "./contracts.ts";

export const PRIVATE_SKILL_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;
export const PRIVATE_SKILL_UPLOAD_MS = 24 * 60 * 60 * 1000;
type CleanupEnv = Pick<PrivateSkillsEnv, "ACCOUNTS" | "ACTIVITY_RAW">;
const identitySchema = z.object({
  accountId: z.string().min(1), generation: z.number().int().positive().safe(),
});
type Identity = z.infer<typeof identitySchema>;
const optionsSchema = z.object({
  now: z.number().int().nonnegative().safe().default(() => Date.now()),
  limit: z.number().int().min(1).max(100).default(10),
  objectLimit: z.number().int().min(1).max(200).default(100),
  identity: identitySchema.optional(),
});
const purgeSchema = z.object({
  account_id: z.string(), generation: z.number().int(),
  skill_id: privateSkillIdSchema, digest: privateSkillDigestSchema,
  resource_digests_json: z.string(),
  resource_offset: z.number().int().nonnegative(),
});
const resourcesSchema = z.array(privateSkillDigestSchema).min(1).max(PRIVATE_SKILL_MAX_RESOURCES);

function prefix(identity: Identity) {
  return `private-skills/${encodeURIComponent(identity.accountId)}/${identity.generation}/`;
}
// An absent account is also closed. Credential revocation alone does not close
// the account generation; its retained current/pinned objects remain protected.
const closed = `NOT EXISTS(SELECT 1 FROM accounts a WHERE a.account_id=c.account_id
  AND a.auth_generation=c.generation AND a.state='active')`;

/**
 * Trusted cron/account-deletion API, deliberately independent of store.live().
 * At most limit version claims/scrubs and objectLimit object deletes/HEADs per
 * call. Persisted resource cursors cover legal 512-file versions across runs.
 * Opaque claims are never removed: a successful
 * delete cannot prove that an already-started PUT will not finish later.
 */
export async function sweepPrivateSkills(env: CleanupEnv, options: {
  readonly now?: number; readonly limit?: number; readonly objectLimit?: number; readonly identity?: Identity;
} = {}) {
  const { now, limit, objectLimit, identity } = optionsSchema.parse(options);
  const filter = identity === undefined ? "" : "AND c.account_id=? AND c.generation=?";
  const args = identity === undefined ? [] : [identity.accountId, identity.generation];
  // Selection and claim share one SQLite statement, so heads/pins cannot race
  // between a read of eligibility and an irreversible purge fence.
  const claimed = await env.ACCOUNTS.prepare(`WITH candidates AS (
    SELECT account_id,generation,skill_id,digest,manifest_json FROM private_skill_uploads
    UNION
    SELECT account_id,generation,skill_id,digest,manifest_json FROM private_skill_versions
  ) INSERT INTO private_skill_purges
    (account_id,generation,skill_id,digest,resource_digests_json)
    SELECT c.account_id,c.generation,c.skill_id,c.digest,
      (SELECT json_group_array(json_extract(value,'$.digest'))
        FROM json_each(c.manifest_json,'$.resources'))
    FROM candidates c
    LEFT JOIN private_skills s USING(account_id,generation,skill_id)
    LEFT JOIN private_skill_versions v USING(account_id,generation,skill_id,digest)
    LEFT JOIN private_skill_uploads u USING(account_id,generation,skill_id,digest)
    WHERE NOT EXISTS(SELECT 1 FROM private_skill_purges p WHERE p.account_id=c.account_id
      AND p.generation=c.generation AND p.skill_id=c.skill_id AND p.digest=c.digest)
    AND (${closed} OR s.tombstoned=1 OR
      (v.digest IS NOT NULL AND v.deleting_revision IS NOT NULL) OR
      (s.tombstoned=0 AND c.digest!=s.digest AND v.pinned=0 AND v.retired_at<=?) OR
      (v.digest IS NULL AND (s.digest IS NULL OR s.digest!=c.digest) AND u.created_at<=?))
    ${filter} LIMIT ? RETURNING digest`)
    .bind(now - PRIVATE_SKILL_RECOVERY_MS, now - PRIVATE_SKILL_UPLOAD_MS, ...args, limit).all();

  // Least recently visited first, including already-successful purges. A
  // monotonic order (not wall-clock ties) guarantees progress on repeated runs.
  const selected = await env.ACCOUNTS.prepare(`SELECT * FROM private_skill_purges c
    WHERE 1=1 ${filter} ORDER BY sweep_order,account_id,generation,skill_id,digest LIMIT ?`)
    .bind(...args, limit).all();
  const targets = z.array(purgeSchema).parse(selected.results);
  let deleted = 0, pending = 0, inspectedObjects = 0;
  for (const target of targets) {
    if (inspectedObjects >= objectLimit) break;
    const ids = [target.account_id, target.generation, target.skill_id, target.digest];
    const resources = resourcesSchema.parse(JSON.parse(target.resource_digests_json));
    let offset = target.resource_offset;
    // The durable, path-free target already exists. Plaintext metadata is no
    // longer necessary for retry, even if object storage is unavailable.
    await env.ACCOUNTS.batch([
      env.ACCOUNTS.prepare(`DELETE FROM private_skill_versions
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=?`).bind(...ids),
      env.ACCOUNTS.prepare(`DELETE FROM private_skill_uploads
        WHERE account_id=? AND generation=? AND skill_id=? AND digest=?`).bind(...ids),
    ]);
    for (const digest of resources.slice(offset, offset + objectLimit - inspectedObjects)) {
      const key = prefix({ accountId: target.account_id, generation: target.generation }) +
        `${target.skill_id}/${target.digest}/${digest}`;
      try {
        await env.ACTIVITY_RAW.delete(key);
        if (await env.ACTIVITY_RAW.head(key) === null) deleted++;
        else pending++;
      } catch (error) {
        // Storage failure is an outstanding target, never a completion claim.
        if (error instanceof Error) pending++;
        else throw error;
      }
      offset++;
      inspectedObjects++;
    }
    const complete = offset === resources.length;
    await env.ACCOUNTS.prepare(`UPDATE private_skill_purges SET
      resource_offset=?,checked_at=CASE WHEN ? THEN ? ELSE checked_at END,
      sweep_order=(SELECT COALESCE(MAX(sweep_order),0)+1 FROM private_skill_purges)
      WHERE account_id=? AND generation=? AND skill_id=? AND digest=?`)
      .bind(complete ? 0 : offset, complete ? 1 : 0, now, ...ids).run();
  }
  const scrubbed = await env.ACCOUNTS.prepare(`UPDATE private_skills SET
    name='',description='',tombstoned=1,purge_complete=1
    WHERE (account_id,generation,skill_id) IN (
      SELECT c.account_id,c.generation,c.skill_id FROM private_skills c
      WHERE (c.tombstoned=1 OR ${closed}) ${filter}
      AND (c.name!='' OR c.description!='' OR c.purge_complete=0)
      AND NOT EXISTS(SELECT 1 FROM private_skill_versions v WHERE v.account_id=c.account_id
        AND v.generation=c.generation AND v.skill_id=c.skill_id)
      AND NOT EXISTS(SELECT 1 FROM private_skill_uploads u WHERE u.account_id=c.account_id
        AND u.generation=c.generation AND u.skill_id=c.skill_id) LIMIT ?)
    RETURNING skill_id`).bind(...args, limit).all();
  return {
    claimed: claimed.results.length, visited: targets.length,
    deleted, pending, inspectedObjects, scrubbed: scrubbed.results.length,
  };
}

/**
 * Bounded, point-in-time generation status for the parent's deletion ledger.
 * physical_pending means metadata remains, live blobs were observed, or the
 * live check failed. verified_live_purge means no private plaintext metadata
 * and an empty strongly consistent R2 prefix listing at this check, NOT a
 * physical-erasure guarantee. Durable opaque targets remain revisitable.
 */
export async function privateSkillPurgeStatus(env: CleanupEnv, input: Identity) {
  const identity = identitySchema.parse(input);
  const args = [identity.accountId, identity.generation];
  const metadata = await env.ACCOUNTS.prepare(`SELECT 1 FROM (
    SELECT account_id,generation FROM private_skill_versions
    UNION ALL SELECT account_id,generation FROM private_skill_uploads
    UNION ALL SELECT account_id,generation FROM private_skills
      WHERE name!='' OR description!='' OR tombstoned=0 OR purge_complete=0
    ) WHERE account_id=? AND generation=? LIMIT 1`).bind(...args).first();
  const targets = await env.ACCOUNTS.prepare(`SELECT 1 FROM private_skill_purges
    WHERE account_id=? AND generation=? LIMIT 1`).bind(...args).first();
  let blobs: boolean | null = null;
  try {
    const page = await env.ACTIVITY_RAW.list({ prefix: prefix(identity), limit: 1 });
    blobs = page.objects.length !== 0 || page.truncated;
  } catch (error) {
    // null distinguishes an unverified check from verified absence.
    if (!(error instanceof Error)) throw error;
  }
  const verified = metadata === null && blobs === false;
  return {
    metadata_pending: metadata !== null, blobs_pending: blobs,
    durable_targets: targets !== null,
    physical_pending: !verified, verified_live_purge: verified,
  };
}
