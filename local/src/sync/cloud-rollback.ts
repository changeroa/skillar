import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CloudSyncError } from "./cloud-blobs.js";
import { cloudHome, readConnection } from "./cloud-connection.js";
import { CloudHttp } from "./cloud-http.js";
import { preparedSchema } from "./cloud-prepare.js";
import { pauseCloud } from "./cloud.js";
import { migrationStatusSchema } from "./cloud-wire.js";

/** Rollback pauses delivery; accepted cloud history and local capture remain intact. */
export async function rollbackCloud(home: string, fetcher: typeof fetch = fetch) {
  pauseCloud(home);
  const connection = readConnection(home);
  if (connection === null) throw new CloudSyncError("not_connected");
  const prepared = preparedSchema.parse(JSON.parse(
    readFileSync(join(cloudHome(home), "prepared.json"), "utf8")));
  if (prepared.instanceId !== connection.instanceId || prepared.deviceId !== connection.deviceId ||
      prepared.generation !== connection.generation) throw new CloudSyncError("prepared_snapshot_mismatch");
  return migrationStatusSchema.parse(await new CloudHttp(connection.origin, connection.token, fetcher)
    .request("/v1/activity/migrations/rollback", { body: JSON.stringify({
      deviceId: prepared.deviceId, generation: prepared.generation,
      sourceDomain: prepared.sourceDomain, snapshotId: prepared.snapshotId,
    }) }));
}
