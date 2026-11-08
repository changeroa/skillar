import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  checkDirectories, readRegular, sameIdentity, sameState, SkillApplyError, writeExclusive,
} from "./fs.js";
import { PRIVATE_SKILL_MAX_RESOURCE_BYTES } from "./package.js";
import { displacedPath, loadReceipt, recoveryDirectory } from "./receipt.js";
import type { Hook, Outcome, Receipt } from "./receipt.js";

export function checkReceiptDirectories(receipt: Receipt): void {
  checkDirectories([...receipt.directories, {
    path: recoveryDirectory(receipt), identity: receipt.recoveryIdentity,
  }]);
}

/** Retain all displaced bytes. No replacement rename is used to restore a pathname. */
export function restoreReceipt(receipt: Receipt, options: {
  readonly hook?: Hook; readonly displacedOnly?: ReadonlySet<number>;
} = {}): readonly Outcome[] {
  const outcomes: Outcome[] = [];
  for (const [index, file] of [...receipt.plan.files.entries()].reverse()) {
    const path = join(receipt.plan.root, file.path);
    try {
      options.hook?.({ phase: "before_rollback", index });
      checkReceiptDirectories(receipt);
      const entry = receipt.entries[index];
      const resource = receipt.plan.exported.package.manifest.resources[index];
      if (entry === undefined || resource === undefined) throw new SkillApplyError("invalid_receipt", file.path);
      const current = readRegular(path, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if ((current === null && file.before === null) ||
          (current !== null && file.before !== null &&
            current.state.digest === file.before.digest && current.state.mode === file.before.mode)) {
        outcomes.push({ path, status: "unchanged" });
        continue;
      }
      if (current !== null && (current.state.digest !== resource.digest ||
          current.state.mode !== 0o600 || current.state.mtime !== entry.writtenMtime ||
          !sameIdentity(current.state.identity, entry.writtenIdentity))) {
        throw new SkillApplyError("rollback_conflict", path);
      }
      // An absent overwrite target is recoverable only with proof that we displaced it.
      if (current === null) {
        // Explicit rollback must not undo a subsequent deletion. Only the live
        // apply knows a name is missing because installation has not happened.
        if (!options.displacedOnly?.has(index)) throw new SkillApplyError("rollback_conflict", path);
        const displaced = readRegular(displacedPath(receipt, index), PRIVATE_SKILL_MAX_RESOURCE_BYTES);
        if (file.before === null || displaced === null || displaced.state.digest !== file.before.digest ||
            !sameIdentity(displaced.state.identity, file.before.identity)) {
          throw new SkillApplyError("rollback_conflict", path);
        }
      }
      const restore = join(recoveryDirectory(receipt), `restore-${index}-${randomUUID()}`);
      if (entry.beforeBody !== null) {
        writeExclusive(restore, Buffer.from(entry.beforeBody, "base64"));
        chmodSync(restore, file.before?.mode ?? 0o600);
      }
      options.hook?.({ phase: "before_restore", index });
      checkReceiptDirectories(receipt);
      if (!sameState(readRegular(path, PRIVATE_SKILL_MAX_RESOURCE_BYTES)?.state ?? null, current?.state ?? null)) {
        throw new SkillApplyError("rollback_conflict", path);
      }
      if (current !== null) {
        const retained = join(recoveryDirectory(receipt), `rollback-${index}-${randomUUID()}`);
        renameSync(path, retained);
        options.hook?.({ phase: "after_rollback_displace", index });
        checkReceiptDirectories(receipt);
        const moved = readRegular(retained, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
        // Rename changes ctime, so compare bytes and inode, not the old ctime.
        if (moved === null || moved.state.digest !== current.state.digest ||
            !sameIdentity(moved.state.identity, current.state.identity) || moved.state.mode !== current.state.mode ||
            moved.state.mtime !== current.state.mtime) {
          // Put back the captured edit only if the name is still vacant; otherwise retain it.
          if (moved !== null) linkSync(retained, path);
          throw new SkillApplyError("rollback_conflict", `captured edit retained at ${retained}`);
        }
      }
      checkReceiptDirectories(receipt);
      if (entry.beforeBody !== null) linkSync(restore, path);
      checkReceiptDirectories(receipt);
      const final = readRegular(path, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if (file.before === null ? final !== null :
        final === null || final.state.digest !== file.before.digest || final.state.mode !== file.before.mode) {
        throw new SkillApplyError("rollback_conflict", path);
      }
      outcomes.push({ path, status: entry.beforeBody === null ? "removed" : "restored" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      outcomes.push({ path, status: "conflict", detail: error.message });
    }
  }
  // Later operations may have raced edits to earlier restored targets. Report
  // their final observed state, without attempting to overwrite those edits.
  return outcomes.map(outcome => {
    if (outcome.status === "conflict") return outcome;
    try {
      checkReceiptDirectories(receipt);
      const file = receipt.plan.files.find(file => join(receipt.plan.root, file.path) === outcome.path);
      if (file === undefined) throw new SkillApplyError("invalid_receipt", outcome.path);
      const current = readRegular(outcome.path, PRIVATE_SKILL_MAX_RESOURCE_BYTES);
      if (file.before === null ? current !== null : current === null ||
          current.state.digest !== file.before.digest || current.state.mode !== file.before.mode) {
        throw new SkillApplyError("rollback_conflict", outcome.path);
      }
      return outcome;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { path: outcome.path, status: "conflict", detail: error.message };
    }
  });
}

export async function rollbackSkill(path: string, hook?: Hook): Promise<{
  readonly status: "rolled_back" | "conflict"; readonly receipt: string; readonly outcomes: readonly Outcome[];
}> {
  const receipt = await loadReceipt(path);
  const outcomes = restoreReceipt(receipt, { hook });
  return { status: outcomes.some(outcome => outcome.status === "conflict") ? "conflict" : "rolled_back", receipt: path, outcomes };
}
