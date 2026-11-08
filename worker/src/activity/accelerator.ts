import type { ReportJob } from "./report-types.ts";

/** References only; an accelerator never receives a browser/device credential or raw body. */
export type AcceleratorJob = Readonly<Pick<ReportJob,
  | "account_id" | "generation" | "device_id" | "source_domain" | "job_id"
  | "request_hash" | "lease_fence" | "lease_until" | "expires_at"
>>;
export type AcceleratorSubmission =
  | { readonly state: "disabled" }
  | { readonly state: "accepted"; readonly leaseFence: number };

export interface ReportAccelerator {
  readonly enabled: boolean;
  submit(job: AcceleratorJob): Promise<AcceleratorSubmission>;
}

/**
 * Deliberately non-activatable in this release. Core reports use ReportFlow;
 * no endpoint, credential, Queue, VM process or callback writer is installed.
 */
export const oracleAccelerator = {
  enabled: false,
  async submit(_job: AcceleratorJob): Promise<AcceleratorSubmission> {
    return { state: "disabled" };
  },
} as const satisfies ReportAccelerator;

export const acceleratorStatusPath = "/v1/activity/accelerator/status";
export function acceleratorStatus() {
  return {
    provider: "oracle", enabled: oracleAccelerator.enabled,
    state: "disabled", coreProcessor: "cloudflare-workflow",
    acceptsCallbacks: false, externalJobs: 0,
  } as const;
}
