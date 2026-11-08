// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from "../../../shared/activity-content.ts";
import {
  parsePrivateSkillUri, privateSkillExportSchema, privateSkillManifestSchema,
} from "../../../shared/private-skills.ts";
import type {
  PrivateSkillId, PrivateSkillManifest, PrivateSkillPackage, PrivateSkillPath,
} from "../../../shared/private-skills.ts";
import { encodePrivateSkillBytes, verifyPrivateSkillPackage } from "../../../shared/private-skill-package.ts";
import { PrivateSkillError } from "./contracts.ts";
import type { PrivateSkillStore } from "./store.ts";

export function resourceKey(store: PrivateSkillStore, resource: {
  readonly skillId: PrivateSkillId; readonly version: string; readonly digest: string;
}) {
  return `private-skills/${encodeURIComponent(store.principal.accountId)}/${store.principal.generation}` +
    `/${resource.skillId}/${resource.version}/${resource.digest}`;
}
export async function resourceBytes(store: PrivateSkillStore, key: string, resource: {
  readonly bytes: number; readonly digest: string;
}): Promise<Uint8Array> {
  await store.live();
  const bytes = await verifiedResourceBytes(store, key, resource);
  await store.live();
  return bytes;
}
async function verifiedResourceBytes(store: PrivateSkillStore, key: string, resource: {
  readonly bytes: number; readonly digest: string;
}): Promise<Uint8Array> {
  const object = await store.env.ACTIVITY_RAW.get(key);
  if (object === null) throw new PrivateSkillError(409, "resource_missing");
  if (object.size !== resource.bytes) throw new PrivateSkillError(409, "resource_integrity");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== resource.bytes || await hashContent(bytes) !== resource.digest) {
    throw new PrivateSkillError(409, "resource_integrity");
  }
  return bytes;
}
export async function putPackage(store: PrivateSkillStore, skillId: PrivateSkillId, packet: {
  readonly package: PrivateSkillPackage; readonly files: ReadonlyMap<PrivateSkillPath, Uint8Array>;
}) {
  const fence = store.fence();
  const value = packet.package;
  const intent = await store.env.ACCOUNTS.prepare(`INSERT INTO private_skill_uploads
    (account_id,generation,skill_id,digest,manifest_json)
    SELECT ?,?,?,?,? WHERE EXISTS(${fence.sql}) AND NOT EXISTS(
      SELECT 1 FROM private_skills WHERE account_id=? AND generation=? AND skill_id=? AND tombstoned=1)
    ON CONFLICT(account_id,generation,skill_id,digest) DO UPDATE SET manifest_json=excluded.manifest_json
    RETURNING digest`)
    .bind(...store.identity(skillId), value.manifestDigest, JSON.stringify(value.manifest),
      ...fence.args, ...store.identity(skillId)).all();
  if (intent.results.length !== 1) {
    await store.live();
    throw new PrivateSkillError(409, "skill_tombstoned");
  }
  for (const resource of value.manifest.resources) {
    await store.live();
    const bytes = packet.files.get(resource.path);
    if (bytes === undefined) throw new PrivateSkillError(400, "invalid_resource");
    const key = resourceKey(store, { skillId, version: value.manifestDigest, digest: resource.digest });
    await store.env.ACTIVITY_RAW.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: resource.mediaType },
    });
    // Conditional PUT retries must verify the pre-existing object rather than trust its key.
    await verifiedResourceBytes(store, key, resource);
  }
  await store.live();
}
export async function exportVersion(store: PrivateSkillStore, skillId: PrivateSkillId, digest: string) {
  const version = await store.version(skillId, digest);
  const manifest = privateSkillManifestSchema.parse(JSON.parse(version.manifest_json));
  const contents = [];
  for (const resource of manifest.resources) {
    await store.live();
    const bytes = await verifiedResourceBytes(store, resourceKey(store, { skillId, version: digest, digest: resource.digest }), resource);
    contents.push({ path: resource.path, body: encodePrivateSkillBytes(bytes) });
  }
  const packet = await verifyPrivateSkillPackage({ manifest, manifestDigest: digest, contents });
  await store.live();
  return privateSkillExportSchema.parse({
    skillId, version: { digest, createdAt: version.created_at, pinned: version.pinned === 1 },
    package: packet.package,
  });
}
export async function readResource(store: PrivateSkillStore, uri: string) {
  const { skillId, digest, path } = parsePrivateSkillUri(uri);
  const version = await store.version(skillId, digest);
  const manifest = privateSkillManifestSchema.parse(JSON.parse(version.manifest_json));
  if (await hashContent(new TextEncoder().encode(JSON.stringify(manifest))) !== digest) {
    throw new PrivateSkillError(409, "resource_integrity");
  }
  const resource = manifest.resources.find(value => value.path === path);
  if (resource === undefined) throw new PrivateSkillError(404, "not_found");
  const bytes = await resourceBytes(store, resourceKey(store, { skillId, version: digest, digest: resource.digest }), resource);
  return { uri, digest: resource.digest, bytes: bytes.length, mediaType: resource.mediaType,
    body: encodePrivateSkillBytes(bytes) };
}
export async function purgeManifest(store: PrivateSkillStore, skillId: PrivateSkillId, version: {
  readonly digest: string; readonly manifest: PrivateSkillManifest;
}) {
  for (const resource of version.manifest.resources) {
    await store.live();
    await store.env.ACTIVITY_RAW.delete(resourceKey(store, { skillId, version: version.digest, digest: resource.digest }));
  }
}
