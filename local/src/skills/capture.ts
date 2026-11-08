import { readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  PRIVATE_SKILL_MAX_BYTES, PRIVATE_SKILL_MAX_RESOURCE_BYTES, PRIVATE_SKILL_MAX_RESOURCES,
  createPrivateSkillPackage, privateSkillMediaType, privateSkillPathSchema,
} from "./package.js";
import {
  ancestors, checkDirectories, directoryIdentity, requiredFile, sameState, SkillApplyError,
} from "./fs.js";
import type { Directory, FileState, Identity } from "./fs.js";
import type { PrivateSkillPackage } from "./package.js";

export type CapturedPrivateSkill = {
  readonly sourceRoot: string; readonly rootIdentity: Identity; readonly package: PrivateSkillPackage;
};

/** Read only an explicitly selected directory; never follow a picked resource symlink. */
export async function capturePrivateSkill(source: string): Promise<CapturedPrivateSkill> {
  const picked = resolve(source);
  if (directoryIdentity(picked) === null) throw new SkillApplyError("missing_directory", picked);
  const root = realpathSync(picked), rootIdentity = directoryIdentity(root);
  if (rootIdentity === null) throw new SkillApplyError("missing_directory", root);
  const directories: Directory[] = ancestors(root).map(path => ({ path, identity: directoryIdentity(path) }));
  const states = new Map<string, FileState>();
  const files: { path: string; mediaType: string; bytes: Uint8Array }[] = [];
  let total = 0, visited = 0;
  const walk = (directory: string, parents: readonly Directory[]): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 4096) throw new SkillApplyError("quota", "source directory has too many entries");
      checkDirectories(parents);
      const path = join(directory, entry.name), resource = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        privateSkillPathSchema.parse(`${resource}/x`);
        const identity = directoryIdentity(path);
        if (identity === null) throw new SkillApplyError("directory_changed", path);
        const child = { path, identity };
        directories.push(child);
        walk(path, [...parents, child]);
      } else {
        const canonical = privateSkillPathSchema.parse(resource);
        if (files.length >= PRIVATE_SKILL_MAX_RESOURCES) throw new SkillApplyError("quota", "too many resources");
        const file = requiredFile(path, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
        total += file.bytes.length;
        if (total > PRIVATE_SKILL_MAX_BYTES) throw new SkillApplyError("quota", "source exceeds package bytes");
        states.set(path, file.state);
        files.push({ path: canonical, mediaType: privateSkillMediaType(canonical), bytes: file.bytes });
      }
    }
  };
  walk(root, [...directories]);
  checkDirectories(directories);
  for (const [path, before] of states) {
    if (!sameState(requiredFile(path, PRIVATE_SKILL_MAX_RESOURCE_BYTES).state, before)) {
      throw new SkillApplyError("file_changed", path);
    }
  }
  checkDirectories(directories);
  return { sourceRoot: root, rootIdentity, package: await createPrivateSkillPackage(files) };
}
