import { readConnection } from "../sync/cloud-connection.js";
import { CloudHttp } from "../sync/cloud-http.js";
import { CloudSyncError } from "../sync/cloud-blobs.js";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES, privateSkillIdentitySchema } from "./package.js";

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
