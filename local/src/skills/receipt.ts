import { join, resolve } from "node:path";
import { z } from "zod";
import { digest, identitySchema, readJson, sameIdentity, SkillApplyError } from "./fs.js";
import { directorySchema, planSchema, verifyPlan } from "./plan.js";
import { PRIVATE_SKILL_MAX_RESOURCE_BYTES } from "./package.js";

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const bodySchema = z.string().max(4 * Math.ceil(PRIVATE_SKILL_MAX_RESOURCE_BYTES / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().uuid(), plan: planSchema,
  recoveryIdentity: identitySchema,
  directories: z.array(directorySchema).min(1).max(1024).readonly(),
  entries: z.array(z.strictObject({
    beforeBody: bodySchema.nullable(), writtenIdentity: identitySchema,
    writtenMtime: z.string().regex(/^\d+$/).max(40),
  }).readonly()).min(1).max(128).readonly(),
}).readonly();
export type Receipt = z.infer<typeof receiptSchema>;
export type Hook = (event: {
  readonly phase: "before_apply" | "after_displace" | "after_apply" |
    "before_rollback" | "before_restore" | "after_rollback_displace";
  readonly index: number;
}) => void;
export type Outcome = {
  readonly path: string; readonly status: "restored" | "removed" | "unchanged" | "conflict";
  readonly detail?: string;
};
export type ApplyReport = {
  readonly status: "applied" | "rolled_back" | "conflict";
  readonly receipt: string;
  readonly outcomes: readonly Outcome[];
  readonly error?: string;
};
export const recoveryDirectory = (receipt: Receipt): string => join(receipt.plan.root, `.skillar-private-${receipt.runId}`);
export const displacedPath = (receipt: Receipt, index: number): string => join(recoveryDirectory(receipt), `displaced-${index}`);

/** A receipt is an immutable write-ahead journal, not an assertion that apply succeeded. */
export async function loadReceipt(path: string): Promise<Receipt> {
  const receipt = receiptSchema.parse(readJson(path, MAX_RECEIPT_BYTES));
  await verifyPlan(receipt.plan);
  if (resolve(path) !== join(recoveryDirectory(receipt), "receipt.json") ||
      receipt.entries.length !== receipt.plan.files.length ||
      receipt.directories.length !== receipt.plan.directories.length ||
      receipt.directories.some((dir, index) => {
        const planned = receipt.plan.directories[index];
        return planned === undefined || dir.path !== planned.path || dir.identity === null ||
          (planned.identity !== null && !sameIdentity(dir.identity, planned.identity));
      })) throw new SkillApplyError("invalid_receipt", "path, directories or membership");
  for (const [index, entry] of receipt.entries.entries()) {
    const file = receipt.plan.files[index];
    if (file === undefined) throw new SkillApplyError("invalid_receipt", "missing file");
    const bytes = entry.beforeBody === null ? null : Buffer.from(entry.beforeBody, "base64");
    if (file.before === null ? bytes !== null :
      bytes === null || bytes.toString("base64") !== entry.beforeBody ||
      bytes.length !== file.before.size || digest(bytes) !== file.before.digest) {
      throw new SkillApplyError("invalid_receipt", file.path);
    }
  }
  return receipt;
}
