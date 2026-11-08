import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import { CloudHttp, cloudOriginSchema } from "./cloud-http.js";
import { consentSchema } from "./cloud-wire.js";

export const deviceSelfSchema = z.strictObject({
  accountId: z.string().min(1), deviceId: z.string().min(1),
  generation: z.number().int().positive(), shardId: z.literal("activity-00"),
  scopes: z.array(z.enum(["activity:read", "activity:ingest", "skills:read", "skills:write"])).min(1),
  ingestEnabled: z.boolean(), version: z.number().int().nonnegative(),
  consent: consentSchema,
});
export const connectionSchema = z.strictObject({
  version: z.literal(1), instanceId: z.string().uuid(), origin: cloudOriginSchema,
  accountId: z.string().min(1), deviceId: z.string().min(1),
  generation: z.number().int().positive(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
});
export type CloudConnection = z.infer<typeof connectionSchema>;

export function cloudHome(home: string): string {
  return join(home, "cloud");
}
export function atomicCloudJson(home: string, name: string, value: unknown): void {
  if (!/^[a-z0-9-]+\.json$/.test(name)) throw new CloudSyncError("invalid_state_path");
  const directory = cloudHome(home);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, name), temporary = `${target}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, target);
  const parent = openSync(directory, "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
export function readConnection(home: string): CloudConnection | null {
  const path = join(cloudHome(home), "connection.json");
  if (!existsSync(path)) return null;
  const input: unknown = JSON.parse(readFileSync(path, "utf8"));
  return connectionSchema.parse(input);
}
export function disconnectCloud(home: string): void {
  const path = join(cloudHome(home), "connection.json");
  if (existsSync(path)) unlinkSync(path);
  // Source journal, immutable pending requests, blobs and local backups survive.
}

/** Client-visible refusal used when local state cannot prove cloud copies are absent. */
function historySyncError(code: "history_sync_pending" | "history_sync_unreadable", message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A disconnected spool can still contain an ACK-lost batch or an acknowledged remote cursor. */
export function assertCloudHistoryCacheSafe(home: string): void {
  const path = join(cloudHome(home), "spool.sqlite");
  if (!existsSync(path)) return;
  let spool: DatabaseSync | undefined;
  try {
    spool = new DatabaseSync(path, { readOnly: true });
    if (spool.prepare("SELECT 1 FROM sync_outbox LIMIT 1").get() !== undefined ||
        spool.prepare("SELECT 1 FROM sync_streams WHERE ack_sequence > 0 OR ack_cut > 0 LIMIT 1").get() !== undefined) {
      throw historySyncError("history_sync_pending", "History deletion is blocked because disconnected cloud spool data may still contain or represent captured history. Resolve cloud deletion before retrying.");
    }
  } catch (error) {
    if ((error as { code?: unknown }).code === "history_sync_pending") throw error;
    throw historySyncError("history_sync_unreadable", "History deletion is blocked because local cloud spool state cannot be verified.");
  } finally {
    spool?.close();
  }
}

/** Delete disconnected local copies only after the source store and spool proved no cloud batch or remote history exists. */
export function purgeCloudHistoryCache(home: string): void {
  const directory = cloudHome(home);
  for (const name of ["spool.sqlite", "spool.sqlite-shm", "spool.sqlite-wal", "prepared.json", "runtime-state.json"]) {
    rmSync(join(directory, name), { force: true });
  }
  rmSync(join(directory, "prepared"), { recursive: true, force: true });
}

/** Connection exchanges a browser-issued grant; it never grants upload consent. */
export async function connectCloud(
  home: string, input: { readonly origin: string; readonly grant: string },
  fetcher: typeof fetch = fetch,
): Promise<Omit<CloudConnection, "token">> {
  if (readConnection(home) !== null) throw new CloudSyncError("already_connected");
  const exchange = new CloudHttp(input.origin, null, fetcher);
  const credential = z.strictObject({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), deviceId: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }).parse(await exchange.request("/v1/devices/exchange", {
    body: JSON.stringify({ grant: z.string().min(32).max(128).parse(input.grant) }),
  }));
  const self = deviceSelfSchema.parse(await new CloudHttp(input.origin, credential.token, fetcher)
    .request("/v1/devices/self"));
  if (self.deviceId !== credential.deviceId) throw new CloudSyncError("device_identity_mismatch");
  const connection = connectionSchema.parse({
    version: 1, instanceId: randomUUID(), origin: input.origin, accountId: self.accountId,
    deviceId: self.deviceId, generation: self.generation,
    token: credential.token, expiresAt: credential.expiresAt,
  });
  atomicCloudJson(home, "connection.json", connection);
  const { token: _secret, ...visible } = connection;
  return visible;
}

export async function currentCloudDevice(
  connection: CloudConnection, fetcher: typeof fetch = fetch, attempt = 0,
) {
  if (connection.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new CloudSyncError("credentials_expired");
  }
  const self = deviceSelfSchema.parse(await new CloudHttp(connection.origin, connection.token, fetcher, 30_000, attempt)
    .request("/v1/devices/self"));
  if (self.deviceId !== connection.deviceId || self.accountId !== connection.accountId ||
      self.generation !== connection.generation) throw new CloudSyncError("device_identity_mismatch");
  return self;
}
