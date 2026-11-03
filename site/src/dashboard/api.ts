import { z } from "zod";
import { dashboardPaths, dashboardProfilesSchema } from "../../../shared/dist/activity-dashboard.js";
import type { DashboardProfiles } from "../../../shared/dist/activity-dashboard.js";
import { consentSchema } from "../../../shared/dist/activity-consent.js";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import { sessionResponseSchema } from "../../lib/account.ts";
import type { SessionUser } from "../../lib/account.ts";

/** Same-origin browser routes. The Google session cookie is the only credential; nothing is stored here. */
export const routes = {
  session: "/auth/session",
  profiles: dashboardPaths.profiles,
  devices: "/api/devices",
  grants: "/api/devices/grants",
  consent: (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}/consent`,
  revoke: (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}/revoke`,
} as const;
export const GRANT_SCOPES = ["activity:read", "activity:ingest"] as const;

const deviceListSchema = z.object({
  devices: z.array(z.object({
    deviceId: z.string().min(1), createdAt: z.number().int(), revokedAt: z.number().int().nullable(),
  })),
});
const consentStateSchema = z.object({ version: z.number().int().nonnegative(), consent: consentSchema });
const grantSchema = z.object({
  grant: z.string().min(32).max(128), deviceId: z.string().min(1), expiresAt: z.number().int(),
});
const revokedSchema = z.object({ revoked: z.literal(true) });
const errorSchema = z.object({ error: z.string().min(1).max(100) });

export type DeviceRecord = z.infer<typeof deviceListSchema>["devices"][number];
export type ConsentState = z.infer<typeof consentStateSchema>;
export type DeviceGrant = z.infer<typeof grantSchema>;
export type SessionState =
  | { kind: "signed-in"; user: SessionUser }
  | { kind: "signed-out" }
  | { kind: "unreachable" }
  | { kind: "unexpected" };

export class DashboardRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`${code} (${status})`);
    this.name = "DashboardRequestError";
    this.status = status;
    this.code = code;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof DashboardRequestError && error.status === 401;
}

/** Human copy for a failed request; never echoes server text beyond the fixed error codes. */
export function describeFailure(error: unknown, action: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return `${action} was cancelled.`;
  if (error instanceof DashboardRequestError) {
    switch (error.code) {
      case "consent_conflict": return "Consent changed elsewhere. Reload to review the current version.";
      case "dashboard_unavailable": case "activity_unavailable": return `${action} is unavailable right now. Try again later.`;
      case "not_found": return "That device no longer exists for this account.";
      case "invalid_consent": case "invalid_request": return `${action} was rejected as invalid. Review the form and try again.`;
      case "insufficient_scope": return `${action} is not allowed for this account.`;
      default: return `${action} failed (${error.code}).`;
    }
  }
  if (error instanceof TypeError) return `${action} could not reach skillar. Check your connection and retry.`;
  return `${action} failed unexpectedly.`;
}

async function errorCode(response: Response): Promise<string> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error : `http_${response.status}`;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return `http_${response.status}`;
    throw error;
  }
}

type CallInit = { readonly body?: object; readonly signal?: AbortSignal | undefined };

async function call<S extends z.ZodType>(path: string, schema: S, init: CallInit = {}): Promise<z.output<S>> {
  const response = await fetch(path, {
    method: init.body === undefined ? "GET" : "POST",
    credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
  if (!response.ok) throw new DashboardRequestError(response.status, await errorCode(response));
  return schema.parse(await response.json());
}

export async function readSession(signal?: AbortSignal): Promise<SessionState> {
  let payload: unknown;
  try {
    const response = await fetch(routes.session, {
      credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return { kind: "unexpected" };
    payload = await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof TypeError || error instanceof SyntaxError) return { kind: "unreachable" };
    throw error;
  }
  const parsed = sessionResponseSchema.safeParse(payload);
  if (!parsed.success) return { kind: "unexpected" };
  return parsed.data.user === null ? { kind: "signed-out" } : { kind: "signed-in", user: parsed.data.user };
}

export function readProfiles(signal?: AbortSignal): Promise<DashboardProfiles> {
  return call(routes.profiles, dashboardProfilesSchema, { signal });
}

export async function readDevices(signal?: AbortSignal): Promise<readonly DeviceRecord[]> {
  return (await call(routes.devices, deviceListSchema, { signal })).devices;
}

export function readConsent(deviceId: string, signal?: AbortSignal): Promise<ConsentState> {
  return call(routes.consent(deviceId), consentStateSchema, { signal });
}

export function writeConsent(
  deviceId: string, baseVersion: number, consent: Consent, signal?: AbortSignal,
): Promise<ConsentState> {
  return call(routes.consent(deviceId), consentStateSchema, { body: { baseVersion, consent }, signal });
}

/** The grant is returned once, held in memory and offered as a file download; it never touches a URL or storage. */
export function createGrant(signal?: AbortSignal): Promise<DeviceGrant> {
  return call(routes.grants, grantSchema, { body: { scopes: GRANT_SCOPES }, signal });
}

export async function revokeDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
  await call(routes.revoke(deviceId), revokedSchema, { body: {}, signal });
}
