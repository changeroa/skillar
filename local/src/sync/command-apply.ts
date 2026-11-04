import { createHash } from "node:crypto";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { Store } from "../types.js";
import { workflowSpecSchema } from "../workflow/spec.js";
import { CloudSyncError } from "./cloud-blobs.js";
import type { CloudConnection } from "./cloud-connection.js";
import {
  canonicalCommandPayload, commandResultSchema, sourceCommandSchema,
} from "./command-wire.js";
import type { CommandResult, SourceOperation } from "./command-wire.js";

const headSchema = z.object({ source_domain: z.string(), cut: z.number().int().nonnegative() });
const receiptSchema = z.object({ payload_hash: z.string(), result_json: z.string() });

class CommandRejected extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CommandRejected";
  }
}

function execute(store: Store, operation: SourceOperation): Record<string, unknown> {
  switch (operation.kind) {
    case "workflow.put": {
      const { row, created } = store.putWorkflowSpec(workflowSpecSchema.parse(operation.spec));
      return { id: row.id, name: row.name, version: row.version, digest: row.digest, createdMs: row.createdMs, created };
    }
    case "flow.create": {
      const spec = store.workflowSpec(operation.spec.name, operation.spec.version);
      if (spec === undefined) throw new CommandRejected("spec_not_found");
      const result = store.createFlow({
        workspaceId: operation.workspaceId, specId: spec.id,
        ...(operation.tabId === undefined ? {} : { tabId: operation.tabId }),
        ...(operation.label === undefined ? {} : { label: operation.label }),
      });
      if (!result.created) throw new CommandRejected("flow_already_open");
      return {
        id: result.flow.id, workspaceId: result.flow.workspaceId, tabId: result.flow.tabId ?? null,
        label: result.flow.label ?? null, registeredMs: result.flow.registeredMs,
        spec: { id: spec.id, name: spec.name, version: spec.version },
      };
    }
    case "flow.map-step": {
      const flow = store.getFlow(operation.flowId);
      if (flow === undefined) throw new CommandRejected("flow_not_found");
      if (!flow.spec?.spec.steps.some(step => step.id === operation.stepId)) throw new CommandRejected("unknown_step");
      const { created } = store.mapFlowStep(flow.id, operation.paneId, operation.stepId);
      return { flowId: flow.id, paneId: operation.paneId, stepId: operation.stepId, created };
    }
    case "flow.end": {
      const ended = store.endFlow(operation.flowId);
      if (ended === undefined) throw new CommandRejected("flow_not_found");
      return { id: operation.flowId, ...ended };
    }
    case "eval.add":
      store.addEvalCase({
        query: operation.query,
        ...(operation.expectedUri === undefined ? {} : { expectedUri: operation.expectedUri }),
        ...(operation.fromTraceId === undefined ? {} : { fromTraceId: operation.fromTraceId }),
      });
      return { stored: true };
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

/**
 * Main-thread only. Mutation, recording boundaries, CDC triggers and receipt
 * commit together. An ACK lost after commit replays this receipt, not the write.
 */
export function applySourceCommand(
  db: DatabaseSync, store: Store, connection: CloudConnection, input: unknown,
  now = Date.now(),
): CommandResult {
  const command = sourceCommandSchema.parse(input);
  if (command.accountId !== connection.accountId || command.generation !== connection.generation ||
      command.deviceId !== connection.deviceId) throw new CloudSyncError("command_identity_mismatch");
  const binding = db.prepare("SELECT value FROM meta WHERE key='cloud.binding'").get();
  if (binding?.["value"] !== connection.instanceId) throw new CloudSyncError("command_binding_mismatch");
  const hash = createHash("sha256").update(canonicalCommandPayload({
    profile: { deviceId: command.deviceId, sourceDomain: command.sourceDomain },
    commandId: command.commandId, baseRevision: command.baseRevision, operation: command.operation,
  })).digest("hex");
  if (hash !== command.payloadHash) throw new CloudSyncError("command_payload_mismatch");
  const identity = [command.accountId, command.generation, command.deviceId, command.sourceDomain, command.commandId] as const;
  db.exec("BEGIN IMMEDIATE");
  try {
    const head = headSchema.parse(db.prepare(`SELECT source_domain,
      COALESCE((SELECT MAX(seq) FROM sync_journal),0) AS cut FROM sync_identity`).get());
    if (head.source_domain !== command.sourceDomain) throw new CloudSyncError("command_source_mismatch");
    const previous = db.prepare(`SELECT payload_hash,result_json FROM connector_command_receipts
      WHERE account_id=? AND generation=? AND device_id=? AND source_domain=? AND command_id=?`).get(...identity);
    if (previous !== undefined) {
      const saved = receiptSchema.parse(previous);
      if (saved.payload_hash !== hash) throw new CloudSyncError("command_receipt_conflict");
      const result = commandResultSchema.parse(JSON.parse(saved.result_json));
      db.exec("COMMIT");
      return result;
    }
    let state: CommandResult["state"] = "applied";
    let result: Record<string, unknown> | null = null;
    let error: string | null = null;
    if (command.expiresAtMs <= now) {
      state = "rejected";
      error = "command_expired";
    } else if (head.cut !== command.baseRevision) {
      state = "conflict";
      error = "source_revision_conflict";
    } else {
      try {
        result = execute(store, command.operation);
      } catch (failure) {
        if (!(failure instanceof CommandRejected)) throw failure;
        state = "rejected";
        error = failure.code;
      }
    }
    const after = headSchema.parse(db.prepare(`SELECT source_domain,
      COALESCE((SELECT MAX(seq) FROM sync_journal),0) AS cut FROM sync_identity`).get());
    const receipt = commandResultSchema.parse({
      commandId: command.commandId, payloadHash: hash, state,
      sourceRevision: after.cut, result, error,
    });
    db.prepare(`INSERT INTO connector_command_receipts
      (account_id,generation,device_id,source_domain,command_id,payload_hash,result_json)
      VALUES(?,?,?,?,?,?,?)`).run(...identity, hash, JSON.stringify(receipt));
    db.exec("COMMIT");
    return receipt;
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
}
