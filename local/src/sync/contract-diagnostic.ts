import type { z } from "zod";

/**
 * invalid_contract is a client-side schema rejection, not a server refusal.
 * status.json records only which schema path failed and the issue kind, never
 * the inspected value. Dynamic map keys can carry user data (file paths, URIs,
 * prompts), so path segments and key names pass only when they look like fixed
 * schema field names; anything else is rendered as "?".
 */
const SAFE_SEGMENT = /^([a-z][a-z0-9_]{0,39}|[0-9]{1,6})$/i;
function segment(value: unknown): string {
  const text = String(value);
  return SAFE_SEGMENT.test(text) ? text : "?";
}
export function contractDiagnostic(error: z.ZodError): string {
  const parts = error.issues.slice(0, 3).map(issue => {
    if (issue.code === "unrecognized_keys") {
      return `extra_keys:${issue.keys.map(segment).join(",")}`;
    }
    const path = issue.path.map(segment).join(".") || "root";
    return `${path}:${issue.code}`;
  });
  const suffix = parts.join("|").slice(0, 240);
  return suffix === "" ? "invalid_contract" : `invalid_contract:${suffix}`;
}
