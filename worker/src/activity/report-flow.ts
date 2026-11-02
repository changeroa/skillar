import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { reportReferenceSchema } from "../../../shared/activity-query.ts";
import { accountIdSchema } from "../../../shared/activity-schema.ts";
import { runReport } from "./report-runner.ts";
import type { ReportEnv, ReportParams } from "./report-types.ts";
import { ActivityLedgerError } from "./types.ts";
import { ContentConsentError } from "./content-consent.ts";

const paramsSchema = reportReferenceSchema.unwrap().extend({ accountId: accountIdSchema });
export class ReportFlow extends WorkflowEntrypoint<ReportEnv, ReportParams> {
  async run(event: WorkflowEvent<ReportParams>, step: WorkflowStep) {
    const params = paramsSchema.parse(event.payload);
    // Step state contains only opaque identifiers and status. Raw inputs/results remain encrypted R2.
    return step.do("calculate-and-publish", {
      retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "15 minutes",
    }, async () => {
      try { return await runReport(this.env, params); } catch (error) {
        if (error instanceof ActivityLedgerError || error instanceof ContentConsentError) {
          throw new NonRetryableError(error.code);
        }
        throw new Error("report_processing_unavailable");
      }
    });
  }
}
