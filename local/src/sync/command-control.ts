import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import { atomicCloudJson, cloudHome, readConnection } from "./cloud-connection.js";

const approvalSchema = z.strictObject({ instanceId: z.string().uuid(), enabled: z.boolean() });

/** Local approval is bound to this connection, never inherited by a new account. */
export function sourceCommandsEnabled(home: string): boolean {
  const connection = readConnection(home);
  const path = join(cloudHome(home), "commands.json");
  if (connection === null || !existsSync(path)) return false;
  const approval = approvalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const control = join(cloudHome(home), "control.json");
  if (existsSync(control) && z.object({ paused: z.boolean() })
    .parse(JSON.parse(readFileSync(control, "utf8"))).paused) return false;
  return approval.enabled && approval.instanceId === connection.instanceId;
}

export function approveSourceCommands(home: string, enabled: boolean): void {
  const connection = readConnection(home);
  if (connection === null) throw new CloudSyncError("not_connected");
  atomicCloudJson(home, "commands.json", { instanceId: connection.instanceId, enabled });
}
