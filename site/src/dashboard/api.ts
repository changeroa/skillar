import { z } from "zod";
import { privateSkillScopes } from "../../../shared/dist/private-skills.js";
import { dashboardPaths, dashboardProfilesSchema } from "../../../shared/dist/activity-dashboard.js";
import type { DashboardProfiles } from "../../../shared/dist/activity-dashboard.js";
import { consentSchema } from "../../../shared/dist/activity-consent.js";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import { commandStatusSchema } from "../../../shared/dist/activity-commands.js";
import type { CommandStatus, CommandStatusRequest, SourceCommandRequest } from "../../../shared/dist/activity-commands.js";
import { sessionResponseSchema } from "../../lib/account.ts";
import type { SessionUser } from "../../lib/account.ts";
import type { RequestFailure } from "./status";

/** Same-origin browser routes. The Google session cookie is the only credential; nothing is stored here. */
export const routes = {
  session: "/auth/session",
  profiles: dashboardPaths.profiles,
  devices: "/api/devices",
  grants: "/api/devices/grants",
  consent: (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}/consent`,
  revoke: (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}/revoke`,
  commands: "/api/dashboard/commands",
  commandStatus: "/api/dashboard/commands/status",
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

/**
 * Human copy for a failed request; never echoes server text beyond the fixed error codes.
 * `action` is a noun phrase such as "출처 읽기"; every template attaches its particle to the fixed word "요청", so no action needs a particle of its own.
 */
export function describeFailure(error: unknown, action: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return `${action} 요청이 취소되었습니다.`;
  if (error instanceof DashboardRequestError) {
    switch (error.code) {
      case "consent_conflict": return "동의 내용이 다른 곳에서 바뀌었습니다. 새로 고쳐 현재 버전을 확인하세요.";
      case "command_conflict": return "다른 명령이 대기 중이거나 출처 리비전이 바뀌었습니다. 다시 제출하기 전에 출처를 새로 고치세요.";
      case "dashboard_unavailable": case "activity_unavailable": return `${action} 요청을 지금은 처리할 수 없습니다. 나중에 다시 시도하세요.`;
      case "not_found": return "해당 기기가 이 계정에 더 이상 없습니다.";
      case "invalid_consent": case "invalid_request": return `${action} 요청이 올바르지 않아 거부되었습니다. 입력 내용을 확인하고 다시 시도하세요.`;
      case "insufficient_scope": return `이 계정에서는 ${action} 요청이 허용되지 않습니다.`;
      default: return `${action} 요청을 완료하지 못했습니다. 다시 시도하세요.`;
    }
  }
  if (error instanceof SyntaxError || error instanceof z.ZodError) return `${action} 요청의 응답 형식 오류입니다. 다시 시도하세요.`;
  if (error instanceof TypeError) return `${action} 요청이 skillar에 도달하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.`;
  return `${action} 요청이 예기치 않게 실패했습니다.`;
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

export async function failureOf(response: Response): Promise<RequestFailure> {
  return { status: response.status, code: await errorCode(response.clone()) };
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
    if (error instanceof SyntaxError) return { kind: "unexpected" };
    if (error instanceof TypeError) return { kind: "unreachable" };
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
export function createGrant(signal?: AbortSignal, allowPrivateSkills = false): Promise<DeviceGrant> {
  return call(routes.grants, grantSchema, {
    body: { scopes: allowPrivateSkills ? [...GRANT_SCOPES, ...privateSkillScopes] : GRANT_SCOPES }, signal,
  });
}

export async function revokeDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
  await call(routes.revoke(deviceId), revokedSchema, { body: {}, signal });
}

/** Queues one source command; 202 answers with its durable status, which starts pending and never implies application. */
export function submitCommand(request: SourceCommandRequest, signal?: AbortSignal): Promise<CommandStatus> {
  return call(routes.commands, commandStatusSchema, { body: request, signal });
}

/** Reads the durable status of one command for a source; an explicit check, never polled. */
export function readCommandStatus(request: CommandStatusRequest, signal?: AbortSignal): Promise<CommandStatus> {
  return call(routes.commandStatus, commandStatusSchema, { body: request, signal });
}
