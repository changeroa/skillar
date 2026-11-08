import { z } from "zod";
import inventory from "./capability-inventory.json" with { type: "json" };
import { contentKindSchema } from "./activity-schema.js";
import type { Consent } from "./activity-consent.js";

export const implementationStageSchema = z.enum([
  "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "P13", "P14",
]);
export const capabilitySchema = z.strictObject({
  id: z.string().min(1),
  surface: z.enum(["cli", "dashboard", "http", "local-mcp", "registry", "runtime-ingestion"]),
  operation: z.string().min(1),
  content_kinds: z.array(contentKindSchema).readonly(),
  connector_dependent: z.boolean(),
  stage: implementationStageSchema,
  source: z.string().min(1),
  note: z.string().optional(),
}).readonly();
export const featureCapabilities = z.array(capabilitySchema).readonly().parse(inventory);
export type FeatureCapability = z.infer<typeof capabilitySchema>;
export type CapabilityContext = {
  readonly consent: Consent;
  readonly completedStages: readonly z.infer<typeof implementationStageSchema>[];
  readonly connectorOnline: boolean;
};
export type CapabilityStatus =
  | { readonly status: "local-only" }
  | { readonly status: "planned"; readonly stage: FeatureCapability["stage"] }
  | { readonly status: "degraded"; readonly reason: "content-consent" | "connector-offline" }
  | { readonly status: "available" };

export function assessCapability(feature: FeatureCapability, context: CapabilityContext): CapabilityStatus {
  const consent = context.consent;
  if (consent.mode === "local-only") return { status: "local-only" };
  if (!context.completedStages.includes(feature.stage)) return { status: "planned", stage: feature.stage };
  if (feature.content_kinds.length > 0 &&
      (consent.mode !== "managed-content" ||
       feature.content_kinds.some(kind => !consent.contentKinds.includes(kind)))) {
    return { status: "degraded", reason: "content-consent" };
  }
  if (feature.connector_dependent && !context.connectorOnline) {
    return { status: "degraded", reason: "connector-offline" };
  }
  return { status: "available" };
}
