import { hashContent } from "./activity-content.js";
import {
  PRIVATE_SKILL_MAX_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES,
  PRIVATE_SKILL_MAX_RESOURCES, PrivateSkillContractError,
  privateSkillDigestSchema, privateSkillManifestSchema, privateSkillPackageSchema,
  privateSkillPathSchema,
} from "./private-skills.js";
import type { PrivateSkillPackage, PrivateSkillPath } from "./private-skills.js";

export type PrivateSkillFile = {
  readonly path: string; readonly mediaType: string; readonly bytes: Uint8Array;
};
const encoder = new TextEncoder();
const archiveSignatures = [
  [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08],
  [0x1f, 0x8b], [0x42, 0x5a, 0x68], [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  [0x52, 0x61, 0x72, 0x21], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
] as const;

function rejectArchive(bytes: Uint8Array): void {
  if (archiveSignatures.some(signature => signature.every((byte, index) => bytes[index] === byte)) ||
      (bytes.length >= 262 && new TextDecoder().decode(bytes.subarray(257, 262)) === "ustar")) {
    throw new PrivateSkillContractError("archive_not_supported");
  }
}
export function encodePrivateSkillBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(parts.join(""));
}
export function decodePrivateSkillBytes(body: string): Uint8Array {
  const binary = atob(body);
  if (btoa(binary) !== body) throw new PrivateSkillContractError("package_integrity");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** One bounded package format is shared by browser uploads, sync and local apply. */
export async function createPrivateSkillPackage(files: readonly PrivateSkillFile[]): Promise<PrivateSkillPackage> {
  if (files.length < 1 || files.length > PRIVATE_SKILL_MAX_RESOURCES ||
      files.some(file => file.bytes.length > PRIVATE_SKILL_MAX_RESOURCE_BYTES) ||
      files.reduce((sum, file) => sum + file.bytes.length, 0) > PRIVATE_SKILL_MAX_BYTES) {
    throw new PrivateSkillContractError("invalid_resource");
  }
  const ordered = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const resources = [];
  const contents = [];
  for (const file of ordered) {
    rejectArchive(file.bytes);
    const path = privateSkillPathSchema.parse(file.path);
    resources.push({
      path, mediaType: file.mediaType, bytes: file.bytes.length,
      digest: privateSkillDigestSchema.parse(await hashContent(file.bytes)),
    });
    contents.push({ path, body: encodePrivateSkillBytes(file.bytes) });
  }
  const manifest = privateSkillManifestSchema.parse({ schemaVersion: 1, entrypoint: "SKILL.md", resources });
  return privateSkillPackageSchema.parse({
    manifest, contents,
    manifestDigest: await hashContent(encoder.encode(JSON.stringify(manifest))),
  });
}

/** Verify membership and bytes before any storage write or filesystem mutation. */
export async function verifyPrivateSkillPackage(input: unknown): Promise<{
  readonly package: PrivateSkillPackage; readonly files: ReadonlyMap<PrivateSkillPath, Uint8Array>;
}> {
  const value = privateSkillPackageSchema.parse(input);
  if (await hashContent(encoder.encode(JSON.stringify(value.manifest))) !== value.manifestDigest ||
      value.contents.length !== value.manifest.resources.length) {
    throw new PrivateSkillContractError("package_integrity");
  }
  const files = new Map<PrivateSkillPath, Uint8Array>();
  for (const [index, resource] of value.manifest.resources.entries()) {
    const content = value.contents[index];
    if (content === undefined || content.path !== resource.path) {
      throw new PrivateSkillContractError("package_integrity");
    }
    const bytes = decodePrivateSkillBytes(content.body);
    rejectArchive(bytes);
    if (bytes.length !== resource.bytes || await hashContent(bytes) !== resource.digest) {
      throw new PrivateSkillContractError("package_integrity");
    }
    files.set(resource.path, bytes);
  }
  return { package: value, files };
}
