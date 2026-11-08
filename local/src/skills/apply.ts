import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  checkDirectories, directoryIdentity, readRegular, requiredFile, sameIdentity, sameState,
  SkillApplyError, statPath, writeExclusive,
} from "./fs.js";
import type { Directory } from "./fs.js";
import { checkBefore, loadPlan } from "./plan.js";
import { PRIVATE_SKILL_MAX_RESOURCE_BYTES } from "./package.js";
import { displacedPath, MAX_RECEIPT_BYTES, receiptSchema } from "./receipt.js";
import type { ApplyReport, Hook, Receipt } from "./receipt.js";
import { checkReceiptDirectories, restoreReceipt } from "./rollback.js";

/**
 * Optimistic checkpoints, not a hostile-writer transaction. Move old names into
 * retained storage, then hard-link staged files with no replacement. Node has no
 * portable dirfd-relative rename/CAS; ancestor and check/syscall races remain.
 */
export async function applySkill(planPath: string, hook?: Hook): Promise<ApplyReport> {
  const plan = await loadPlan(planPath);
  checkBefore(plan);
  const runId = randomUUID();
  const recovery = join(plan.root, `.skillar-private-${runId}`);
  mkdirSync(recovery, { mode: 0o700 });
  const recoveryIdentity = directoryIdentity(recovery);
  if (recoveryIdentity === null) throw new SkillApplyError("ancestor_changed", recovery);
  // These arrays are construction accumulators; the persisted receipt is readonly.
  const directories: Directory[] = [...plan.directories];
  for (const [index, dir] of directories.entries()) {
    checkDirectories(directories);
    if (dir.identity === null) {
      mkdirSync(dir.path, { mode: 0o700 });
      const created = directoryIdentity(dir.path);
      if (created === null) throw new SkillApplyError("ancestor_changed", dir.path);
      directories[index] = { path: dir.path, identity: created };
    }
  }
  checkBefore(plan, directories);
  const entries: Array<Receipt["entries"][number]> = [];
  for (const [index, file] of plan.files.entries()) {
    checkDirectories([...directories, { path: recovery, identity: recoveryIdentity }]);
    const before = readRegular(join(plan.root, file.path), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
    if (!sameState(before?.state ?? null, file.before)) throw new SkillApplyError("target_changed", file.path);
    const content = plan.exported.package.contents[index];
    if (content === undefined) throw new SkillApplyError("invalid_plan", file.path);
    const stage = join(recovery, `stage-${index}`);
    writeExclusive(stage, Buffer.from(content.body, "base64"));
    const staged = requiredFile(stage, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
    entries.push({
      beforeBody: before?.bytes.toString("base64") ?? null,
      writtenIdentity: staged.state.identity, writtenMtime: staged.state.mtime,
    });
  }
  const receipt = receiptSchema.parse({ schemaVersion: 1, runId, plan, recoveryIdentity, directories, entries });
  const receiptPath = join(recovery, "receipt.json");
  const text = JSON.stringify(receipt);
  if (Buffer.byteLength(text) > MAX_RECEIPT_BYTES) throw new SkillApplyError("quota", "receipt");
  checkReceiptDirectories(receipt);
  // Durable write-ahead receipt exists before the first target file mutation.
  writeExclusive(receiptPath, text);
  const displacedOnly = new Set<number>();
  try {
    checkBefore(plan, directories);
    for (const [index, file] of plan.files.entries()) {
      const target = join(plan.root, file.path);
      hook?.({ phase: "before_apply", index });
      checkReceiptDirectories(receipt);
      const current = readRegular(target, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if (!sameState(current?.state ?? null, file.before)) throw new SkillApplyError("target_changed", target);
      const stage = requiredFile(join(recovery, `stage-${index}`), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      const resource = plan.exported.package.manifest.resources[index];
      const entry = receipt.entries[index];
      if (resource === undefined || entry === undefined || stage.state.digest !== resource.digest ||
          stage.state.mode !== 0o600 || stage.state.mtime !== entry.writtenMtime ||
          !sameIdentity(stage.state.identity, entry.writtenIdentity)) throw new SkillApplyError("stage_changed", target);
      checkReceiptDirectories(receipt);
      if (!sameState(readRegular(target, PRIVATE_SKILL_MAX_RESOURCE_BYTES)?.state ?? null, file.before)) {
        throw new SkillApplyError("target_changed", target);
      }
      if (file.before !== null) {
        if (statPath(displacedPath(receipt, index)) !== null) throw new SkillApplyError("backup_changed", target);
        renameSync(target, displacedPath(receipt, index));
        displacedOnly.add(index);
        hook?.({ phase: "after_displace", index });
        checkReceiptDirectories(receipt);
        const moved = requiredFile(displacedPath(receipt, index), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
        if (moved.state.digest !== file.before.digest || moved.state.mode !== file.before.mode ||
            moved.state.mtime !== file.before.mtime ||
            !sameIdentity(moved.state.identity, file.before.identity)) {
          // Never replace a new occupant. The displaced bytes remain in recovery.
          linkSync(displacedPath(receipt, index), target);
          throw new SkillApplyError("target_changed", target);
        }
      }
      checkReceiptDirectories(receipt);
      linkSync(join(recovery, `stage-${index}`), target);
      displacedOnly.delete(index);
      hook?.({ phase: "after_apply", index });
      checkReceiptDirectories(receipt);
      const installed = requiredFile(target, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if (installed.state.digest !== resource.digest || installed.state.mode !== 0o600 ||
          installed.state.mtime !== entry.writtenMtime || !sameIdentity(installed.state.identity, entry.writtenIdentity)) {
        throw new SkillApplyError("target_changed", target);
      }
    }
    // Earlier writes can change while a later operation runs; never report those as success.
    checkReceiptDirectories(receipt);
    for (const [index, file] of plan.files.entries()) {
      const current = requiredFile(join(plan.root, file.path), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if (current.state.digest !== plan.exported.package.manifest.resources[index]?.digest ||
          current.state.mode !== 0o600 || current.state.mtime !== receipt.entries[index]?.writtenMtime ||
          !sameIdentity(current.state.identity, receipt.entries[index]?.writtenIdentity ?? null)) {
        throw new SkillApplyError("target_changed", file.path);
      }
    }
    return { status: "applied", receipt: receiptPath, outcomes: [] };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const outcomes = restoreReceipt(receipt, { hook, displacedOnly });
    return {
      status: outcomes.some(outcome => outcome.status === "conflict") ? "conflict" : "rolled_back",
      receipt: receiptPath, outcomes, error: error.message,
    };
  }
}
