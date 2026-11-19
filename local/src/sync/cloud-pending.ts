import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { z } from "zod";
import { CloudSyncError } from "./cloud-blobs.js";
import { CloudHttp, CloudRequestError } from "./cloud-http.js";
import {
  atomicCloudJson, cloudHome, connectCloud, readConnection,
} from "./cloud-connection.js";
import type { CloudConnection } from "./cloud-connection.js";

/** The CLI asks for exactly these scopes; the approval page shows them for comparison. */
export const PENDING_CONNECT_SCOPES = ["activity:read", "activity:ingest"] as const;

const issueSchema = z.strictObject({
  userCode: z.string().min(8).max(16), pollToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresIn: z.number().int().positive(), pollInterval: z.number().int().positive(),
});
const pollPendingSchema = z.strictObject({
  state: z.literal("pending"), retryAfter: z.number().int().positive().optional(),
});
const pollIssuedSchema = z.strictObject({
  grant: z.string().min(32).max(128), deviceId: z.string().min(1), expiresAt: z.number().int().positive(),
});
export type PendingConnectIssue = z.infer<typeof issueSchema>;
export type PendingConnectGrant = z.infer<typeof pollIssuedSchema>;

export function pendingApproveUrl(origin: string, userCode: string): string {
  return `${origin}/connections/?code=${encodeURIComponent(userCode)}`;
}

export function defaultDeviceLabel(): string {
  const name = hostname().trim();
  return (name === "" ? "skillar-cli" : name).slice(0, 120);
}

export async function createPendingConnect(
  origin: string,
  input: { readonly deviceLabel: string; readonly scopes: readonly string[] },
  fetcher: typeof fetch = fetch,
): Promise<PendingConnectIssue> {
  const http = new CloudHttp(origin, null, fetcher);
  return issueSchema.parse(await http.request("/v1/devices/pending", {
    body: JSON.stringify({ deviceLabel: input.deviceLabel, scopes: [...input.scopes] }),
  }));
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Polls until the browser approves or the request expires. The single-use
 * grant comes back exactly once; the caller redeems it through the existing
 * /v1/devices/exchange boundary (connectCloud).
 */
export async function pollPendingConnect(
  origin: string, issue: PendingConnectIssue,
  options: {
    readonly fetcher?: typeof fetch;
    readonly wait?: (ms: number) => Promise<void>;
    readonly now?: () => number;
  } = {},
): Promise<PendingConnectGrant> {
  const http = new CloudHttp(origin, null, options.fetcher ?? fetch);
  const wait = options.wait ?? sleep, now = options.now ?? Date.now;
  const deadline = now() + issue.expiresIn * 1000;
  for (;;) {
    if (now() >= deadline) throw new CloudSyncError("pending_expired");
    try {
      const value = await http.request("/v1/devices/pending/poll", {
        body: JSON.stringify({ pollToken: issue.pollToken }),
      });
      const pending = pollPendingSchema.safeParse(value);
      if (pending.success) {
        await wait((pending.data.retryAfter ?? issue.pollInterval) * 1000);
        continue;
      }
      return pollIssuedSchema.parse(value);
    } catch (error) {
      if (error instanceof CloudRequestError && error.code === "rate_limited") {
        await wait(Math.max(issue.pollInterval * 1000, (error.retryAtMs ?? 0) - now()));
        continue;
      }
      if (error instanceof CloudRequestError && error.state === "disabled") {
        throw new CloudSyncError("pending_expired");
      }
      if (error instanceof CloudRequestError && error.status === 410) {
        throw new CloudSyncError("pending_consumed");
      }
      throw error;
    }
  }
}

export function openBrowser(url: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (env.SKILLAR_NO_CLI ?? env.GISOOL_NO_CLI) return Promise.resolve(false);
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise(resolve => {
    const child = spawn(opener, [url], { env, stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => { child.unref(); resolve(true); });
  });
}

const noticeSchema = z.strictObject({ deviceId: z.string().min(1), noticedAtMs: z.number() });

export function markConsentNoticed(home: string, deviceId: string): void {
  atomicCloudJson(home, "consent-notice.json", { deviceId, noticedAtMs: Date.now() });
}

/**
 * Once per device: the URL where upload consent is managed. Returns null when
 * this device already got the notice; a reconnect (new device id) resets it.
 */
export function consentReviewNotice(home: string, connection: CloudConnection): string | null {
  const path = join(cloudHome(home), "consent-notice.json");
  if (existsSync(path)) {
    const saved = noticeSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (saved.success && saved.data.deviceId === connection.deviceId) return null;
  }
  markConsentNoticed(home, connection.deviceId);
  return `${connection.origin}/connections/`;
}

export type ConnectIo = { out(text: string): void; err(text: string): void };

/**
 * Browser-approval connect: pending code -> approval page -> single-use grant
 * -> existing exchange. --upload is terminal guidance only; consent itself is
 * always off by default and can only be switched on in the browser.
 */
export async function connectCloudDeviceFlow(
  home: string,
  options: {
    readonly origin: string;
    readonly deviceLabel?: string;
    readonly uploadIntent?: boolean;
    readonly open?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly io?: ConnectIo;
    readonly fetcher?: typeof fetch;
    readonly wait?: (ms: number) => Promise<void>;
  },
): Promise<Omit<CloudConnection, "token">> {
  if (readConnection(home) !== null) throw new CloudSyncError("already_connected");
  const issue = await createPendingConnect(options.origin, {
    deviceLabel: options.deviceLabel ?? defaultDeviceLabel(), scopes: PENDING_CONNECT_SCOPES,
  }, options.fetcher);
  const url = pendingApproveUrl(options.origin, issue.userCode);
  const io = options.io;
  io?.out(`연결 코드: ${issue.userCode}\n`);
  io?.out(`브라우저에서 ${Math.max(1, Math.floor(issue.expiresIn / 60))}분 안에 승인하세요: ${url}\n`);
  if (options.uploadIntent === true) {
    io?.out("--upload: 브라우저 화면에서 업로드 동의를 직접 선택해야 업로드가 켜집니다(기본은 로컬 전용).\n");
  }
  if (options.open !== false) {
    const opened = await openBrowser(url, options.env ?? process.env);
    if (!opened) io?.out("브라우저를 열지 못했습니다. 위 주소를 직접 여세요.\n");
  }
  io?.out("승인을 기다리는 중…\n");
  const issued = await pollPendingConnect(options.origin, issue, {
    fetcher: options.fetcher, wait: options.wait,
  });
  const connected = await connectCloud(home, {
    origin: options.origin, grant: issued.grant,
  }, options.fetcher);
  markConsentNoticed(home, connected.deviceId);
  return connected;
}
