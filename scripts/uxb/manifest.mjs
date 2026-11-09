import { z } from "../../site/node_modules/zod/index.js";

const expected = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const state = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  selector: z.string().min(1),
  action: z.enum(["none", "hover", "focus", "active"]).default("none"),
  focusSelector: z.string().min(1).optional(),
  expected: expected.default({}),
  touchExpected: expected.default({}),
  themeExpected: z.object({ light: expected, dark: expected }).optional(),
  reference: z.object({ light: z.string(), dark: z.string() }).optional(),
  profileReferences: z.record(z.string(), z.object({ light: z.string(), dark: z.string() })).optional(),
}).strict();
export const manifestSchema = z.object({
  pages: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/), url: z.url(),
    ready: z.string().min(1), states: z.array(state).min(1),
  }).strict()).min(1),
  profiles: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    width: z.number().int().positive(), height: z.number().int().positive(),
    touch: z.boolean().default(false),
    deviceScaleFactor: z.number().min(1).max(3).default(1),
  }).strict()).min(1),
  requireReferences: z.boolean().default(true),
  isolateSpecimens: z.boolean().default(false),
  pixelChannelTolerance: z.number().int().min(0).max(2).default(0),
}).strict();
