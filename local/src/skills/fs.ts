import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, writeFileSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

export class SkillApplyError extends Error {
  readonly name = "SkillApplyError";
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

const integerString = z.string().regex(/^\d+$/).max(40);
export const identitySchema = z.strictObject({
  dev: integerString, ino: integerString, birth: integerString,
}).readonly();
export const stateSchema = z.strictObject({
  identity: identitySchema, size: z.number().int().nonnegative().safe(),
  mode: z.number().int().min(0).max(0o777), mtime: integerString, ctime: integerString,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).readonly();
export type Identity = z.infer<typeof identitySchema>;
export type FileState = z.infer<typeof stateSchema>;
export type Directory = { readonly path: string; readonly identity: Identity | null };

export const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const identity = (stat: BigIntStats): Identity => ({
  dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs),
});
export function sameIdentity(a: Identity | null, b: Identity | null): boolean {
  return a === null || b === null ? a === b : a.dev === b.dev && a.ino === b.ino && a.birth === b.birth;
}
export function sameState(a: FileState | null, b: FileState | null): boolean {
  return a === null || b === null ? a === b : sameIdentity(a.identity, b.identity) &&
    a.size === b.size && a.mode === b.mode && a.mtime === b.mtime && a.ctime === b.ctime && a.digest === b.digest;
}
export function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export function statPath(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if (missing(error)) return null; throw error; }
}
export function directoryIdentity(path: string): Identity | null {
  const stat = statPath(path);
  if (stat === null) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillApplyError("unsafe_directory", path);
  return identity(stat);
}
export function ancestors(path: string): readonly string[] {
  const result: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    result.unshift(current);
    if (dirname(current) === current) return result;
  }
}
export function checkDirectories(dirs: readonly Directory[]): void {
  for (const dir of dirs) {
    if (!sameIdentity(directoryIdentity(dir.path), dir.identity)) {
      throw new SkillApplyError("ancestor_changed", dir.path);
    }
  }
}
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

/** Bounded descriptor read, rejecting links/devices and changes observed during the read. */
export function readRegular(path: string, limit: number): { readonly bytes: Buffer; readonly state: FileState } | null {
  const initial = statPath(path);
  if (initial === null) return null;
  if (!initial.isFile()) throw new SkillApplyError("not_regular", path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile() || !sameIdentity(identity(initial), identity(stat))) throw new SkillApplyError("file_changed", path);
    if (stat.size > BigInt(limit)) throw new SkillApplyError("quota", path);
    const bytes = Buffer.alloc(Number(stat.size) + 1);
    let length = 0;
    for (;;) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      length += count;
      if (count === 0 || length === bytes.length) break;
    }
    const end = fstatSync(fd, { bigint: true });
    const named = statPath(path);
    if (length !== Number(stat.size) || stat.mtimeNs !== end.mtimeNs || stat.ctimeNs !== end.ctimeNs ||
        stat.mode !== end.mode || named === null || !sameIdentity(identity(stat), identity(named))) {
      throw new SkillApplyError("file_changed", path);
    }
    return { bytes: bytes.subarray(0, length), state: {
      identity: identity(stat), size: length, mode: Number(stat.mode) & 0o777,
      mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs), digest: digest(bytes.subarray(0, length)),
    } };
  } finally { closeSync(fd); }
}
export function requiredFile(path: string, limit: number): NonNullable<ReturnType<typeof readRegular>> {
  const file = readRegular(path, limit);
  if (file === null) throw new SkillApplyError("missing_input", path);
  return file;
}
export function readJson(path: string, limit: number): unknown {
  for (const parent of ancestors(dirname(resolve(path)))) {
    if (directoryIdentity(parent) === null) throw new SkillApplyError("missing_directory", parent);
  }
  return JSON.parse(requiredFile(path, limit).bytes.toString("utf8"));
}
/** Exclusive artifact creation: never replace an existing plan, receipt, or stage. */
export function writeExclusive(path: string, bytes: Uint8Array | string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); }
  finally { closeSync(fd); }
}
