import { randomUUID } from "node:crypto";
import type { MessagePort } from "node:worker_threads";
import { z } from "zod";
import { contentKinds } from "./cloud-wire.js";
import { CloudSyncError } from "./cloud-blobs.js";
import { atomicCloudJson, currentCloudDevice, readConnection } from "./cloud-connection.js";
import { CloudHttp, CloudRequestError } from "./cloud-http.js";
import { sourceCommandsEnabled } from "./command-control.js";
import { commandPollResponseSchema, commandResultSchema, commandStatusSchema, sourceCommandSchema } from "./command-wire.js";
import type { CommandResult, SourceCommand } from "./command-wire.js";
import type { CloudProgress } from "./cloud.js";

export const commandApplyRequestSchema = z.strictObject({
  kind: z.literal("apply-command"), id: z.string().uuid(), instanceId: z.string().uuid(),
  command: sourceCommandSchema,
});
const commandApplyReplySchema = z.strictObject({
  kind: z.literal("command-applied"), id: z.string().uuid(), result: commandResultSchema.nullable(),
});
export type ApplyCommand = (command: SourceCommand, instanceId: string) => Promise<CommandResult | null>;

export function requestCommandApply(port: MessagePort | null, command: SourceCommand, instanceId: string): Promise<CommandResult | null> {
  if (port === null) return Promise.resolve(null);
  const id = randomUUID();
  return new Promise(resolve => {
    const finish = (result: CommandResult | null) => {
      clearTimeout(timeout);
      port.off("message", reply);
      resolve(result);
    };
    const reply = (value: unknown) => {
      const parsed = commandApplyReplySchema.safeParse(value);
      if (parsed.success && parsed.data.id === id) finish(parsed.data.result);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    port.on("message", reply);
    port.postMessage({ kind: "apply-command", id, instanceId, command });
  });
}

/** One bounded poll/apply/ACK in the existing sync turn; no new persistent transport. */
export async function runCloudCommandStep(
  home: string, progress: CloudProgress, apply: ApplyCommand,
  options: { readonly fetcher?: typeof fetch } = {},
): Promise<CloudProgress> {
  if (progress.phase !== "caught-up" || progress.sourceDomain === undefined || !sourceCommandsEnabled(home)) return progress;
  const connection = readConnection(home);
  if (connection === null || connection.instanceId !== progress.instanceId) return progress;
  const save = (state: string, code: string | null = null, commandId: string | null = null) =>
    atomicCloudJson(home, "command-status.json", { state, code, commandId, updatedAtMs: Date.now() });
  try {
    const self = await currentCloudDevice(connection, options.fetcher);
    if (!self.ingestEnabled || !self.scopes.includes("activity:read") || !self.scopes.includes("activity:ingest") ||
        self.consent.mode !== "managed-content" || self.consent.scope.rootIds.length !== 0 ||
        !self.consent.scope.projectIds.includes(`device:${connection.deviceId}`) ||
        !contentKinds.every(kind => self.consent.mode === "managed-content" && self.consent.contentKinds.includes(kind))) {
      save("disabled", "command_consent_required");
      return progress;
    }
    const http = new CloudHttp(connection.origin, connection.token, options.fetcher);
    const { command } = commandPollResponseSchema.parse(await http.request("/v1/activity/commands/poll", {
      body: JSON.stringify({ sourceDomain: progress.sourceDomain }),
    }));
    if (command === null) {
      save("idle");
      return progress;
    }
    if (command.accountId !== connection.accountId || command.generation !== connection.generation ||
        command.deviceId !== connection.deviceId || command.sourceDomain !== progress.sourceDomain ||
        command.consentVersion !== self.consent.version) throw new CloudSyncError("command_identity_mismatch");
    // A disable, disconnect or consent change during poll must win before local apply.
    const current = await currentCloudDevice(connection, options.fetcher);
    if (!sourceCommandsEnabled(home) || readConnection(home)?.instanceId !== connection.instanceId ||
        JSON.stringify(current) !== JSON.stringify(self)) {
      save("disabled", "command_authority_changed", command.commandId);
      return progress;
    }
    const result = await apply(command, connection.instanceId);
    if (result === null) {
      save("pending", "source_apply_unavailable", command.commandId);
      return progress;
    }
    const receipt = commandResultSchema.parse(result);
    if (receipt.commandId !== command.commandId || receipt.payloadHash !== command.payloadHash) {
      throw new CloudSyncError("command_receipt_mismatch");
    }
    const acknowledged = commandStatusSchema.parse(await http.request("/v1/activity/commands/ack", {
      body: JSON.stringify({ sourceDomain: command.sourceDomain, ...receipt }),
    }));
    if (acknowledged.commandId !== receipt.commandId || acknowledged.state !== receipt.state ||
        acknowledged.sourceRevision !== receipt.sourceRevision) throw new CloudSyncError("command_ack_mismatch");
    save(receipt.state, receipt.error, command.commandId);
    return progress;
  } catch (failure) {
    if (failure instanceof CloudRequestError) {
      save(failure.state, failure.code);
      return progress;
    }
    if (failure instanceof CloudSyncError) {
      save("quarantined", failure.code);
      return progress;
    }
    throw failure;
  }
}
