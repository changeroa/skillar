import { deviceSelfSchema, readConnection } from "../sync/cloud-connection.js";
import { CloudHttp } from "../sync/cloud-http.js";
import { CloudSyncError } from "../sync/cloud-blobs.js";
import {
  connectCloudDeviceFlow, PENDING_SKILLS_READ_SCOPES, PENDING_SKILLS_WRITE_SCOPES,
} from "../sync/cloud-pending.js";
import type { ConnectIo } from "../sync/cloud-pending.js";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES, privateSkillIdentitySchema } from "./package.js";

const DEFAULT_CLOUD_ORIGIN = "https://skillar.sh";

/** A private request never depends on activity capture or releases its bearer token. */
export async function privateSkillCloud(home: string, write: boolean, fetcher: typeof fetch = fetch) {
  const connection = readConnection(home);
  if (connection === null) throw new CloudSyncError("not_connected");
  if (connection.expiresAt <= Math.floor(Date.now() / 1000)) throw new CloudSyncError("credentials_expired");
  const http = new CloudHttp(connection.origin, connection.token, fetcher);
  const current = privateSkillIdentitySchema.parse(await http.request("/v1/skills/identity"));
  if (current.accountId !== connection.accountId || current.deviceId !== connection.deviceId ||
      current.generation !== connection.generation) throw new CloudSyncError("device_identity_mismatch");
  if (!current.scopes.includes("skills:read") || (write && !current.scopes.includes("skills:write"))) {
    throw new CloudSyncError("private_skill_permission_required");
  }
  return {
    identity: {
      accountId: connection.accountId, generation: connection.generation, deviceId: connection.deviceId,
      origin: connection.origin, instanceId: connection.instanceId,
    },
    request: (suffix: "" | `/${string}`, body?: object) => http.request(`/v1/skills${suffix}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      maxRequestBytes: PRIVATE_SKILL_MAX_REQUEST_BYTES, maxResponseBytes: PRIVATE_SKILL_MAX_REQUEST_BYTES,
    }),
  };
}

/**
 * Publish/pull need skills scopes on this device's connection. When they are
 * missing, the CLI starts the same browser approval as sync connect — one
 * link, one approval — then the caller retries the operation. A device that
 * is already connected keeps it: the approval adds scopes to the same device
 * row, so the union of current and needed scopes is requested.
 */
/** SKILLAR_CLOUD_ORIGIN overrides the default site, like `sync connect --origin`. */
function ensureOrigin(options: { readonly origin?: string; readonly env?: NodeJS.ProcessEnv }): string {
  return options.origin ?? options.env?.SKILLAR_CLOUD_ORIGIN ?? DEFAULT_CLOUD_ORIGIN;
}

export async function ensurePrivateSkillAccess(
  home: string,
  options: {
    readonly write: boolean;
    readonly origin?: string;
    readonly deviceLabel?: string;
    readonly open?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly io?: ConnectIo;
    readonly fetcher?: typeof fetch;
    readonly wait?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const needed = options.write ? PENDING_SKILLS_WRITE_SCOPES : PENDING_SKILLS_READ_SCOPES;
  const connection = readConnection(home);
  if (connection === null) {
    options.io?.out("비공개 스킬 권한이 없습니다. 이 링크를 열어 승인하세요.\n");
    await connectCloudDeviceFlow(home, {
      origin: ensureOrigin(options), deviceLabel: options.deviceLabel,
      scopes: needed, open: options.open, env: options.env, io: options.io,
      fetcher: options.fetcher, wait: options.wait,
    });
    return;
  }
  let current: readonly string[];
  if (connection.scopes !== undefined) {
    current = connection.scopes;
  } else {
    // Older connection files carry no scopes: probe the device-self boundary
    // for the full list, and fall back to the scopes sync connect always
    // requested when the probe cannot answer.
    try {
      const http = new CloudHttp(connection.origin, connection.token, options.fetcher ?? fetch);
      current = deviceSelfSchema.parse(await http.request("/v1/devices/self")).scopes;
    } catch {
      current = ["activity:read", "activity:ingest"];
    }
  }
  if (needed.every(scope => current.includes(scope))) return;
  const union = [...new Set([...current, ...needed])];
  options.io?.out("이 기기에 비공개 스킬 권한을 추가합니다. 이 링크를 열어 승인하세요.\n");
  await connectCloudDeviceFlow(home, {
    origin: connection.origin, deviceLabel: options.deviceLabel, scopes: union,
    upgradeDeviceId: connection.deviceId, open: options.open, env: options.env,
    io: options.io, fetcher: options.fetcher, wait: options.wait,
  });
}
